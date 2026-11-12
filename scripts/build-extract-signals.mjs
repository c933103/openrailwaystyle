// Railway signals built from the assembled Geofabrik extract
// (scripts/assemble-extracts.mjs) instead of Overpass (#330, step 9):
// The selection of combinedSignalQuery, which serves both signal supplements
// of the traction dataset: signals without a direction (signals/, the same
// features and files as build-signals.mjs) and electrification signals
// (power/electricity-signals.*, published by the same validated writer).
// The output has the traction-data layout; build-extract-traction.mjs adds
// the power facilities and writes source.json for the whole dataset.
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {startRegions} from './crossing-data.mjs';
import {signalFeatures, signalFiles} from './signals-data.mjs';
import {electricitySignalsGeoJSON} from './electricity-signal-data.mjs';
import {publishElectricitySignals} from './build-electricity-signals.mjs';

const SOURCE = 'OpenStreetMap via the Geofabrik extracts';

// combinedSignalQuery, node by node: a signal without
// railway:signal:direction, or an electrification signal with one.
export function isSignalElement({type, tags = {}}) {
  if (type !== 'node' || tags.railway !== 'signal') return false;
  if (tags['railway:signal:direction'] === undefined) return true;
  const electricity = tags['railway:signal:electricity'];
  return electricity !== undefined && electricity !== 'no';
}

// An Overpass bounding box holds its edges: a signal on one is counted in
// both boxes (the features themselves are by OSM id, once).
const inside = ([s, w, n, e], {lat, lon}) => lat >= s && lat <= n && lon >= w && lon <= e;

export async function buildExtractSignals(pbf, report, out, {read = readElements, now = () => new Date()} = {}) {
  checkAssembly(report);
  const elements = [];
  const counts = await read(pbf, {keep: isSignalElement, onElement: element => { elements.push(element); }});
  const features = signalFeatures({elements}).sort((a, b) => a.id - b.id);
  if (!features.length) throw new Error('Empty worldwide railway signal supplement');
  const electric = electricitySignalsGeoJSON({elements});
  // The world's start regions as the coverage, as a run whose regions all
  // answered without splitting would record it.
  const coverage = startRegions().map(({box}) => ({bbox: box, timestamp: report.oldestTimestamp,
    features: electricitySignalsGeoJSON({elements: elements.filter(element => inside(box, element))}).features.length}));

  await rm(out, {recursive: true, force: true});
  const signalsOut = join(out, 'signals');
  await mkdir(signalsOut, {recursive: true});
  const {files, tiles} = signalFiles(features);
  for (const [path, data] of files) {
    await mkdir(dirname(join(signalsOut, path)), {recursive: true});
    await writeFile(join(signalsOut, path), data);
  }
  const complete = coversWorld(report);
  const manifest = {complete, generated: now().toISOString(), signals: features.length, tiles, oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
    source: SOURCE, license: 'ODbL-1.0',
    description: 'Worldwide OSM railway=signal nodes without railway:signal:direction, supplementing the direction-dependent OpenRailwayMap signal source.',
    extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, read: counts.kept}};
  await writeFile(join(signalsOut, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // The electricity snapshot's writer certifies a complete world (complete:
  // true, a full coverage partition), so it is published only from an
  // assembly that covers every region and gap tile; otherwise it is missing.
  const power = complete
    ? await publishElectricitySignals(electric, coverage, {output: join(out, 'power'), requests: 0, downloadedBytes: 0, now: () => now().getTime(), log: () => {}, source: SOURCE})
    : null;
  return {signals: manifest, electricity: power?.manifest ?? null};
}
