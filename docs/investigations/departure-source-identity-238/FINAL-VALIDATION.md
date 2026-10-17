# PR #238 final exact-head validation

Application head: `5b4422cd32e75762e4eedf02bed1a566905e8b06`.
Application tree: `df77d1c9123cb937f58e0447c82cd5df83520a29`.
Base: `3a80f5f75d3ceab72b8b50c0dbe96a8dd8850401`.
Observed 2026-10-17 at 06:51:59 UTC. Application source has not changed since review.

## Passed acceptance

- [Hosted site workflow](https://github.com/c933103/openrailwaystyle/actions/runs/39009813758):
  succeeded on this exact head. Node 22, `npm test`: **2,229/2,229 pass**,
  zero failed/cancelled/skipped. Offline station checker: **4/4 pass**.
- All six required fixture-safe browser groups succeeded: rail-fixture, controls,
  platforms, frequency, context and infrastructure. The combined browser-checks
  gate and result-recording job also succeeded.
- The new production-parser/renderer/cache regression passed in **Chromium and
  WebKit**, covering both board orders, distinct same-source instances,
  same-instance duplicates, different-source duplicates, expired cancellation
  isolation and cached reopening. Existing ambiguity, cancellation freshness,
  source-failure and destination controls also passed.
- The exact-head [reference workflow](https://github.com/c933103/openrailwaystyle/actions/runs/39009813949)
  and [controls painter workflow](https://github.com/c933103/openrailwaystyle/actions/runs/39009813828)
  succeeded.
- [Codex Code and Security review](https://github.com/c933103/openrailwaystyle/pull/238#issuecomment-6230687986)
  completed for the full exact head with no findings. No review threads remain.
- Local final focused identity suite: **21/21 pass**; same tests with the base
  parser: **7 intended failures, 14 passing controls**. Identity plus immediate
  predecessor service-worker upgrade command: **62/62 pass**.
- Independent review verified the MOTIS v2.10.2 envelope and whole-group veto,
  independently ran the 21 tests and 36 additional runtime controls. The parser
  has not changed afterward. See `independent-review.md`.

## Preserved local limits and scope

The earlier logs remain intact in this archive. The first local aggregate had
2,167 passes and two subprocess failures; the isolated startup log records
SIGKILL. Its cause is not proven by that signal. That run is **not** a full local
pass; the clean exact-head hosted aggregate supplies aggregate acceptance.
Local browser startup was blocked by a missing default executable and a denied
Unix-domain socket with system Chromium. Those local attempts remain failed;
the two browser engines passed on the hosted fixture runner.

The original preliminary README records the state at publication. This receipt
supersedes its pending hosted-validation status without replacing its failures.
`hosted-ci.json` records exact-head workflow/job/review results.
The two hosted log files are labelled excerpts, selected from their linked
successful jobs; they are not the complete logs.

The PR fixes a controlled reproduction of distinct trip instances collapsing.
Broader #113/#129 requirements, #157 pause, #174/#185 gates and provider-download
restrictions remain. This does not establish complete worldwide coverage,
live-provider availability or physical-device acceptance. The PR deploy job was
correctly skipped. Merge and deployed-site verification are separate and remain
with the parent task.

## Source digests

- `styles/departures.mjs` SHA-256:
  `93f40a87dad36e8bd2280d45d7eb90fa875d1507244bb7683d4b719f34787f7b`
- `tests/departure-source-identity.test.mjs` SHA-256:
  `061ee4a70502747a8d23b941e349aaa76bcc58d1c88426c2c8029b33ecaad6ac`
- `scripts/check-departures-browser.mjs` SHA-256:
  `a8bfb213416a2cb849bb577e5afdbc7f978fc6fa76f9447f00040665c63a0dad`
