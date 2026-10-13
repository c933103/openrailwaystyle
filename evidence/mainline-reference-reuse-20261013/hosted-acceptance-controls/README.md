# PR #201 reference acceptance and controls failure

Exact source: 0bc66e1fb0af3f59de40fd5309d00a95b494a976. Reference run 38335157889 and failure-path run 38335157858 passed. Site run 38335157910 attempt 1 failed only the controls group; all five other groups and validation passed. No source changes are included in this evidence commit.

## Original failure

https://github.com/c933103/openrailwaystyle/actions/runs/38335157910/job/115109327002

map-controls timed out at the unchanged 60-second full map-idle gate after desktop detail 1 changed to detail 2. It retained 19 station tiles loading, four pending intercepted requests, no page exceptions or context loss. Preserve this as a real failed result; cause is not established. Fixture route fulfillment latency does not measure browser-body or worker completion. Renderer/event-loop backpressure is an unproven hypothesis.

Downloaded original artifact 11786639499: browser-review-controls, ZIP SHA256 c7b629743cdf3290e337156065cae858de17b437f7f0f3951a350b5b8ddce1be (4,183,254 bytes), verified against GitHub artifact metadata. The original full job log and exact relevant JSON files are retained here. The artifact's map-controls screenshot was absent; no screenshot is invented.

## Unchanged local replay

Linux, Node v24.19.0, Playwright 1.56.1 Chromium 141.0.7390.37; current source files present locally were compared as Git blobs against the exact head, with zero differences. The omitted historical docs do not enter this check. Generated vendor assets were already built from these inputs. A local fixture preview served on loopback port 4191 within the same process environment.

Command: PLAYWRIGHT_BROWSERS_PATH=<installed browsers> MAP_BASE_URL=http://127.0.0.1:4191/ node scripts/run-browser-checks.mjs --concurrency 1 --label controls-baseline-2 check-network-guard-browser.mjs check-map-controls-browser.mjs

Pass: network guard and 83 actual-app layout/state cases; 75 complete idle settlements, worst 2,270 ms, originally failing transition 1,687 ms, total controls 141.3 s. No timeout or assertion change, no provider egress. Initial local setup attempt had an unavailable loopback server and did not exercise the app; it is not counted as a regression replay. A stale failure-only JSON left by that setup attempt is intentionally excluded from the passing replay.

The previous PR head 0e76eaa7ccae97df34b9a3d32aa0217aa31d0d17 passed the same hosted controls in 186.4 s: https://github.com/c933103/openrailwaystyle/actions/runs/38332904542/job/115089733826 . Tree comparison confirms no application, browser harness, style, package/lock, or site-workflow changes between that head and the current head; changed files are the reference workflow, mainline-provenance, plan-mainline-reuse, its tests and reference docs. Historical pass plus a local pass does not replace the failed current-head hosted gate.

## Reference acceptance

Immutable preview commit f20a5aac354c8ceeb14a62fe0bb47394ef062fb6, generation 8b430e70e32c08a25a1c4aac, source date 2026-10-11, 840 actual OSM renderer and 18 app observations. Data input d89f5bc2b5f33bc95a9bf982b732d1ef80284751fabf34a3d2c501e916996779; full input 80d1b7f90cd4f60d2601e4a26de22196cc334f3e9c49456e7fc264ef384d0293; renderer report 4a22c8334b4e0f70ea1a0a78b69f8ea57b5b840541b62fcf092d02395f0bbd04. Both input hashes independently recomputed from matching current source. Current mainline-data remains legacy without dataInputSha256; future automatic renderer-only reuse is not seeded there yet.

## Same-head hosted retry outcome

The specific controls job was retried once without source changes. https://github.com/c933103/openrailwaystyle/actions/runs/38335157910/job/115113428215 passed all eight controls scripts, including 83 map-controls cases in 266.1 s. The 75 idle settlements retained every original condition and the 60-second limit; worst 49500 ms. Site run attempt 2, aggregate browser-checks, and status recording all succeeded; deployment was skipped for the PR. These results demonstrate successful retry, not a diagnosed or repaired root cause. The first failure remains preserved above.

Retry artifact 11787027898 ZIP SHA256 dcf4e9875ec57cdcbcafff0fd2f848e9893aae6eccbe77670a7475d6e6e5031e, 4,334,349 bytes, independently verified. Exact current-head site/browser-checks commit status is success. No source changes, ready-for-review transition, merge or deployment were performed.
