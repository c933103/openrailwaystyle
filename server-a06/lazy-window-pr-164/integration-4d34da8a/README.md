# PR164: current-main integration and retained timeout evidence

Head `4d34da8a3d06e83b7c979bd882c4725d3cebbd7a` is a normal merge with parents `a313a22babd444ec93069234ca769f438b083ffc` and current main `6c5fbb21ed86b0437f1bf2d6caca8819781e67f2`. It preserves the two-file optimization/test delta and source SHA256 `98617ff13c34fec98c9cc9ab6b3745f4b5456ff08b02cf43505dfb4a56bcf65e`.

All 326 tracked files in its tree `022a4b8cdc6d42ecb96da5969fe27217e4932fde` match the combined tree already validated by 848 tests, build, syntax and generated-output reproduction. A fresh correctness-only assembly at this integrated tree matches all 117 expected sanitized outputs from the 121 frozen prepared inputs. Its new receipt and exact output identities are included. No new performance result is claimed; the earlier measured cohort stays unchanged.

The preceding site run [37897297312](https://github.com/c933103/openrailwaystyle/actions/runs/37897297312) failed a 30-second mobile packaged CJK-font readiness check at `scripts/check-platform-stations-browser.mjs:105`, after all desktop/mobile station geometry assertions passed. The cause remains unestablished; the test was not weakened or skipped. `platform-failure.raw.log` retains the exact public Actions job-log text returned for job 113712464511, including GitHub's original masking. Screenshot archive 11601292244 could not be materialized (HTTP403); its digest is the value reported by Actions, not a locally verified archive hash, and screenshot pixels have not been inspected.

Integrating reviewed current-main browser assets gives fresh normal CI a chance to test the actual combined tree. This is not evidence that the old timeout was harmless or that a particular asset change caused it. If it recurs, the shared font/test path still needs diagnosis. Fresh CI and exact-head Code/Security review remain required on [PR164](https://github.com/c933103/openrailwaystyle/pull/164).

Original recovery remains 57/83 with 26 missing. This snapshot adds correctness and failure evidence only.
