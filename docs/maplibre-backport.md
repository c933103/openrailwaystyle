# MapLibre attribution backport

Atlas publishes `vendor/maplibre-gl-5.24.0-atlas.1.js`: the official MapLibre GL
JS 5.24.0 distribution with the one-line attribution fix from upstream commit
[`1da69f3cd913a39fa948708e01478663bf48bc27`](https://github.com/maplibre/maplibre-gl-js/commit/1da69f3cd913a39fa948708e01478663bf48bc27).
This is a locally patched 5.24.0 runtime, **not** the official 6.4.1 release.
The public upstream advisory is
[GHSA-jrc7-96c5-q579](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579).
Version-only dependency scanners will continue to identify 5.24.0 in the lock.
This backport addresses that specific upstream fix; it is not a claim that the
whole dependency or application has been audited.

## Why retain version 5

The [v6 migration](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.0.0)
changes UMD loading to ESM, requires WebGL2, removes `map.transform` used by
Atlas's polar/globe navigation, and changes the missing-style-image callback.
Those changes warrant a separate compatibility migration. This bounded fix
retains the existing renderer, embedded worker, public API and WebGL support.
The npm version and lock integrity stay unchanged; no transitive override or
unrelated test-tooling migration is included.

## Reproduce and verify

Run the usual `npm ci --ignore-scripts`, then `npm run build` and `npm test`.
The build verifies the installed package version and exact upstream JS bytes.
It also verifies the original TypeScript sanitizer and distribution source map,
and requires the map's embedded sanitizer source to match that TypeScript.
The exact source edit is `Array.from(elem.attributes)` in the attribute-removal
loop, matching the upstream commit. Its compiled counterpart is changed once;
the stale source-map URL is removed. No other renderer bytes are rewritten.

The shared `backportMapLibre524` helper checks both hashes and the unique
replacement count. Unknown, altered, truncated, already patched or unexpected
output fails closed. The result is deterministic and is not an opaque checked-in
binary. Generated vendor files remain uncommitted. A successful build removes
the obsolete original JavaScript artifact from reused output directories.

| Input/output | SHA-256 |
| --- | --- |
| Upstream 5.24.0 JavaScript | `45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb` |
| Patched atlas.1 JavaScript | `46dc2971db363b0c7efa1d9ae6035d26c872c7110a3384aaec379ff281e0f223` |
| Original `src/util/dom.ts` | `185a0ae3e1f09e40d3cfa2b40fa863be7b814526cea45479e89e38545c932364` |
| Original distribution source map | `a09ebdfe7d8a259b7c67a470caa2d4e57d31262bc99020ec41983d3325fa9901` |

The existing MapLibre licence file and distribution licence notices are retained.
The attribution fix is by Salman Aljardan (@0xKirisame), via MapLibre GL JS
upstream PR #8189. Map-data and application credits remain visible.

## Interrupted updates and offline recovery

The patched filename is distinct from the original first-party filename. The
new service worker precaches it with the complete application shell, and the
application module version changes coherently. Failed installation leaves the
previous complete shell available, following the existing recovery policy.

If a previous worker admits the new page but replacement installation fails,
the new app may find the original 5.24.0 in the same application's old cache,
either at its first-party or CDN key. It verifies the original bytes, performs
the same backport and verifies the result **before** creating an executable
blob. This does not request a CDN or mutate the original cache entry. Already
patched cached bytes are accepted only after matching the patched hash. Missing
Web Crypto, bad MIME, modified bytes or a failed patch cannot execute the saved
script. CSS and PMTiles retain their existing verified fallback.

The helper lives in an already-precached app module so this recovery does not
add a dependency that an older worker did not save. During successful activation,
the new worker does not migrate original MapLibre JavaScript. Future requests
to the historical first-party or CDN JS URLs receive the verified patched v5
bytes already installed with the new shell, without fetching either legacy URL.
Both historical loaders use plain script tags without SRI, so their unchanged
APIs accept those bytes. An older loader's direct Cache Storage fallback still
expects the original hash; it may fail closed if the verified replacement cannot
be served rather than run the old distribution. CSS/PMTiles compatibility and
old application modules remain. An already-running old library is not
retroactively rewritten; reload after a successful upgrade to execute the
patched application.

## Regression scope

Node tests compare both the patched TypeScript sanitizer and the actual patched
distribution against inert local HTML fixtures, assert unsafe attributes are
removed, preserve safe credit links, and include an unpatched sensitivity
control. They never execute an active attack or contact a provider.

`check-first-party-assets-browser.mjs` verifies built assets at root/project
URLs, CDN blocking, original and patched cache recovery, integrity failure and
unavailable crypto, plus actual attribution controls before/after a style reload.
Existing fixture browser checks cover globe/polar custom layers, workers and
rendering. Executed results and any environment limitations are recorded in the
PR; listing these checks here does not assert that a particular run passed.
