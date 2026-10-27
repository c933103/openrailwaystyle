# PR273 — deployment verification, 27 October 2026

## Result

PR273 is merged and published at `934918385a85eca0fa5fc4a47d2ada67bd393050`, release `20261027-3d-visible-1`.

- Reviewed head: `f751387a6563b0a2aaa8f5f5e5494338de6c376b`.
- Merge parents: `193ba893d1181a585ca4abb7146b55e9e28dac08`, then the reviewed head.
- Reviewed head and actual merge have the identical source tree `0d1eb573b461322fe5daef44209c2d3764b7fc62`.
- [Exact-head Codex review](https://github.com/c933103/openrailwaystyle/pull/273#issuecomment-6433814075) completed with no findings.
- [PR site CI](https://github.com/c933103/openrailwaystyle/actions/runs/40450130137) passed all 2,732 tests and all six browser groups.

## Actual publication, including the failed first attempt

The [original merge push](https://github.com/c933103/openrailwaystyle/actions/runs/40455184384) failed its controls group: `service-status-browser-fixture.mjs:46` observed the service-status disclosure closed after changing the frequency period. Its browser aggregate failed and deployment was skipped. The other five browser groups and all 2,732 unit tests passed.

This was not dismissed as an infrastructure flake. Source inspection identified a deferred-toggle/state-preservation race; the separate PR274 owner independently reproduced it and is handling its bounded correction. This record does **not** claim that follow-up is already deployed.

Natural workflow dispatches were already queued by project data workflows. Dispatch `40455844891` was replaced/cancelled; [same-head dispatch 40456972649](https://github.com/c933103/openrailwaystyle/actions/runs/40456972649) completed successfully at **06:25:06 UTC** without this monitor requesting any rerun. It passed validation, all six browser groups, the aggregate, Pages deployment, exact deployed vector-byte checks and both published-site rendering checks.

[Deployment job 122042369353](https://github.com/c933103/openrailwaystyle/actions/runs/40456972649/job/122042369353) confirms:
1. Published independent OSM geometry with the live overview unavailable — passed.
2. Published map with local railway fixtures — passed.

A passing later execution does not negate the independently reproduced disclosure race.

## Independent live source check

At **06:21:34 UTC**, first-party GETs verified byte-exact Git blob matches against the merge for:
- `index.html`
- `app.mjs`
- `app.css`
- `terrain-3d.mjs`
- `sw.js`

See [source-verification.json](source-verification.json) for byte counts, expected/actual Git blob hashes and SHA-256 hashes. The served `vendor/tile-labels.js` separately embedded the release and full merge commit above.

These checks fetched only first-party published assets, not upstream map-provider tiles.

## Rendering evidence and limits

[Published artifact](https://github.com/c933103/openrailwaystyle/actions/runs/40456972649/artifacts/12713988824): `published-map-review`, 1,865,750 bytes; downloaded SHA-256 independently confirmed as `d0f47f861230f7cd8a29b589e080cf8a65dac811eb900502b8ece6bf284aff66`.

Its independent-reference JSON records 840 geographic/zoom samples and 18 application-mode samples across desktop Chromium, Android-size Chromium and WebKit, with **zero provider requests**. The ORM rendering tests used synthetic provider fixtures. Selected inspected screenshots are retained here:
- [Independent-reference desktop rendering](mainline-desktop.png).
- [Published Atlas fixture at Wuhan, zoom 8](orm-fixture-wuhan-infrastructure-z8.png), including the graphical mountain control.

The terrain-specific browser fixture passed identical-camera comparisons at 60° pitch: 28,213 significantly changed pixels for terrain versus flat, and 28,358 for 1× versus 0× DEM with terrain rendering still enabled, each out of 944,000 pixels. Signed sea/land heights and overhead release passed.

**This establishes real renderer response to synthetic elevation fixtures, not scenic quality across real-world terrain, and does not claim provider availability or new geographic data coverage.**

## Evidence files and retrieval limits

- [verification-metadata.json](verification-metadata.json): exact commits, tree, runs, step conclusions, artifact digest and fixture measurements.
- [source-verification.json](source-verification.json): independent live asset hashes.
- [rendering-summary.json](rendering-summary.json): compact summary derived from the downloaded published artifact.
- Selected original PNGs above.

Fetching the final deployment job's complete raw log returned `Transport closed` twice. Terminal job/step records and artifact contents were retrieved successfully; this report does not imply that missing raw log was inspected.

No source/main changes, review requests, manual workflow reruns, provider/domain changes or Work tasks were performed by this verification. This isolated evidence commit preserves the public repository's visibility. PR272 remains completed; other project holds remain unchanged.
