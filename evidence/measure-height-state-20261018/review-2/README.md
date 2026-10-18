# Current-head acceptance: coordinated retry release

Source: `82495d1bdc2d113c8fef740e1346db123e8ff2c4`  
Tree: `e2a746da4ccfff8588a61a507cdfd390e10d98d9`  
Asset token: `20261018-measure-height-state-2`  
PR: https://github.com/c933103/openrailwaystyle/pull/244

## Cache-upgrade review correction

[The second P2](https://github.com/c933103/openrailwaystyle/pull/244#discussion_r4306986290) required a distinct token for the retry-button revision. Every coordinated module/page reference now uses token 2. The preceding token-1 upgrade regression fails before the bump and passes afterward. Both preceding drawing-import and measure-height-state-1 compatibility cases remain covered: exact current app/drawing bytes offline, older-tab isolation, real current explicit retry behavior and coalesced retry clicks, with no shell-cache generation change. Compact compatibility bodies test cache separation without storing duplicate historical production source.

The earlier endpoint-handle fix is unchanged: explicit Retry heights preserves finished distance, geometry and editable point selection; only settled unavailable results can retry. Both review threads have concrete code/test replies. Fresh independent review is still required.

## Final verification

- Final aggregate **2,445/2,445 passed**, zero failures/skips, on Node v24.19.0 / npm 11.9.0, Linux.
- Focused elevation/drawing/cache suite **176/176 passed**.
- Both full-application toolbar tests passed, including rendered handles and independent button wrapping.
- Eight original-versus-final healthy comparisons retain exactly equal GeoJSON/status output.
- Build, committed-style equality, JavaScript syntax and whitespace checks passed.
- All 14 remote code/test/document blobs were verified against local Git identities.
- The new upgrade test's prior-token failure is retained alongside successes. Earlier original/review failures and receipts remain untouched in parent directories and immutable commits.

Commands are the same as the preceding receipt: `NODE_OPTIONS=--max-old-space-size=4096 npm test -- --test-concurrency=1`, the focused drawing/elevation/sw suite, the measurement-toolbar startup subset, `npm run build`, style equality, syntax and diff checks. `manifest.json` binds archive members and final source blobs. Run `node compare-healthy.mjs /path/to/final-checkout` to repeat healthy comparisons with the baseline Git object available.

Local Chromium remains blocked at process startup; no local real-browser pass is claimed. Current-head Codex Code/Security, all applicable hosted browser/CI checks, merge and natural deployment remain separate gates. This record does not certify those pending stages or close broader #136/#112. Provider policy, request/byte budgets, assertions, deadlines, source-acquisition scope and holds remain unchanged.
