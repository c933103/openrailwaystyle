# Current PR274 source evidence

- [Cold-navigation review fix 5818dda](cold-navigation/README.md).
- All earlier stages below remain historical, not current-head acceptance.

---

# Latest PR274 evidence

- [Legend-state repair 807b1e0](legend-state/README.md), preserving clean history and visible terrain.
- Earlier stages below remain historical, not acceptance of the latest source.

---

# PR274 source and validation evidence

- [Combined integration f32cb4a](integration/README.md) with merged terrain/icon main9349183.
- The files below are the historical b5932c2 release-graph repair record.

---

# PR274 clean-history release graph repair

Source: `b5932c2b838aaa2f4021d7563442b660fec39f25`  
Parent: `39fbe0e95b8f98a6a9740cce3989eaf92668bcce`  
Tree: `95b531fc20c73cc056e3f5b2602e2ff0d1322621`

The patch changes only 14 release-token references across nine styles files.
Application URL behavior, worker policy, tests and assertions are unchanged.
The complete literal release graph now has 41 coherent references across 11 files.

## Reproduction and results

- All five original CI failures reproduced before this patch.
- The offline failure is a mixed graph, not a demonstrated worker-policy defect:
  current map-model requested platform-length, railway-visibility and axle-load
  with stale `v=20261026-terrain-3d-1`. The diagnostic records these exact synthetic
  URLs. Temporary logging was reverted before making the source patch.
- Eight focused regressions passed: all five failures and existing stable URL / 
  local persistence, incoming-link / cold-sharing, and display-settings tests.
- The complete service-worker suite passed 78/78, without skips or cancellation.
- Build, unchanged generated style/station data, JavaScript syntax and whitespace
  checks passed on Node 26.12.1 / npm 11.9.0.
- The full local aggregate is **incomplete, not passed**. It emitted 146 passing
  tests, then made no progress for more than three minutes after the final
  controls-painter-batches case. It was interrupted cleanly (exit 130). There
  was no emitted assertion failure. Resource observations are in the manifest;
  the cause is not established. No repeated aggregate was used to claim success.
- Native browser coverage was not run locally because of an existing execution
  restriction. Hosted CI and exact-head review remain required.

`manifest.json` contains the exact commands and per-file SHA-256 values.
`SHA256SUMS` covers this evidence payload. Local checkout paths in logs are
redacted to `<checkout>`; test results are otherwise unchanged.

The separate PR273 touches overlapping app/module/PWA versions and is unchanged
by this repair. Its later integration must reconcile the full release graph and
rerun the applicable checks. This receipt does not claim merged or deployed state.
