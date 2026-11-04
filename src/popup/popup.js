const toggle = document.getElementById('toggle');
const statusText = document.getElementById('status');
const reload = document.getElementById('reload');
const format = new Intl.NumberFormat();

function render({ enabled = true, removed = 0, skipped = 0 }) {
  toggle.setAttribute('aria-checked', String(enabled));
  statusText.textContent = enabled ? 'Blocking ads on YouTube' : 'Paused. YouTube ads will show';
  document.getElementById('removed').textContent = format.format(removed);
  document.getElementById('skipped').textContent = format.format(skipped);
}

render(await chrome.storage.local.get(['enabled', 'removed', 'skipped']));

chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area === 'local') render(await chrome.storage.local.get(['enabled', 'removed', 'skipped']));
});

toggle.addEventListener('click', async () => {
  const enabled = toggle.getAttribute('aria-checked') !== 'true';
  await chrome.storage.local.set({ enabled });

  // Scripts already running in open tabs only change on the next load.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  reload.hidden = !/^https?:\/\/([^/]+\.)?youtube(-nocookie)?\.com\//.test(tab?.url ?? '');
});

document.getElementById('reload-tab').addEventListener('click', async () => {
  await chrome.tabs.reload();
  window.close();
});
