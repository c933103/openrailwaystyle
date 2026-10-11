# PR173 deployment verification

Merged source `4408eaf2402d9c5a6639b97e400c0cabcfacb85e`, tree `475b514b01bb7acea579a16c8b2525440a66f6b1`, deployed by [run38100980805](https://github.com/c933103/openrailwaystyle/actions/runs/38100980805) to [Railway Atlas](https://c933103.github.io/openrailwaystyle/).

- Final-head Code review6104016103 and normal PR CI38100263380 passed. All seven findings have individual replies and resolved threads.
- Post-merge native tests passed1,044/1,044. Browser acceptance reused the identical tree and data key81975fc6a8ad697d12077eefdd6b9a6b; the six-group matrix was not rerun after merge.
- Six deployed tile-byte/encoding comparisons passed. The published page used actual first-party assets and synthetic provider responses for its real-renderer fixture, which passed rail visibility, request-sharing and recovery checks. No public OpenRailwayMap tile benchmarking occurred.
- Eight independently fetched served files exactly match the merged source/build, including index, application, generated style, curated station points, commit-labelled bundle and pinned MapLibre JS/CSS plus PMTiles. Hashes and sizes are in served-assets.json.
- The original published-map-review artifact is preserved in parts at most50,000bytes. Concatenate them in lexical order and verify manifest.json before extracting. Its full SHA-256 and all ZIP entry CRCs were checked; it includes screenshots and request evidence.

`verify-served-assets.mjs` is the exact independent replay script. Place it alongside a checkout named `source`; build that checkout at this merged tree with `GITHUB_SHA=4408eaf2402d9c5a6639b97e400c0cabcfacb85e GITHUB_REPOSITORY=c933103/openrailwaystyle npm run build`, then run the script. It compares fetched bytes rather than substituting local assets into the browser.

All original failed controls, timing runs and corrected harness runs remain in the earlier evidence directories. Curated/regional overview is not complete worldwide station coverage (issue175). Regional/IVS font guarantees and the authentic fifth backdrop remain outside this acceptance. Selected-name lookup has five logical tile candidates, with existing language fallbacks; it is not a hard five-wire-request cap.
