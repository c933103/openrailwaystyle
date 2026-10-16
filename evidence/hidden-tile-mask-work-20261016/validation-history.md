# Validation history

Node 24.19.0, existing pinned dependencies. All commands run at the repository root.

- Build: `npm run build`, then `git diff --exit-code -- styles/world.style.json`: pass on v1/v2/v3.
- Initial parallel checks: SIGKILL subprocess outcomes, not accepted.
- Revision 1 serial aggregate: 1,892/1,892 pass, zero skips, 351.7 s.
- Revision 2 serial aggregate: 1,891 pass; startup file SIGKILL; 377.6 s.
- Revision 2 startup with heap512: stopped after an unintended example.org request; no final exit recorded. No unchanged retry.
- Revision 3 startup with heap512: explicit V8 heap OOM/SIGABRT, 47 pass before failure; 27.5 s.
- Revision 3 final serial aggregate, ordinary heap: 1,895/1,895 pass, zero skips; 295.7 s.

Serial aggregate command:
`node --experimental-vm-modules --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs`

Bounded-heap diagnostic command:
`NODE_OPTIONS=--max-old-space-size=512 node --experimental-vm-modules --test --test-reporter=tap tests/startup.test.mjs`

Targeted final independent offline/install/restoration command:
`node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='startup (network guard|native-realm)|application (guards|installs)' tests/startup.test.mjs`

Independent unchanged-production checks: 28 guard/painter/probe, 2 startup/restoration and 1 executable cache-upgrade pass on v2; final v3 only changes the offline startup harness. V3 four targeted tests pass independently. No prior failure is relabelled or erased.

Original full-log SHA-256s (selected excerpts or exact narrow logs are archived alongside):

- `81779cfa836e26c1a5418570ce47c55bc334d3f20cc5cab31390b6485413a968`: `evidence/full-suite.log`
- `b111db4d0f1677699c4d4f2c3be2f7eeecca6def7f8576abc23bc5230b0ddee2`: `evidence/startup-alone.log`
- `3a123e2e4e4d0ae5aab2d53647c50f08eb32ba8371c9c2377fd26e3448f819d5`: `evidence/full-serial.log`
- `9067ce408395697b00d90b6136f2bbdf33b5fdff8e4bc1c51842c650238a9318`: `evidence-v2/full-serial.log`
- `7de39c976263dd128dfb651dca09329a89b9addb9e71ac242c2456439f9ad1ea`: `evidence-v2/startup-heap512.log`
- `caa0b439bbb6fef154456165d7498e2de6d115a6cdb4f709434090bc9402f80f`: `evidence-v3/startup-offline-heap512.log`
- `b60baf4c014772f7d8af353465d2c9166c3587e88885b974fa55ffc9da6e6bf7`: `evidence-v3/full-serial.log`

Local current-candidate WebGL tests remain unrun: the pinned browser is absent and the installed browser aborted at socket creation. Hosted seven exact nonempty pixel/dispatch comparisons and unchanged 60-second idle acceptance remain binding.
