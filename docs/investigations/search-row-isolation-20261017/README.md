# PR241 controlled search-response acceptance evidence

Tested source: [71c4c312058509d377af8d97c21e82fae09fa766](https://github.com/c933103/openrailwaystyle/commit/71c4c312058509d377af8d97c21e82fae09fa766).
Base: `6aa700ac4ed39647c5026a4bad96e46d63e4e1a6`.
Working record: [PR241](https://github.com/c933103/openrailwaystyle/pull/241).

- Final focused model/DOM/selection/cache checks: 210 passed.
- Full-application search/version checks: 5 passed.
- Build, generated-style equality, JavaScript syntax and diff checks: passed.
- Negative reproduction on verified predecessor app/model/harness bytes: 26 failures,
  20 passing controls; the replayable test file and logs are archived.
- Local serial aggregate: 2303 passed, one startup child-process failure. Isolated
  startup replay: 116 passed before the child received SIGKILL. This is not a clean
  aggregate pass and does not establish its cause.
- Installed Chromium could not create its local process socket (Operation not
  permitted), including the supported escalation route. No real-browser acceptance
  is claimed. Hosted full aggregate/browser CI and exact-head review remain gates.

The ZIP preserves initial/expanded/final tests, failed attempts, the negative test,
source patch and hash manifest, Git publication verification and exact commands.
An intermediate selection assertion used a cross-realm array in deepStrictEqual;
its retained failure was corrected with Array.from, without changing product code.
The archive contains no live-provider requests or live outage/coverage evidence.

To replay the initial negative control, check out the base commit, install the
pinned dependencies with npm ci --ignore-scripts, copy predecessor-regressions.test.mjs
from the archive into tests/search-row-isolation.test.mjs, and run it with
node --experimental-vm-modules --test tests/search-row-isolation.test.mjs.
Use the tested source commit for the final commands in manifest.json.

This separate evidence branch is an archive and must not be merged into main.
The application PR contains only source, compact regressions and documentation.
Parent/child issues remain open and held PR157/PR185 scope is unchanged.
