# Client trace status, 9 October 2026

The first isolated runner [37906825692](https://github.com/c933103/openrailwaystyle/actions/runs/37906825692) produced all six trace files and passed real HTTP-cache controls, but correctly failed the final unknown-request guard. Its control page automatically requested `/favicon.ico`, which this fixture did not serve. Application samples had zero page/console errors and passed rendered railway geometry. They remain provisional because the overall run failed.

The correction is confined to control-page HTML and its regression: an explicit data favicon prevents the unintended request. The strict final guard stays unchanged. Seventeen local transport tests pass. The same approved network-disabled workflow will validate the corrected harness; application code, fixture geometry, timing/readiness definitions and runner configuration are unchanged.

The original 2,058,572-byte ZIP was downloaded and independently matched Actions SHA-256 `a29af124673c985b705fc6c7f23e4a8dce27628ae27289bc5820321494cd9ae2`. All 56 files remain locally preserved. **Durable repository archival of that ZIP is not complete:** its original upload remains pending/unknown, and no alternative payload or route is being used for it. The [Actions artifact](https://github.com/c933103/openrailwaystyle/actions/runs/37906825692/artifacts/11604937383) currently expires 8 November 2026.

See `first-run-status.json` for exact acceptance and limitations. There is no application speedup, phone/GPU-memory improvement or live-provider saving claim.
