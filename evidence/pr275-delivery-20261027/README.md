# PR275 delivery evidence — 2026-10-27

Reviewed head: `43b6894cea51cf8fa38aab226b7e2b53bd6ef9ba`.
Merge: `3efa308cb0ac088c6319fe7d73b8aa93647485ea`.
Reviewed/tested/merged tree: `a2eea3a81ea3ee510df500ef30d1cebfb259024e`.
Base: `c53f80dc1043f39a2666fc0f3f77b04cbe87d889`.

Exact-head Codex review6438068506 was clean. PR site40472944665, reference40472944660 and controls40472944675 succeeded. Actual merge reference40491775242, original site40491775159 and naturally dispatched successor40498029418 all succeeded. No manual dispatch or source change was needed. Actual merge validation passed2747/2747 tests; both site runs passed all six browser groups, deployment, deployed vector-byte verification and published renderer acceptance.

`live-source-first.json` and `live-source-final.json` compare13 changed first-party source files byte-for-byte to the merge, plus exact embedded commit/source URL/release `20261027-terrain-pitch-2`. This is source identity evidence, not a live reproduction of the reported Himalaya scene.

Original PR and merge context artifacts independently report60° same-camera3× versus1×:53,981 changed/42,610 significant pixels; raw signed sea−875m and land340.89453125m. Native82° fixture allows max85° and near/far LOD11.0684/4.3860. Source/test evidence verifies activation60°, manual max85°, LOD above65°, late/replaced-source lifecycle, disclosed3× default/1× option, and96 completed cached tiles per source—not a hard active-tile limit. Synthetic pixels do not establish real-world Himalaya visual acceptance.

Original published renderer artifact contains840 reference samples and18 actual-app samples; successor likewise840+18, generation `87e1693d26bcf4231da89209`, median340ms/p95 894ms. Large original JSON is losslessly gzip-compressed. Fixture summary is explicitly a selected-field extract; full artifact remains linked below.

Original artifact SHA256 identities:

| Artifact | ID | SHA256 |
|---|---|---|
| PR context |12719768393|14f5d7a0a8ae8a6facb84512532004113b597c843c5c7ca3812943ba95ee9f25|
| Merge context |12731009545|cc7ced505b0ee7db982d7a2472481e11d47cf5501d3fa8edb431158744cf2150|
| Merge reference diagnostics |12731002457|268dc318313c0869c43a6e9b2e473a482ced25b5c6e8f5c98b198013b4fbcecb|
| Original published map |12732966968|46f34e02cbe0c379d35cd7c61f42bdfe6ad647098e5032fc7f28953c864ef807|
| Successor published map |12735060855|76fd3dca9ec84aab67691814f9c5af49d115d87bbd0e61168fd4aa4c47c67dc0|

All listed ZIPs were downloaded and their digests verified. `.log` files are labelled relevant-line extracts, not complete raw logs. Original deployment decoded-log retrieval twice returned Transport closed; terminal step metadata, original artifact bytes and independent live checks support deployment claims instead. Reference delay was browser dependency installation (completed11:35), not a demonstrated renderer hang; acceptance passed11:41.

Run URLs: https://github.com/c933103/openrailwaystyle/actions/runs/40491775242 , https://github.com/c933103/openrailwaystyle/actions/runs/40491775159 , https://github.com/c933103/openrailwaystyle/actions/runs/40498029418 .

Verify the retained files using `sha256sum -c SHA256SUMS` from this directory.
