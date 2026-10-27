# Combined clean-history and visible-terrain integration

Commit `f32cb4aac43f797d0f870cb9cfc054dfb17f15f0`, tree
`cdb3a3143146d463edc287286f6876073292b1a6`, merges PR274 repair
`b5932c2b838aaa2f4021d7563442b660fec39f25` with main/PR273
`934918385a85eca0fa5fc4a47d2ada67bd393050`.

The combined runtime has release `20261027-clean-history-3d-1` and shell 52.
All 41 literal version references across 11 files agree. The complete terrain
control, error reporting, native-height semantics and existing pixel checks
are preserved; no assertions were weakened. The terrain CSS, pixel checker,
terrain-unit tests and rendering docs match merged main byte-for-byte.

A new integration test covers terrain zoom/pitch transitions at a polar center,
unchanged URL/history state, local view persistence and exact current shared
camera/settings. It passes on the combined source and fails on main's prior
app because that app adds a dirty map fragment. The negative control is not
part of the committed application.

Final source: 9/9 startup-focused tests and 86/86 service-worker/terrain/globe
tests pass, with no skips. Build, generated-data equality, syntax and whitespace
checks pass. The commands, source and patch hashes are in `manifest.json`.

The earlier 2,732/2,732 hosted unit result for b5932c2 is historical only.
Fresh exact-head hosted aggregate, fixture-browser checks and review are required
for this combined source. No new local aggregate or native-browser pass is claimed.
Local checkout paths in logs are redacted to `<checkout>`.
