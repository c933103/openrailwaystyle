import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {timezoneCatalog} from '../scripts/timetable-timezones.mjs';

test('CI installs the catalogue timezone dependency only for the test process', () => {
  const workflow = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  const validate = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('      - name: Check JavaScript syntax'));
  assert.ok(validate.includes(`--only-binary=:all: --no-deps --target "$RUNNER_TEMP/atlas-test-python" tzdata==${timezoneCatalog.package_version}`));
  assert.match(validate, /PYTHONPATH: \$\{\{ runner.temp \}\}\/atlas-test-python\n\s+PYTHONTZPATH: ''/);
  assert.ok(validate.includes(`tzdata.__version__ == "${timezoneCatalog.package_version}" and tzdata.IANA_VERSION == "${timezoneCatalog.iana_version}"`));
  assert.match(validate, /npm test/);
  assert.doesNotMatch(validate, /continue-on-error|sudo|break-system-packages/);
});
