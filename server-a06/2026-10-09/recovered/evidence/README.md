# Evidence layout

- `metrics.json` / `metrics.csv`: three uninstrumented baselines plus separate diagnostic
- `raw/run-01` through `raw/run-04`: original metrics, stdout/stderr, timed feed progress and 0.2 s memory/load samples
- `raw/run-04/assembly.cpuprofile`: original V8 CPU profile, not normalized
- `evidence/cpu-profile-summary.json`: sampled-time interpretation with function locations
- `evidence/input-reverification.json`, `final-integrity.json`, `output-identity.json`: all input/reference hashes, archive verification and minimal-retention reconstruction
- `evidence/source-files.json` and `dependency-verification.json`: historical source and dependency metadata identity
- `evidence/environment.txt`: preflight OS/runtime/resources and explicitly unavailable cgroup data
- `evidence/reader-tests.log`, `assembly-tests.log`: focused checks, independent of real-input timing
- `evidence/actions-retention.json`, `current-release-metadata.json`: point-in-time retention and later-release distinction
- `measure_baseline.py`: actual local measurement harness; original input path is configurable in the preparation instructions
- `analyze_results.py`: aggregation and profile attribution

No fixture-based measurements are included in the baseline. Small synthetic inputs are used only by the repository's preflight tests.
