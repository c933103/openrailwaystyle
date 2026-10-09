# Reconstruct and replay the new A06 cohort

These are newly written helpers and a newly packed reference, not recovered original artifacts. The earlier recovery remains **57/83**. This bundle uses the eight durable sanitized ZIPs already stored under `server-a06/2026-10-09/recovered/`; it does not duplicate them. Never exercise metadata URLs as download links.

## Validate and replay

Use a fresh working directory. Source and npm steps retrieve code/locked software, not provider data. The measured runtime was **Node.js 24.19.0**; historical CI used Node.js 22, which was unavailable on this host. Record any different runtime as a distinct cohort.

```sh
git clone --single-branch --branch evidence/atlas-baseline-2026-10-08 https://github.com/c933103/openrailwaystyle.git atlas-evidence
cd atlas-evidence
REPO="$PWD"
BUNDLE="$REPO/server-a06/replay-2026-10-09a"
SOURCE="$REPO/../atlas-a06-historical"
WORK="$REPO/../atlas-a06-replay-work"
git fetch origin 6f43c9f9ca998ea5b3081655b6a43bb29ae51713
git worktree add --detach "$SOURCE" 6f43c9f9ca998ea5b3081655b6a43bb29ae51713
npm --prefix "$SOURCE" ci --ignore-scripts --no-audit --no-fund
NODE="$(command -v node)"
"$NODE" --version
python3 -B "$BUNDLE/test_replay_bundle.py"
mkdir "$WORK"
python3 -B "$BUNDLE/pin_replay_identity.py" --cohort my-distinct-replay --source "$SOURCE" --dependencies "$SOURCE/node_modules" --node "$NODE" --bundle "$BUNDLE" --output "$WORK/identities.json"
python3 -B -O "$BUNDLE/replay_bundle.py" --bundle "$BUNDLE" --fixtures "$REPO/server-a06/2026-10-09/recovered" --destination "$WORK/reconstructed"
for ID in check-01 repeat-01 repeat-02 repeat-03; do
  python3 -B "$BUNDLE/measure_replay.py" --identity-manifest "$WORK/identities.json" --source "$SOURCE" --dependencies "$SOURCE/node_modules" --reconstructed "$WORK/reconstructed" --bundle "$BUNDLE" --work "$WORK/runs" --artifacts "$WORK/observations" --node "$NODE" --run-id "$ID" || exit 1
done
```

The first run is a correctness/calibration check; keep it separate from repeated timings. Each run refuses an existing run ID and copies fresh source/input files. The supplied `historical-02` through `historical-04` form this bundle's three-run baseline; `historical-profile` is separately instrumented. Reproduce profiling with a new run ID and `--profile`. Do not pool a different host/runtime, a changed harness, or instrumented runs with those three observations.

The helper validates archive hashes before reading members, rejects unsafe paths/symlinks/duplicates/unexpected types and manifest-inconsistent sizes, bounds TAR expansion, and validates all inputs/reference bytes before writing. Its explicit checks remain enabled under Python `-O`. Tests run only in their owned temporary directories.

The final measurement helper also verifies source, complete installed-dependency tree, Node binary and replay-manifest identities before launch, plus every copied input identity. `pin_replay_identity.py` first requires the historical source digest and matching locked package versions, then records a distinctly named local cohort. This avoids requiring another machine's exact Node binary or installed-module fingerprint. The published initial timings used the retained `measure_replay_executed_v1.py`, with separately labelled retrospective provenance receipts; the current-code check used retained v2. Their original measurements were not rewritten when receipt controls were strengthened.

## Recompute supplied summaries

```sh
python3 -B "$BUNDLE/analyze_replay.py" --runs-dir "$BUNDLE/runs" --output-dir "$WORK/analysis"
```

This reads the supplied logs and writes new summaries outside the evidence. Raw measurements and generated output identities remain unchanged.

## Interpretation and bounds

- Child limit: 1,536 MiB Node old-space, 2,048 MiB sampled RSS guard, 300 s wall guard, 300/305 CPU seconds and 256 MiB individual output-file limit. No production setting is changed.
- `wait4` supplies child user/system CPU and peak RSS. Wall time uses a monotonic clock; completion is polled every 250 ms, so it includes up to one polling interval of detection latency. Preparation and final hashing are outside the measured interval.
- Filesystem caches are warmed by copying and hash checks. These are fresh-process/fresh-copy runs, not cold-cache runs. Shared-host load is observable but uncontrolled; this is not a production-capacity result.
- The original program's `Date.now()` remains unchanged. `availableSegments` and `routesWithProfiles` depend on the current time and feed validity/review limits. Future expiry can cause genuine manifest differences. The harness preserves raw outputs and rejects a mismatch rather than silently stripping fields or replacing expected data.
- Optional per-process I/O-byte counters remain unavailable; a previously denied source was not retried through another route.

Original raw output trees are retained in the local replay work directory while measuring. Publication retains identities and exact logs rather than redundant copies of the 117-file trees. Shared feed bytes can be reconstructed from the durable sanitized ZIPs; the new reference pack contains only the three additional metadata files.
