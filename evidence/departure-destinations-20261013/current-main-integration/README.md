# PR 200 current-main integration acceptance

Source commit: a432422c4cb5f24beebb54599544d276d4f28ea7
Source tree: c2cf035e0cc7d44cd2cf056a82096c9cfbea4618
Parents: 6e5fb1d50e5c2ac8247fdd7b00784e05f7cec837 and 089a652ad3fab9aa2cc51dbce5cb714883a524ce
Date: 2026-10-13 UTC

This is a non-force, two-parent integration of the clean numbered-destination fix with merged PR 201. The changes have disjoint paths. The complete remote tree was verified as the exact 698-blob union: current main plus the original PR 200 changes, with no application, fixture, workflow or assertion edits. Local validation used 449 byte-matched materialized source and fixture files; the 249 historical investigation archive files remained remote and were preserved by the Git tree.

## Local acceptance
Node.js v24.19.0 and the existing package-lock-bound dependencies.
- node --experimental-vm-modules --test tests/departure*.test.mjs tests/mainline*.test.mjs tests/startup.test.mjs tests/sw-install.test.mjs: 413/413 pass, no skips.
- npm test: 1546/1546 pass, no skips.
- npm run build: pass.
- git diff --exit-code -- styles/world.style.json: pass.
- node --check for styles/app.mjs, styles/departures.mjs and scripts/plan-mainline-reuse.mjs: pass.
- git diff --check: pass.

## Reference-plan integration
The actual current planner was invoked with event pull_request and production manifest pinned at 6238b333143a8061e171346e009b0cb1b1e6cfd1. It returns reuse=true, preserving source date 2026-10-11 and generation 8b430e70e32c08a25a1c4aac.
Data input SHA256: d89f5bc2b5f33bc95a9bf982b732d1ef80284751fabf34a3d2c501e916996779
New full acceptance input SHA256: b79a2ff61780ddcd3714d0063219d0ffcce39775745bbda9545173ac7dad5059
Previous production full digest: 80d1b7f90cd4f60d2601e4a26de22196cc334f3e9c49456e7fc264ef384d0293
The data digest equals the production manifest, while the full acceptance digest differs, so old renderer acceptance cannot satisfy current site readiness.

## Limits at publication
Exact-successor Codex review, fresh hosted reference acceptance and site/browser CI are pending. Local combined-tree browser checks were not rerun. The historical predecessor's hosted Chromium/WebKit passes remain evidence for that predecessor only. No manual workflow dispatch, provider acquisition or merge to main was performed. The normal branch update triggers current combined-tree CI.
