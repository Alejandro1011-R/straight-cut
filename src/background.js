const MATCHES = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'];

const SCRIPTS = [
  {
    id: 'straightcut-main',
    matches: MATCHES,
    js: ['src/content/main.js'],
    world: 'MAIN',
    runAt: 'document_start',
    allFrames: true,
  },
  {
    id: 'straightcut-bridge',
    matches: MATCHES,
    js: ['src/content/bridge.js'],
    css: ['src/content/cosmetic.css'],
    runAt: 'document_start',
    allFrames: true,
  },
];

// chrome.* calls below are async and these handlers can overlap (install +
// toggle, many stat messages at once), so each kind of work runs in a queue.
const queue = () => {
  let tail = Promise.resolve();
  return (task) => (tail = tail.then(task, task));
};
const applyQueue = queue();
const statsQueue = queue();

// Content scripts are registered at runtime instead of in the manifest so the
// on/off switch can remove them entirely.
function apply(enabled) {
  return applyQueue(async () => {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    if (registered.length) {
      await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
    }
    if (enabled) await chrome.scripting.registerContentScripts(SCRIPTS);
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      enabled ? { enableRulesetIds: ['network'] } : { disableRulesetIds: ['network'] },
    );
  });
}

async function isEnabled() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  return enabled;
}

chrome.runtime.onInstalled.addListener(async () => apply(await isEnabled()));
chrome.runtime.onStartup.addListener(async () => apply(await isEnabled()));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'enabled' in changes) apply(changes.enabled.newValue !== false);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'stat') return;
  const count = Math.floor(Number(message.count));
  if (!(count > 0 && count < 1000)) return;
  const key = message.kind === 'skipped' ? 'skipped' : 'removed';
  statsQueue(async () => {
    const { [key]: current = 0 } = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: current + count });
  });
});
