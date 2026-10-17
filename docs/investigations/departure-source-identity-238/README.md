# PR #238 preliminary validation archive

Application head: `5b4422cd32e75762e4eedf02bed1a566905e8b06`.
Tree: `df77d1c9123cb937f58e0447c82cd5df83520a29`.
Base: `3a80f5f75d3ceab72b8b50c0dbe96a8dd8850401`.

The source-verification manifest records all 16 intended changes and 580
unchanged verified files. The temporary checkout omits 177 unrelated historical
investigation files and one logo image; the remote Git tree preserves them.

## Commands and observed results

Node 24.19.0 on Linux, existing pinned dependencies. All inputs are controlled
fixtures. No live timetable or map-provider request was made.

- `node --test tests/departure-source-identity.test.mjs`: final 21 pass.
- Run the same final tests against the base parser: 7 fail, 14 pass. The earlier
  19-case negative control is also preserved.
- `node --experimental-vm-modules --test tests/departure-source-identity.test.mjs tests/sw-install.test.mjs`:
  62 pass. The earlier invocation omitted the VM flag and failed VM tests;
  `focused-upgrade.log` preserves that command error, not a product defect.
- `npm run build`, generated style/station equality, changed-module syntax and
  `git diff --check`: pass.
- `node --experimental-vm-modules --test --test-concurrency=2 tests/departure*.test.mjs tests/train*.test.mjs tests/startup.test.mjs tests/sw*.test.mjs`:
  505 pass, startup subprocess fails. An isolated TAP run explicitly records
  SIGKILL; its cause is not established by that signal alone.
- `node --experimental-vm-modules --test --test-concurrency=2 tests/*.test.mjs`:
  2167 pass, two subprocess failures (departure availability/startup). This ran
  during other concurrent test work. It is not a full pass; coordinated rerun
  and hosted validation remain pending.
- `node scripts/check-departures-browser.mjs`: blocked before browser tests by
  absent default Playwright executable. Retrying with the installed Chromium
  through the supported shared-browser endpoint failed on denied Unix-domain
  socket creation. That access restriction was respected. Neither Chromium nor
  WebKit is claimed passed locally.

The compact application receipt and PR discussion carry current statuses and
later immutable evidence. These logs are historical observations, never replaced
by a later pass. No merge, deployment or worldwide acceptance is implied.
