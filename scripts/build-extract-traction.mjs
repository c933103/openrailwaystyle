// The traction dataset built from the assembled Geofabrik extract
// (#330, step 9), in the traction-data layout:
//   node scripts/build-extract-traction.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// signals/ and power/electricity-signals.* (build-extract-signals.mjs), then
// power/power-facilities.* and power/manifest.json
// (build-extract-power-facilities.mjs). source.json, for the site's source
// switch (scripts/data-source.mjs), is complete only when every file
// traction-data has is here and the assembly covers the world; otherwise it
// lists what is missing, and the site keeps traction-data. Power methods are
// not built from the extracts yet.
import {access, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {osmiumSubset} from './build-extract-station-points.mjs';
import {buildExtractSignals} from './build-extract-signals.mjs';
import {buildExtractPowerFacilities} from './build-extract-power-facilities.mjs';

// The files of a traction-data snapshot that site.yml checks or loads.
export const TRACTION_FILES = Object.freeze([
  'signals/manifest.json', 'signals/index.json', 'signals/railway-signals.geojson.gz',
  'power/manifest.json', 'power/power-facilities.geojson.gz',
  'power/electricity-signals-manifest.json', 'power/electricity-signals.geojson.gz',
  'power/methods-manifest.json', 'power/power-methods.geojson.gz',
]);

const exists = path => access(path).then(() => true, () => false);

// source.json from what the output holds.
export async function writeTractionMarker(out, report) {
  const missing = [];
  for (const file of TRACTION_FILES) if (!await exists(join(out, file))) missing.push(file);
  const assemblyComplete = coversWorld(report);
  const marker = {schema: 1, dataset: 'traction', source: 'extract', complete: assemblyComplete && !missing.length, osmTimestamp: report.oldestTimestamp, assemblyComplete, missing};
  await writeFile(join(out, 'source.json'), `${JSON.stringify(marker)}\n`);
  return marker;
}

export async function buildExtractTraction(pbf, report, out, {read = readElements, subset = osmiumSubset, now = () => new Date()} = {}) {
  checkAssembly(report);
  const {signals, electricity} = await buildExtractSignals(pbf, report, out, {read, now});
  const facilities = await buildExtractPowerFacilities(pbf, report, join(out, 'power'), {read, subset, now});
  const marker = await writeTractionMarker(out, report);
  return {signals, electricity, facilities, marker};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !out) throw new Error('Usage: build-extract-traction.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>');
  const {signals, electricity, facilities, marker} = await buildExtractTraction(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out);
  const brief = manifest => manifest && {...manifest, coverage: manifest.coverage.length};
  console.log(JSON.stringify({signals, electricity: brief(electricity), facilities: brief(facilities), marker}));
}
