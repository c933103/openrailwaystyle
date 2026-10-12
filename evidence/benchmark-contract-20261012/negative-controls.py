#!/usr/bin/env python3
"""Offline migration controls. Run from a checkout of the source commit in receipt.md."""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile

root = Path.cwd()
paths = [
    'tests/timetable-matching.test.mjs', 'scripts/timetable-matching.mjs',
    'scripts/timetable-timezones.mjs', 'scripts/benchmark-timetable-matching.mjs',
    'scripts/gtfs-frequency.py', 'scripts/timetable_evidence.py',
    'scripts/benchmark-timetable-evidence.py',
    'tests/fixtures/service-frequency/timetable-observation-semantics.json',
]
with tempfile.TemporaryDirectory(prefix='atlas-benchmark-contract-') as directory:
    work = Path(directory)
    for path in paths:
        target = work / path
        target.parent.mkdir(exist_ok=True, parents=True)
        shutil.copyfile(root / path, target)
    originals = {path: (work / path).read_text() for path in paths}
    matcher = work / 'scripts/timetable-matching.mjs'
    benchmark = work / 'scripts/benchmark-timetable-matching.mjs'
    results = []

    def check(label, expected_pass):
        run = subprocess.run(
            ['node', '--test', '--test-name-pattern=current matcher benchmark',
             'tests/timetable-matching.test.mjs'], cwd=work,
            capture_output=True, text=True, timeout=120)
        print(f'=== {label} (expected {"pass" if expected_pass else "failure"}) ===')
        print(run.stdout + run.stderr)
        assert (run.returncode == 0) == expected_pass, label
        results.append({'case': label, 'expected': 'pass' if expected_pass else 'fail', 'exit': run.returncode})
        for path, content in originals.items():
            (work / path).write_text(content)

    check('clean-without-history', True)
    for path in paths[1:-1]:
        target = work / path
        target.write_text(target.read_text() + ('\n# Harmless source edit.\n' if path.endswith('.py') else '\n// Harmless source edit.\n'))
    check('benign-source-edits-without-history', True)
    benchmark.write_text(benchmark.read_text().replace(
        "[path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]", "[path, '0'.repeat(64)]"))
    check('false-provenance', False)
    benchmark.write_text(benchmark.read_text().replace(
        ')), results}, null, 2)', ")), results: results.filter(row => row.mode !== 'unbound')}, null, 2)"))
    check('missing-negative-outcome', False)
    for kind in ['source', 'candidate']:
        matcher.write_text(matcher.read_text().replace(
            f"workBudget('{kind}_work_limit')", f"workBudget('broken_{kind}_limit_reason')"))
        check(f'broken-{kind}-limit', False)
    print(json.dumps(results, indent=2))
