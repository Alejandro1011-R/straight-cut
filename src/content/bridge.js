// Isolated world. main.js runs in the page's world, where chrome.* doesn't
// exist, so it fires DOM events and this script relays them to the background.
document.addEventListener('straightcut:stat', (event) => {
  const { kind, count } = event.detail ?? {};
  if ((kind !== 'removed' && kind !== 'skipped') || !(count > 0)) return;
  try {
    chrome.runtime.sendMessage({ type: 'stat', kind, count }).catch(() => {});
  } catch {
    // The extension was reloaded; this tab keeps the old script until refresh.
  }
});
