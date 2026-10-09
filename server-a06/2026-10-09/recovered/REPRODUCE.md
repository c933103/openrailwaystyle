# Offline assembly reproduction

The retained fixtures are explicitly sanitized derivatives, not byte-identical original inputs. Do not exercise provider URLs. No acquisition script or workflow dispatch is required.

## Inspect and recompute the supplied observations

From this published evidence directory:

```sh
python3 -B analyze_results.py
python3 -B -O test_reproduce_sanitized.py
```

Analysis reads the supplied `raw/` layout directly and writes new results to `analysis-output/`, preserving the published metrics. Override destinations with `--runs-dir PATH --output-dir PATH` when needed. The reconstruction tests use only owned temporary directories; negative cases also execute optimized Python so checks cannot depend on `assert`.

## Replay the retained offline workload

Use Node.js **24.19.0** to match the measured environment. The historical workflow used Node.js 22, which needs a separately labelled comparison. Git and npm steps below fetch only source code and locked software dependencies, never transport-provider data.

Run from a fresh copy of this evidence directory with no `source/`, `sanitized-inputs/`, `sanitized-snapshot/` or existing `runs/run-01/`:

```sh
node --version
git clone --no-checkout https://github.com/c933103/openrailwaystyle.git source
git -C source checkout --detach 6f43c9f9ca998ea5b3081655b6a43bb29ae51713
npm --prefix source ci --ignore-scripts --no-audit --no-fund
python3 -B -O reproduce_sanitized.py
python3 -B measure_sanitized.py 1
python3 -B measure_sanitized.py 2
python3 -B measure_sanitized.py 3
```

Keep `sanitized-retention/` and `sanitization-manifest.json` in the supplied layout. The reconstruction helper checks all manifest read paths, exact archive/member sets, sizes, hashes and reference-tar digest before writing outputs. It rejects unsafe paths, symlinks, duplicates and unexpected members even under `python -O`. Existing `evidence/` remains intact. The helper reconstructs 121 input and 117 expected files.

Each replay creates a fresh source/input copy and Node process, then runs the historical assembly command under the recorded bounds. Inspect `runs/run-01/metrics.json` and subsequent runs for exit status, CPU/RSS/wall measurements, output hashes and coverage. Do not pool these sanitized replays with the original raw-input observations.

## Interpretation

- Original historical runs 01–03 are the uninstrumented baseline; run 04 is instrumented.
- Run 05 checks the separately pinned current-code closure.
- Retained raw/run-07 is the final derivative correctness replay. An earlier derivative trial is excluded.
- Compare derivatives only with their equivalently sanitized expected snapshot. Original archives remain unpublished because their metadata contained possible access values.
- Future dates may change availability through `Date.now()`. Preserve raw differences and disclose expiry-driven mismatches. A later A/B optimization experiment should control reference time explicitly and report that instrumentation.
- This baseline establishes no performance improvement. Warm filesystem caches, uncontrolled background load and the Node-major mismatch remain limitations.
