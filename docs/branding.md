# Railway Atlas branding and app identity

[Documentation index](README.md) · [Project overview](../README.md)

The displayed project and app name is **Railway Atlas**, including installed-app
labels. The tagline is **The world, by rail.** The approved artwork is the golden
track receding towards a teal horizon in [`styles/atlas-icon.svg`](../styles/atlas-icon.svg).
Do not create a separate logo for documentation, shortcuts or sharing.

## Surfaces to keep in sync

| Surface | Source |
| --- | --- |
| GitHub project overview and documentation index | Root and documentation READMEs; both reference the same SVG |
| Browser tab, app header, application name and Apple app label | `styles/index.html` |
| In-app help | `styles/index.html`; distinguish Railway Atlas from the credited upstream project |
| Install prompt, launcher label and PWA icons | `styles/manifest.webmanifest` |
| Browser favicon and Apple touch icon | Main page, `styles/data-check.html` and `styles/terrain-credits.html` |
| Shared website links | Open Graph and Twitter metadata in `styles/index.html` |
| Offline shell | `styles/sw.js`; precache all current icon files |

The PNG sizes are 192 and 512 pixels for ordinary installation, 512 pixels for
maskable installation, and 180 pixels for Apple touch icons. Preserve the
maskable icon's opaque background and safe-area padding. The current PNGs are
already the approved artwork; their names alone are not evidence of stale art.

## Updating artwork and metadata

Update the SVG, all raster variants and the matching inline controls artwork
together. Then run:

```sh
node scripts/sync-branding.mjs
node --test tests/branding.test.mjs tests/sw-install.test.mjs
node scripts/sync-branding.mjs --check
```

The sync script derives a `?rev=` fingerprint from each icon's actual bytes and
updates all HTML and manifest references. A changed image therefore gets a new
URL without arbitrarily renaming files on every deployment. CI's normal
`npm test` checks the revisions, image dimensions, metadata, documentation,
inline artwork and offline resolution. It does not verify an operating system's
already-installed shortcut or prove raster/SVG visual equivalence.

Keep `manifest.webmanifest` at its existing URL. Preserve its `id`, `start_url`
and `scope` (`./`). Do not change the repository/Pages path or saved-settings
keys as part of a display-name update. `openrailwaystyle` in repository URLs and
the private npm package identifier are compatibility/technical identifiers,
not the displayed app name. **Open Railway Styles** and Hack4Rail remain origin
credits; they do not describe the current application. Keep those credits in
[project origins](upstream.md) and the app's Sources section.

Shell cache generation 7 refreshes the branding files while preserving the
previous app version through the existing migration. It does not clear cookies,
local storage, saved drawings or user preferences. The `?rev=` URLs can fall
back to precached plain icon aliases offline; JavaScript's separate `?v=`
versioning remains unchanged.

### Avoid an installation deadlock

The service worker consumes each fetched response body before waiting for all
shell downloads to finish. A fetch promise resolves at headers, not at the end
of its body; waiting for every fetch before consuming any body can exhaust an
installing worker's network slots. Keep this handling for both CDN libraries
and application files. Reading a clone retains the original response metadata
for the cache and rejects truncated downloads before publishing that version.

`tests/sw-install.test.mjs` models a three-request limit with real streaming
Response objects. It checks complete installation, truncated library and module
responses, cache migration, previous-version modules and revised icons offline.
This test exercises the worker's real event handlers; it is not an Android or
iOS launcher test. Changing `sw.js` triggers the normal browser worker-update
check without changing the app's identity or deleting user data.

## Existing installations

An installed app's name and icon are managed by the browser and operating system,
separately from the page's favicon. Deploying changed manifest entries and icon
URLs makes the new branding available, but cannot force every existing shortcut
to update immediately. Reopen the installed app online; do not erase site data
merely to refresh an icon.

For Chrome 144 and later, Google's [January 2026 update documentation](https://developer.chrome.com/blog/improvements-to-web-app-updates)
explains that name and significant icon changes can be held for approval through
**Review app update** in the installed app's menu. Unchanged icon metadata and
URLs can prevent an icon download, which is why the content revisions above
matter. Refreshing the service worker is not the same as approving an identity
change. The site cannot make that user decision on an existing installation.

Other browsers and manually created home-screen shortcuts may behave differently.
The older [manifest-update guide](https://web.dev/articles/manifest-updates)
contains platform-specific diagnostic information, but its older desktop update
rules should not override the Chrome 144 documentation. Test both a fresh install
and an existing install on the actual target device before claiming launcher
migration has been verified.

## GitHub-hosted metadata

GitHub's repository **About** description and **Settings → Social preview**
image are repository settings, not files that a README or web manifest can
change. Set the About description to:

> Railway Atlas — a worldwide railway map with prominent stations and railway infrastructure, built on OpenStreetMap.

Keep the existing Pages homepage URL. A custom repository social preview should
use the same approved icon and name; website Open Graph metadata does not update
GitHub's own repository preview. Do not change the account avatar or rename the
repository to fix these surfaces. The source changes described above do not
claim to have changed these repository settings.

When deploying a fork at a different public URL, update the absolute Open Graph
and Twitter image URLs and `og:url` in `styles/index.html` to that deployment.
