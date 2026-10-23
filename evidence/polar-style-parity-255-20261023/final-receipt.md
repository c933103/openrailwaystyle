# Final exact-head verification

Source: `610763a00a5854d54ff717d8916452654a61f2b9` (tree `0e94f59c28ffac5526aac46cf3395216760b80e9`).
Captured: 2026-10-23T09:48:45.811Z.

- Hosted unit suite: **2,665 passed, zero failures, zero skips**; build, committed-style reproducibility, syntax and offline search checks passed.
- All six hosted browser groups passed: rail-fixture, context, controls, infrastructure, platforms and frequency. Both polar checks passed in both hemispheres, including exact overlap pixels on both sides of the 85.05° boundary.
- Worldwide reference/provenance and controls painter diagnostic workflows passed. Required `site/browser-checks` commit status is `success`.
- Code and security review both completed with no findings on this exact head; zero unresolved inline review threads.
- All ten local development-guide browser checks and all 38 targeted polar unit tests passed. The local aggregate had one existing root-permission skip; the hosted suite ran all 2,665 successfully.

Full workflow/job conclusions and review state are preserved in [hosted-results.json](hosted-results.json). Local logs, timings, negative controls and retained earlier failures remain in [local-validation.tar.gz](local-validation.tar.gz), with [SHA-256 manifest](manifest.json). The archive was fetched back from Git and matched SHA-256 `f6806ed6d39dc7975248b4eda44d9f4eab8f24d42c95af00ce494a5587b83cc4`.

The infrastructure job's Chromium installation was slow and subsequently completed without changing any gate. No check or assertion was weakened. The PR remains **open and unmerged**; no deployment is claimed.

- [Controls painter diagnostic](https://github.com/c933103/openrailwaystyle/actions/runs/39931287310)
- [Build worldwide OSM railway reference](https://github.com/c933103/openrailwaystyle/actions/runs/39931287447)
- [Validate and deploy world railway map](https://github.com/c933103/openrailwaystyle/actions/runs/39931287433)
