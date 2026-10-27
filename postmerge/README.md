# Postmerge reference acceptance timeout

Merge commit: `c53f80dc1043f39a2666fc0f3f77b04cbe87d889`; tree
`915749402711b586bd95723a1f76ea544f67d757`, identical to the reviewed and
PR-tested tree. This record does not replace the passing PR-stage results or
claim production deployment.

Reference run [40462211306](https://github.com/c933103/openrailwaystyle/actions/runs/40462211306),
attempt 1, cancelled at its existing 90-minute limit in assemble job
[122049285403](https://github.com/c933103/openrailwaystyle/actions/runs/40462211306/job/122049285403).
Browser installation finished at 06:38:48 UTC, the local server started at
06:38:49, and cancellation was logged at 08:07:59. No assertion failure was
emitted. Cleanup terminated remaining WebKit processes.

The original diagnostics ZIP is preserved byte-for-byte as
`reference-timeout-diagnostics.zip` (SHA-256
`a3164b2b45f71eb03a22c6a9852ebdba21be8669b594e1d39c6b19c3ab83a0c3`).
Its only three files are:

- `browser-review/mainline-desktop.png` (06:40:42 UTC, 14,630 bytes).
- `browser-review/mainline-android.png` (06:42:18 UTC, 9,974 bytes).
- `mainline-output/manifest.json` (the previously accepted input generation).

The checker writes those screenshots after each profile's assertions and runs
Safari third, before loading the actual Atlas application. This narrows the
stall to the Safari-profile portion; its exact pending operation/cause is not
established. There is no Safari screenshot, failure JSON, or completed acceptance
report. The checker, browser harness, reference reader and pinned renderer are
unchanged by PR274; this is not evidence of a dirty-URL assertion failure.

After verifying main and the failed run still identified the merge commit and
no retry existed, only the cancelled assemble job was retried once. Attempt 2
job 122080108313 is running as of 08:11 UTC. No source, assertions, timeout,
provider policy, or data acquisition scope was changed. Site run 40462211289
continues its normal matching-reference wait. Final deployment and published
rendering/source checks remain pending.
