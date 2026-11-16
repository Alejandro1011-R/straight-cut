# Straight Cut

Straight to the video. A tiny, open-source extension that removes YouTube ads
in Arc, Chrome, Brave, Edge and any other Chromium browser, and in Firefox and
Firefox-based browsers like Zen.

- Removes pre-roll and mid-roll video ads before the player loads them
- Clears sponsored tiles from the home feed, search, the sidebar and Shorts
- Hides the "ad blockers violate YouTube's Terms" dialog
- About 200 lines of plain JavaScript, with no build step and no dependencies
- Collects nothing and makes no network requests of its own

## Install

It isn't in any extension store yet, so you load it yourself. That takes about
a minute.

1. Download this repository: **Code → Download ZIP**, then unzip it. Or run
   `git clone https://github.com/Alejandro1011-R/straight-cut.git`.
2. Open your browser's extensions page:
   - Arc: `arc://extensions`
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the folder you downloaded.
5. Reload any YouTube tabs you have open.

Pin it from the extensions menu to get the on/off switch and the counters.

To update, download the new version over the old folder, then click the reload
icon on the extension's card.

### Firefox and Zen

Firefox only installs signed extensions. Open a signed `.xpi` (see
[Develop](#develop) for how to sign one) in Firefox or Zen and click **Add**. It
needs Firefox 128 or newer.

To try your own changes without signing, open `about:debugging#/runtime/this-firefox`,
click **Load Temporary Add-on** and pick `manifest.json`. It stays until you
restart the browser.

## How it works

Chromium dropped Manifest V2 in 2025, and full uBlock Origin needs it. Straight
Cut uses the same techniques as uBlock Origin's YouTube filters, rebuilt on
what Manifest V3 still allows:

| Layer | File | What it does |
| --- | --- | --- |
| Prune | `src/content/main.js` | Runs in the page's own JS world before YouTube does. Wraps `JSON.parse` and `Response.json`, and traps `ytInitialPlayerResponse` / `ytInitialData`. It deletes `adPlacements`, `playerAds` and `adSlots` from player responses, and drops ad items from feed, search, sidebar and Shorts lists. The player never schedules the ad. |
| Skip | `src/content/main.js` | Fallback for ads that still play, like server-stitched (SSAI) ads or a new response shape. It mutes the ad, presses Skip, and jumps to the ad's end. For stitched ads it seeks the player's ad timeline, not the `<video>`, so the actual video isn't skipped. |
| Hide | `src/content/cosmetic.css` | Hides ad slots, in-player overlays and the anti-adblock dialog. Playback resumes if that dialog paused it. |
| Block | `rules/network.json` | `declarativeNetRequest` rules for ad and ad-tracking endpoints (`/pagead/`, `/api/stats/ads`, `/ptracking`, doubleclick, IMA SDK). These only apply when YouTube is the page making the request. |

The popup has two counters. "Removed before playing" is the prune layer
working. "Skipped while playing" means an ad reached the player, which usually
means YouTube changed something.

## Privacy and permissions

| Permission | Why |
| --- | --- |
| `youtube.com`, `youtube-nocookie.com` | Run the content scripts on YouTube |
| `doubleclick.net`, `googlesyndication.com` | Block ad requests coming from YouTube |
| `declarativeNetRequest` | Network blocking rules |
| `scripting` | Turn the content scripts on and off with the switch |
| `storage` | Save the switch and the two counters, on your device only |

Nothing leaves your browser.

## When ads come back

YouTube changes how it delivers ads every few weeks. If you start seeing them:

1. Open the popup. If "Skipped while playing" is climbing, ads are getting past
   the prune layer.
2. [Open an issue](https://github.com/Alejandro1011-R/straight-cut/issues). Say
   where the ad showed up (start of the video, mid-roll, feed, search, Shorts)
   and paste the video link.

Fixes usually mean a new key name in `AD_SCHEDULE_KEYS` or `AD_RENDERERS` in
`src/content/main.js`. uBlock Origin's
[uAssets](https://github.com/uBlockOrigin/uAssets) lists are the best place to
see what changed.

## Develop

```bash
node --test test/            # unit tests: the prune layer in a sandboxed page
node tools/make-icons.mjs    # regenerate icons/
sh tools/build-firefox.sh    # pack dist/straight-cut-<version>.xpi for Firefox
```

One `manifest.json` serves both engines. Chromium reads
`background.service_worker` and ignores `background.scripts`; Firefox does the
opposite and reads its add-on id from `browser_specific_settings`. To sign a new
version, bump `version`, build the `.xpi` and upload it to
[addons.mozilla.org](https://addons.mozilla.org/developers/) as a self-distributed
("On your own") version.

To run the unit tests against a real watch page saved with `curl`, set
`SC_WATCH_HTML=/path/to/watch.html`.

`test/live.mjs` loads the extension into Playwright's Chromium and plays a few
videos. Install `playwright` anywhere and point `NODE_PATH` at it.

Pull requests are welcome. Keep it small: no dependencies and no build step.

## License

[MIT](LICENSE) © 2026 Alejandro Ramírez Trueba

Straight Cut isn't affiliated with or endorsed by YouTube or Google. YouTube is
a trademark of Google LLC.
