// Runs src/content/main.js in a sandbox shaped like a page and checks that the
// hooks strip ads and leave everything else alone. Run: node --test
// Set SC_WATCH_HTML to a saved youtube.com/watch page to also test real data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/content/main.js', import.meta.url), 'utf8');

// Objects made inside the sandbox have its prototypes; copy them out to compare.
const plain = (value) => JSON.parse(JSON.stringify(value));

function page() {
  const stats = [];
  const document = {
    dispatchEvent: (event) => stats.push(event.detail),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    document,
    CustomEvent,
    Response,
    Proxy,
    Reflect,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
    MutationObserver: class {},
  });
  vm.runInContext('globalThis.window = globalThis', context);
  vm.runInContext(source, context);
  const run = (code) => vm.runInContext(code, context);
  return { run, stats, context };
}

const playerResponse = () => ({
  responseContext: { serviceTrackingParams: [] },
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: 'abc', title: 'A video' },
  streamingData: { adaptiveFormats: [{ itag: 248 }] },
  adPlacements: [{ adPlacementRenderer: {} }, { adPlacementRenderer: {} }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adSlots: [{ adSlotRenderer: {} }],
  adBreakHeartbeatParams: 'Q0FB',
});

test('JSON.parse strips the ad schedule from a player response', () => {
  const { run, stats } = page();
  const out = run(`JSON.parse(${JSON.stringify(JSON.stringify(playerResponse()))})`);
  assert.equal(out.adPlacements, undefined);
  assert.equal(out.playerAds, undefined);
  assert.equal(out.adSlots, undefined);
  assert.equal(out.adBreakHeartbeatParams, undefined);
  assert.equal(out.videoDetails.title, 'A video');
  assert.equal(out.streamingData.adaptiveFormats.length, 1);
  assert.deepEqual(plain(stats), [{ kind: 'removed', count: 2 }]);
});

test('nested playerResponse in a batched /next-style array is cleaned', () => {
  const { run } = page();
  const batch = [{ playerResponse: playerResponse() }, { response: { responseContext: {} } }];
  const out = run(`JSON.parse(${JSON.stringify(JSON.stringify(batch))})`);
  assert.equal(out[0].playerResponse.adPlacements, undefined);
  assert.equal(out[0].playerResponse.videoDetails.videoId, 'abc');
});

test('feed, sidebar and search ad items are removed from lists', () => {
  const { run, stats } = page();
  const browse = {
    responseContext: {},
    contents: {
      richGridRenderer: {
        contents: [
          { richItemRenderer: { content: { videoRenderer: { videoId: 'a' } } } },
          { richItemRenderer: { content: { adSlotRenderer: {} } } },
          { richSectionRenderer: { content: { statementBannerRenderer: {} } } },
          { richItemRenderer: { content: { videoRenderer: { videoId: 'b' } } } },
        ],
      },
    },
    secondary: [{ compactVideoRenderer: { videoId: 'c' } }, { adSlotRenderer: {} }],
    search: [{ searchPyvRenderer: {} }, { videoRenderer: { videoId: 'd' } }],
  };
  const out = run(`JSON.parse(${JSON.stringify(JSON.stringify(browse))})`);
  const ids = out.contents.richGridRenderer.contents.map((i) => i.richItemRenderer.content.videoRenderer.videoId);
  assert.deepEqual(plain(ids), ['a', 'b']);
  assert.deepEqual(plain(out.secondary), [{ compactVideoRenderer: { videoId: 'c' } }]);
  assert.deepEqual(plain(out.search), [{ videoRenderer: { videoId: 'd' } }]);
  assert.deepEqual(plain(stats), [{ kind: 'removed', count: 4 }]);
});

test('Shorts ads flagged with isAd are dropped from the reel sequence', () => {
  const { run } = page();
  const reel = {
    responseContext: {},
    entries: [
      { command: { reelWatchEndpoint: { videoId: 's1' } } },
      { command: { reelWatchEndpoint: { adClientParams: { isAd: true } } } },
      { command: { reelWatchEndpoint: { videoId: 's2' } } },
    ],
  };
  const out = run(`JSON.parse(${JSON.stringify(JSON.stringify(reel))})`);
  assert.deepEqual(plain(out.entries.map((e) => e.command.reelWatchEndpoint.videoId)), ['s1', 's2']);
});

test('unrelated JSON passes through untouched', () => {
  const { run, stats } = page();
  const out = run(`JSON.parse('{"adPlacements2":1,"items":[{"adSlotRenderer":{}}]}')`);
  assert.equal(out.items.length, 1);
  assert.equal(stats.length, 0);
});

test('Response.prototype.json is cleaned too', async () => {
  const { run } = page();
  const body = JSON.stringify(playerResponse());
  const out = await run(`new Response(${JSON.stringify(body)}).json()`);
  assert.equal(out.adPlacements, undefined);
  assert.equal(out.videoDetails.videoId, 'abc');
});

test('the inline `var ytInitialPlayerResponse = {...}` literal is cleaned', () => {
  const { run } = page();
  run(`var ytInitialPlayerResponse = ${JSON.stringify(playerResponse())};`);
  assert.equal(run('ytInitialPlayerResponse.adPlacements'), undefined);
  assert.equal(run('ytInitialPlayerResponse.videoDetails.videoId'), 'abc');
});

test('wrapped functions still look native', () => {
  const { run } = page();
  assert.match(run('JSON.parse.toString()'), /\[native code\]/);
  assert.match(run('Response.prototype.json.toString()'), /\[native code\]/);
});

test('a real watch page, if provided', { skip: !process.env.SC_WATCH_HTML }, () => {
  const html = readFileSync(process.env.SC_WATCH_HTML, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((s) => /var ytInitial(PlayerResponse|Data) = /.test(s));
  assert.ok(scripts.length > 0, 'page has inline ytInitial* scripts');
  const { run, stats } = page();
  for (const script of scripts) {
    // The assignment comes first; what follows touches DOM the sandbox lacks.
    try {
      run(script);
    } catch {}
  }
  const response = run('ytInitialPlayerResponse');
  assert.ok(response.videoDetails?.videoId, 'video details survive');
  assert.ok(response.streamingData, 'streams survive');
  assert.equal(JSON.stringify(response).includes('"adPlacements"'), false);
  console.log('  stats from real page:', JSON.stringify(stats));
});
