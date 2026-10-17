# Hosted validation addendum

Recorded after all first-attempt PR workflows completed on 2026-10-17.
Application head: `84c0258018e5223f852cd273feaa1264efa2a7e0`.
CI merge commit: `193b1b53b9ed9ca35270eae64157cbae9a23873e`.
Both Git trees are exactly `277fc2268b4f5abe8ee61dc3d3648b900c2a742e`;
the hosted checks therefore cover the submitted application bytes.

## Terminal results

- [Site validation](https://github.com/c933103/openrailwaystyle/actions/runs/39063992027):
  **success**, attempt 1, completed 20:15:42 UTC. The aggregate reports **2,370
  passed, zero failed/skipped/cancelled**, 108.094 seconds. Four additional offline
  station-search/CORS fixture tests also pass. Reproducible style, JavaScript syntax
  and retained-reference completeness checks pass.
- All **six real-browser matrix groups** pass: controls, context, infrastructure,
  platforms, frequency and rail-fixture. The 28 matrix scripts return code 0;
  the controls job's separate WebKit installation-help check also passes.
  Browser-check aggregation and result recording pass. PR deployment is **skipped**.
- [Worldwide reference acceptance](https://github.com/c933103/openrailwaystyle/actions/runs/39063991985):
  **success**, attempt 1. It reuses complete generation
  `8b430e70e32c08a25a1c4aac`; extraction is skipped. Actual retained-data
  renderer acceptance passes 840 reference samples plus 18 application samples.
  The reported 346 ms median / 1,321 ms p95 are this acceptance run's observations,
  not a new acquisition or a performance claim.
- [Controls-painter diagnostic](https://github.com/c933103/openrailwaystyle/actions/runs/39063992119):
  **success**, attempt 1. All seven nonempty output comparisons have zero changed
  bytes, including cold/warm terrain output. Dispatch-equality checks pass.
  One repetition per arm does not establish a performance improvement.

## What is retained

`workflow-results.json` records exact workflow IDs, head, attempts, terminal
statuses, source-tree equivalence and every site job/step (including skips).
`artifacts.json` records the ten GitHub artifacts with their published digest,
size, head, links and expiry. Those original Actions artifacts are time-limited.

Eight browser/diagnostic ZIPs were downloaded and their SHA-256 digests matched
the Actions metadata. This evidence branch retains:

- The **complete, byte-identical** controls-painter diagnostic ZIP and worldwide
  reference diagnostic ZIP, including their screenshots, raw JSON and any logs.
- `browser-result-jsons.zip`: all **37 JSON/log/text members** from the six site
  browser artifacts, with their original bytes. `preserved-members.json` records
  each original archive/member, retained member name, byte count and SHA-256.
  The six site screenshot collections remain in the original Actions artifacts;
  they are not duplicated here.
- `browser-checks.json`: the exact 28 per-script exit codes and elapsed times.
- Timestamped execution excerpts for all six browser groups, plus site validation,
  reference acceptance and painter excerpts. These are explicitly excerpts, not
  claims that the full hosted job logs were archived.
- `retained-files.json`: byte counts, SHA-256 and Git blob IDs for the retained
  hosted files (excluding that self-referential manifest).

The 632 MB assembled site and 279 MB reference-generation artifact were not
downloaded or duplicated for this receipt. Their published metadata is retained.
No historical acquisition metrics are presented as new downloads.

## Boundaries

The local Chromium launch limitation in the initial receipt remains accurate.
Hosted checks now supply real Chromium/MapLibre and selected WebKit coverage
under the repository's synthetic external-provider guard. The new elevation-gap
regression itself runs the actual controller/SVG with JSDOM and synthetic terrain;
this is **not** a claim of a dedicated real-browser partial-profile scenario.

These checks establish fixture rendering integration and retained reference
acceptance, not live provider availability, worldwide coverage, provider policy
approval or deployed production behavior. No new public tile benchmark,
acquisition dispatch, network/VPN change or domain activation was run.
Review, security assessment, readiness, merge and deployment remain independently
owned gates; this addendum does not attest to their completion. No source changes,
test weakening or workflow reruns were needed after hosted execution.

