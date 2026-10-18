# Review correction: explicit endpoint-height retry

Exact source: `d10f5ee8138c77f69945fb73827f1b29f4e71d52`  
Tree: `5283ad904068b805479e397f3ede645f9afea1f7`  
Previous code: `c9b70df212e65ab2c88c3aa4f542ae8c40c88388`  
PR: https://github.com/c933103/openrailwaystyle/pull/244

## P2 correction

[Codex correctly found](https://github.com/c933103/openrailwaystyle/pull/244#discussion_r4306958315) that the earlier identical-endpoint retry tests omitted rendered editing handles. Clicking those handles intentionally selects a point and cannot reliably mean “start over”. This correction preserves that editing contract and adds an explicit **Retry heights** action for a finished measurement with unavailable heights. It retains distance, geometry and point selection; repeated clicks while pending do not add requests, successful heights are not retried, and close/clear remove the action. The button wraps independently of the existing editing group. Status text and the user guide describe the actual recovery action.

## Verification

- Three new review regressions failed against the prior implementation: **0 passed / 3 failed**. The failure log is retained.
- Final focused elevation/drawing/cache suite: **175/175 passed**.
- Both actual-application toolbar tests passed, including rendered-handle selection and repeated explicit retry. The final layout assertion also passed.
- Final-source aggregate: **2,444/2,444 passed**, zero failures/skips, including both toolbar tests. Command: `NODE_OPTIONS=--max-old-space-size=4096 npm test -- --test-concurrency=1`. Node v24.19.0, npm 11.9.0, Linux.
- Eight baseline-versus-current healthy comparisons retain exactly equal rendered GeoJSON/status text across both unit systems and rising/falling/zero/below-sea-level heights.
- Build, committed-style equality, syntax and whitespace checks passed on final source.
- Local Chromium startup remains blocked as documented in the preceding evidence receipt. Hosted browser checks and fresh exact-head Code/Security reviews remain separate required gates. This archive does not claim review, merge or deployment acceptance.

## Archive

`manifest.json` binds all final code/test/document Git blobs and raw archive members by SHA-256. `logs.zip` retains review-negative, focused, toolbar, build and aggregate attempts; the earlier 2,444-test run before the final independent-wrapping assertion is also retained separately. The original 18-failure reproduction and earlier-head evidence remain untouched in the parent directory and its immutable commit.

Run `node compare-healthy.mjs /path/to/final-checkout` with the baseline Git object available to repeat the healthy-output comparison. The negative review cases can be replayed with the final tests and prior-head application/drawing/page sources, selecting `explicit height retry|failed explicit retry|retries heights with existing`.

No test threshold, timeout, request/byte budget, provider/transport policy, source-acquisition scope, repository visibility or held work changed. All requests in these local regressions used synthetic loaders. Broader #136/#112 remain open.
