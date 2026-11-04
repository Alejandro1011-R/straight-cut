// Loads the unpacked extension into Playwright's Chromium, opens a few YouTube
// pages and reports what happened. Needs `playwright` installed somewhere on
// NODE_PATH (it isn't a dependency of the extension).
// Run: NODE_PATH=/path/to/node_modules node test/live.mjs [videoId ...]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const extension = fileURLToPath(new URL('..', import.meta.url));
const videos = process.argv.slice(2).length ? process.argv.slice(2) : ['dQw4w9WgXcQ', 'jNQXAC9IVRw'];

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'straightcut-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  locale: 'en-US',
});

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
await new Promise((r) => setTimeout(r, 1000));
console.log('registered scripts:', JSON.stringify(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((s) => s.map((x) => x.id)))));

const page = await context.newPage();
const blocked = [];
page.on('requestfailed', (req) => {
  if (req.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT') blocked.push(new URL(req.url()).pathname);
});

async function dismissConsent() {
  const reject = page.getByRole('button', { name: /^Reject all$/i }).first();
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    await page.waitForLoadState('domcontentloaded');
  }
}

for (const id of videos) {
  await page.goto(`https://www.youtube.com/watch?v=${id}`, { waitUntil: 'domcontentloaded' });
  await dismissConsent();
  await page.waitForSelector('#movie_player video', { timeout: 30000 });
  // Kick playback in case autoplay is blocked in this profile.
  await page.evaluate(() => document.querySelector('#movie_player video')?.play().catch(() => {}));

  const samples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1500);
    samples.push(
      await page.evaluate(() => {
        const player = document.getElementById('movie_player');
        const video = player?.querySelector('video');
        return {
          t: video ? Math.round(video.currentTime * 10) / 10 : null,
          ad: player?.classList.contains('ad-showing') ?? null,
          muted: video?.muted ?? null,
        };
      }),
    );
  }
  const response = await page.evaluate(() => {
    const r = document.getElementById('movie_player')?.getPlayerResponse?.() ?? window.ytInitialPlayerResponse;
    return { title: r?.videoDetails?.title, status: r?.playabilityStatus?.status, adPlacements: r?.adPlacements?.length ?? 0 };
  });
  console.log(`\n${id}:`, JSON.stringify(response));
  console.log('  playback samples:', samples.map((s) => `${s.t}s${s.ad ? ' AD' : ''}${s.muted ? ' muted' : ''}`).join(' | '));
}

await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
await dismissConsent();
await page.waitForTimeout(4000);
console.log('\nhome feed ad slots visible:', await page.evaluate(() => [...document.querySelectorAll('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer')].filter((e) => e.offsetParent).length));

console.log('blocked requests:', JSON.stringify([...new Set(blocked)].slice(0, 10)));
console.log('stats:', JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null))));
await context.close();
