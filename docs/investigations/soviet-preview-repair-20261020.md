# Soviet preview repair, 20 October 2026

Bounded follow-up to PR251 head `ca63bb1f2629d64d258001e349e1e996855253a6`.

- Publication hold remains: the adapter installs only on an HTTP(S) loopback page with `sovietPreview=1`. Public hosts cannot opt in using query strings. Without that preview context, URL/cookie background selection falls back to Map; the selector and help are hidden and the selector is disabled.
- The warning test now matches the shipped explanation that printed Russian text is part of the image. The earlier targeted suite failed this assertion; it was not waived.
- The browser fixture uses an opaque red raster. A separate real MapLibre pixel check derives layer ordering from the actual adapter and uses explicitly synthetic geometry/colours for ocean, rail and station overlays. Exact positive RGBA samples and negative controls (raster moved above overlays; raster removed) are asserted. This proves stacking in that controlled case, not geographical coverage, real scan availability or production bathymetry accuracy.
- The five-location integration check starts away from its first sampled location so each movement must produce a new settled request. All external map requests are fixture responses under the existing no-egress harness.

Local checks: Node24.19.0; `npm ci --ignore-scripts --cache /tmp/atlas251-npm-cache`; `npm run build`; `npm test` (2,600 passing); `node --test tests/soviet-topo.test.mjs` (7 passing); `node --check styles/app.mjs`; `git diff --check`. Full suite preceded the final browser-only additions; the final browser script passed separately, including the no-preview UI/source gate and pixel controls. The generated world style is unchanged. Initial npm installation failed because its default cache directory was unavailable; a temporary writable cache resolved installation without dependency changes.

Hosted exact-head CI and Codex review are required before any merge. This repair does not authorize public provider use or remove the deployment hold.
