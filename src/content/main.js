// Runs in YouTube's own JavaScript world at document_start, before any of the
// page's scripts. Two layers:
//   1. Prune: strip ad data out of player and feed responses as they're parsed,
//      so the player never schedules the ad.
//   2. Skip: if an ad still plays (server-stitched ads, new response shapes),
//      mute it, press Skip, or jump to its end.
(() => {
  'use strict';

  // Keys that carry the ad schedule inside a player response.
  const AD_SCHEDULE_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];

  // Renderers that only ever hold an ad. Any list item wrapping one is dropped.
  const AD_RENDERERS = new Set([
    'adSlotRenderer',
    'displayAdRenderer',
    'inFeedAdLayoutRenderer',
    'promotedSparklesWebRenderer',
    'promotedSparklesTextSearchRenderer',
    'promotedVideoRenderer',
    'compactPromotedVideoRenderer',
    'searchPyvRenderer',
    'bannerPromoRenderer',
    'statementBannerRenderer',
    'brandVideoSingletonRenderer',
    'brandVideoShelfRenderer',
    'actionCompanionAdRenderer',
    'playerLegacyDesktopWatchAdsRenderer',
  ]);

  const hasAdRenderer = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    for (const key in obj) if (AD_RENDERERS.has(key)) return true;
    return false;
  };

  function isAdItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (hasAdRenderer(item)) return true;
    if (hasAdRenderer(item.richItemRenderer?.content)) return true;
    if (hasAdRenderer(item.richSectionRenderer?.content)) return true;
    // Shorts feed: ads are ordinary entries flagged in their command.
    if (item.command?.reelWatchEndpoint?.adClientParams?.isAd) return true;
    if (item.engagementPanelSectionListRenderer?.targetId === 'engagement-panel-ads') return true;
    return false;
  }

  // Only walk YouTube's own API objects, never arbitrary JSON the page parses.
  function isInnertube(value) {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some((v) => v && typeof v === 'object' && ('playerResponse' in v || 'responseContext' in v));
    return 'responseContext' in value || 'playerResponse' in value || 'adPlacements' in value || 'playerAds' in value;
  }

  // Removes ads in place. Returns how many ads (ad breaks + list items) it took out.
  function prune(root) {
    let removed = 0;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          const item = node[i];
          if (isAdItem(item)) {
            node.splice(i, 1);
            removed++;
          } else if (item && typeof item === 'object') {
            stack.push(item);
          }
        }
        continue;
      }
      for (const key of AD_SCHEDULE_KEYS) {
        if (!(key in node)) continue;
        if (key === 'adPlacements' && Array.isArray(node[key])) removed += node[key].length;
        delete node[key];
      }
      for (const key in node) {
        const value = node[key];
        if (value && typeof value === 'object') stack.push(value);
      }
    }
    return removed;
  }

  // Tells the isolated-world bridge what happened, for the popup's counters.
  const report = (kind, count = 1) => {
    if (count > 0) document.dispatchEvent(new CustomEvent('straightcut:stat', { detail: { kind, count } }));
  };

  const clean = (value) => {
    if (isInnertube(value)) {
      try {
        report('removed', prune(value));
      } catch {}
    }
    return value;
  };

  // --- Layer 1: prune responses ------------------------------------------------

  // Proxies keep the native toString(), so the page can't tell they're wrapped.
  JSON.parse = new Proxy(JSON.parse, {
    apply: (target, thisArg, args) => clean(Reflect.apply(target, thisArg, args)),
  });

  Response.prototype.json = new Proxy(Response.prototype.json, {
    apply: (target, thisArg, args) => Reflect.apply(target, thisArg, args).then(clean),
  });

  // The first page load inlines `var ytInitialPlayerResponse = {...}` and
  // `var ytInitialData = {...}` as object literals, not JSON. A `var` on an
  // existing accessor goes through its setter, so we clean them on assignment.
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    let value;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => value,
        set: (next) => {
          value = clean(next);
        },
      });
    } catch {}
  }

  // --- Layer 2: skip what slips through ----------------------------------------

  const SKIP_BUTTONS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-slot button',
  ].join(',');

  const players = new WeakMap(); // player -> { inAd, mutedByUs, timer }

  function handlePlayer(player) {
    const state = players.get(player);
    const video = player.querySelector('video');
    const inAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');

    if (!inAd) {
      if (state.inAd && state.mutedByUs && video) video.muted = false;
      state.inAd = false;
      state.mutedByUs = false;
      return;
    }

    if (!state.inAd) {
      state.inAd = true;
      report('skipped');
    }
    if (video && !video.muted) {
      video.muted = true;
      state.mutedByUs = true;
    }

    player.querySelector(SKIP_BUTTONS)?.click();

    try {
      // Server-stitched ads live inside the content stream, so jumping to the
      // end of the <video> would skip the whole video. The player's own
      // progress state is scoped to the ad, so seek there instead.
      const stats = player.getStatsForNerds?.();
      if (stats?.debug_info?.startsWith('SSAP, AD')) {
        const progress = player.getProgressState?.();
        if (progress?.duration > 0) player.seekTo(progress.duration);
      } else if (video && Number.isFinite(video.duration) && video.currentTime < video.duration - 0.1) {
        video.currentTime = video.duration;
      }
    } catch {}

    // The Skip button and the ad's duration show up a beat later; keep trying.
    clearTimeout(state.timer);
    state.timer = setTimeout(() => handlePlayer(player), 250);
  }

  // The anti-adblock dialog is hidden by cosmetic.css; it also pauses the video.
  let enforcementSeen = false;
  function resumeAfterEnforcement() {
    const dialog = document.querySelector('ytd-enforcement-message-view-model');
    if (!dialog) {
      enforcementSeen = false;
      return;
    }
    if (enforcementSeen) return;
    enforcementSeen = true;
    const video = document.querySelector('#movie_player video');
    if (video?.paused) video.play().catch(() => {});
  }

  function scan() {
    for (const player of document.querySelectorAll('.html5-video-player')) {
      if (players.has(player)) continue;
      players.set(player, { inAd: false, mutedByUs: false, timer: 0 });
      new MutationObserver(() => handlePlayer(player)).observe(player, {
        attributes: true,
        attributeFilter: ['class'],
      });
      handlePlayer(player);
    }
    resumeAfterEnforcement();
  }

  setInterval(scan, 1000);
  document.addEventListener('DOMContentLoaded', scan);
})();
