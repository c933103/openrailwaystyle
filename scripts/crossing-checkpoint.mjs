// Full-rebuild staging only. Never read by the website or incremental updater.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, readdir, lstat, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync, gunzipSync} from 'node:zlib';
import {TAG_KEYS, quarters, regionQuery, startRegions} from './crossing-data.mjs';

export const CHECKPOINT_LIMITS = Object.freeze({
  stateBytes: 4 * 1024 ** 2, leafBytes: 16 * 1024 ** 2,
  compressedBytes: 128 * 1024 ** 2, expandedLeafBytes: 128 * 1024 ** 2,
  expandedBytes: 512 * 1024 ** 2, nodes: 4096, maxAgeMs: 14 * 86400_000,
});
const SCHEMA = 1, MAX_DEPTH = 5;
const PURPOSE = 'atlas-crossing-full-rebuild-checkpoint';
const CREDIT = {license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright'};
const envelopeFor = state => JSON.stringify({purpose: PURPOSE, ...CREDIT, sha256: sha256(JSON.stringify(state)), state});
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const key = box => box.join(',');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const crossingWatermark = now => new Date(now - 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');

export async function crossingCheckpointIdentity(source, parentSnapshot, tableVersion) {
  assert.match(parentSnapshot || '', /^(none|[a-f0-9]{40})$/, 'Checkpoint needs the verified previous snapshot commit or none');
  // Hash actual parser/query/tag sources, not a manually maintained parser label.
  const parser = sha256(JSON.stringify((await Promise.all([
    readFile(new URL('./crossing-data.mjs', import.meta.url)),
    readFile(new URL('../styles/crossing-tags.mjs', import.meta.url)),
  ])).map(sha256)));
  return {schema: SCHEMA, tableVersion, source, parentSnapshot, parser,
    query: sha256(JSON.stringify(startRegions().map(({box}) => regionQuery(box)))), maxDepth: MAX_DEPTH};
}

export function validateCrossingCheckpointTree(text) {
  assert.ok(Buffer.byteLength(text) <= CHECKPOINT_LIMITS.stateBytes, 'Oversized checkpoint tree');
  const lines = text.trim().split('\n');
  assert.ok(lines.length <= CHECKPOINT_LIMITS.nodes + 1, 'Oversized checkpoint tree');
  let total = 0, states = 0;
  for (const line of lines) {
    const match = /^100644 blob [a-f0-9]{40}\s+(\d+)\t(state\.json|[a-f0-9]{64}\.json\.gz)$/.exec(line);
    assert.ok(match, 'Unexpected checkpoint tree path/type');
    const size = Number(match[1]), state = match[2] === 'state.json';
    assert.ok(size > 0 && size <= (state ? CHECKPOINT_LIMITS.stateBytes : CHECKPOINT_LIMITS.leafBytes), 'Oversized checkpoint tree file');
    if (state) states++; else total += size;
  }
  assert.equal(states, 1, 'Checkpoint tree needs one state.json');
  assert.ok(total <= CHECKPOINT_LIMITS.compressedBytes, 'Oversized checkpoint tree payloads');
}

async function boundedRead(path, limit) {
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, `Oversized or non-file checkpoint: ${path}`);
  return readFile(path);
}
async function inspectDirectory(directory) {
  const root = await lstat(directory);
  assert.ok(root.isDirectory() && !root.isSymbolicLink(), 'Refusing non-directory/symlink staging root');
  const files = await readdir(directory);
  for (const name of files) {
    assert.match(name, /^(state\.json|[a-f0-9]{64}\.json\.gz)(\.tmp)?$/, 'Refusing to overwrite unexpected staging content');
    const entry = await lstat(join(directory, name));
    assert.ok(entry.isFile() && !entry.isSymbolicLink(), 'Refusing non-file/symlink staging entry');
  }
  return files;
}
async function atomicWrite(path, bytes) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, bytes, {flag: 'wx'});
  await rename(temporary, path);
}

function validateRows(rows, box) {
  assert.ok(Array.isArray(rows), 'Invalid checkpoint rows');
  const ids = new Set();
  for (const row of rows) {
    assert.ok(row && Number.isSafeInteger(row.id) && row.id > 0 && !ids.has(row.id), 'Invalid/duplicate crossing id');
    ids.add(row.id);
    assert.ok(Number.isFinite(row.lat) && Number.isFinite(row.lon) && row.lat >= box[0] && row.lat <= box[2] && row.lon >= box[1] && row.lon <= box[3], 'Crossing outside checkpoint bbox');
    assert.ok(['road', 'foot'].includes(row.kind) && typeof row.minor === 'boolean', 'Invalid crossing schema');
    assert.ok(row.tags === null || (row.tags && !Array.isArray(row.tags) && typeof row.tags === 'object' && Object.entries(row.tags).every(([k, v]) => TAG_KEYS.includes(k) && typeof v === 'string')), 'Invalid crossing tags');
  }
}

function validateState(state, identity, now) {
  assert.ok(equal(state.identity, identity), 'Incompatible checkpoint query/source/parser/schema/previous snapshot');
  assert.match(state.epoch || '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/, 'Invalid acquisition epoch');
  assert.ok(iso(state.acquisitionStartedAt) && iso(state.updatedAt), 'Invalid checkpoint timestamps');
  const began = Date.parse(state.acquisitionStartedAt), updated = Date.parse(state.updatedAt);
  assert.ok(began <= updated && updated <= now && now - began <= CHECKPOINT_LIMITS.maxAgeMs, 'Stale/future checkpoint epoch');
  assert.equal(state.watermark, crossingWatermark(began), 'Wrong acquisition watermark');
  assert.ok(Array.isArray(state.nodes) && state.nodes.length <= CHECKPOINT_LIMITS.nodes, 'Oversized checkpoint topology');
  const nodes = new Map();
  for (const node of state.nodes) {
    assert.ok(Array.isArray(node.box) && node.box.length === 4 && node.box.every(Number.isFinite), 'Invalid bbox');
    assert.ok(!nodes.has(key(node.box)), 'Duplicate checkpoint bbox');
    assert.equal(node.query, sha256(regionQuery(node.box)), 'Wrong leaf query');
    assert.ok(iso(node.observedAt) && Date.parse(node.observedAt) >= began && Date.parse(node.observedAt) <= updated, 'Invalid observation time');
    assert.ok(node.kind === 'split' || node.kind === 'leaf', 'Invalid checkpoint node');
    if (node.kind === 'leaf') {
      assert.ok(iso(node.requestStartedAt) && Date.parse(node.requestStartedAt) >= began && node.requestStartedAt <= node.observedAt, 'Invalid request time');
      assert.match(node.payload || '', /^[a-f0-9]{64}\.json\.gz$/, 'Invalid leaf filename');
      assert.match(node.payloadHash || '', /^[a-f0-9]{64}$/, 'Invalid parsed payload hash');
      assert.equal(node.payload, `${node.payloadHash}.json.gz`, 'Wrong payload filename');
      assert.ok(Number.isSafeInteger(node.bytes) && node.bytes > 0 && node.bytes <= CHECKPOINT_LIMITS.leafBytes, 'Oversized leaf');
      assert.ok(Number.isSafeInteger(node.expandedBytes) && node.expandedBytes > 0 && node.expandedBytes <= CHECKPOINT_LIMITS.expandedLeafBytes, 'Oversized expanded leaf');
      assert.ok(Number.isSafeInteger(node.rows) && node.rows >= 0, 'Invalid row count');
    }
    nodes.set(key(node.box), node);
  }
  // Every stored descendant needs its exact, explicitly split ancestor.
  // Missing children remain pending; a leaf may never hide more descendants.
  let visited = 0, pending = false;
  function walk(box, depth) {
    const node = nodes.get(key(box));
    if (!node) { pending = true; return; }
    // The collector writes a DFS prefix. A hole followed by an older cached
    // leaf could let that leaf overwrite a newly observed moved OSM node.
    assert.ok(!pending && state.nodes[visited] === node, 'Checkpoint is not an acquisition traversal prefix');
    visited++;
    if (node.kind === 'split') {
      assert.ok(depth < MAX_DEPTH, 'Excess checkpoint depth');
      for (const child of quarters(box)) walk(child, depth + 1);
    }
  }
  for (const {box} of startRegions()) walk(box, 0);
  assert.equal(visited, nodes.size, 'Invalid checkpoint bbox/split topology');
  const leaves = state.nodes.filter(node => node.kind === 'leaf');
  assert.ok(leaves.reduce((sum, node) => sum + node.bytes, 0) <= CHECKPOINT_LIMITS.compressedBytes, 'Oversized compressed checkpoint');
  assert.ok(leaves.reduce((sum, node) => sum + node.expandedBytes, 0) <= CHECKPOINT_LIMITS.expandedBytes, 'Oversized expanded checkpoint');
  return nodes;
}

async function readLeaf(directory, state, node) {
  const bytes = await boundedRead(join(directory, node.payload), CHECKPOINT_LIMITS.leafBytes);
  assert.equal(bytes.length, node.bytes, 'Wrong compressed length');
  assert.equal(sha256(bytes), node.payloadHash, 'Corrupt checkpoint payload');
  const expanded = gunzipSync(bytes, {maxOutputLength: Math.min(node.expandedBytes, CHECKPOINT_LIMITS.expandedLeafBytes)});
  assert.equal(expanded.length, node.expandedBytes, 'Wrong expanded length');
  const payload = JSON.parse(expanded);
  assert.equal(payload.epoch, state.epoch, 'Wrong payload epoch');
  assert.equal(payload.identity, sha256(JSON.stringify(state.identity)), 'Wrong payload identity');
  assert.ok(equal(payload.box, node.box) && payload.query === node.query, 'Wrong payload bbox/query');
  assert.equal(payload.requestStartedAt, node.requestStartedAt, 'Wrong payload request time');
  assert.equal(payload.observedAt, node.observedAt, 'Wrong payload observation time');
  validateRows(payload.rows, node.box);
  assert.equal(payload.rows.length, node.rows, 'Wrong payload row count');
  return payload.rows;
}

export async function loadCrossingCheckpoint(directory, identity, now = Date.now()) {
  await inspectDirectory(directory);
  const envelope = JSON.parse(await boundedRead(join(directory, 'state.json'), CHECKPOINT_LIMITS.stateBytes));
  assert.equal(envelope.purpose, PURPOSE, 'Unrecognized checkpoint ownership');
  for (const [field, value] of Object.entries(CREDIT)) assert.equal(envelope[field], value, `Wrong checkpoint ${field}`);
  assert.equal(sha256(JSON.stringify(envelope.state)), envelope.sha256, 'Corrupt checkpoint state');
  const state = envelope.state;
  validateState(state, identity, now);
  const files = ['state.json'];
  for (const node of state.nodes) if (node.kind === 'leaf') {
    await readLeaf(directory, state, node);
    files.push(node.payload);
  }
  assert.ok(equal((await readdir(directory)).sort(), files.sort()), 'Partial or unexpected checkpoint files');
  return state;
}

export async function openCrossingCheckpoint({directory, source, parentSnapshot, tableVersion, now = Date.now(), warn = console.warn}) {
  const identity = await crossingCheckpointIdentity(source, parentSnapshot, tableVersion);
  let state;
  try { state = await loadCrossingCheckpoint(directory, identity, now); }
  catch (error) {
    // Reject the whole generation; never silently mix incompatible or partly
    // written leaves into a fresh epoch. This directory is isolated staging.
    const files = await inspectDirectory(directory).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    if (files.length) {
      const owned = JSON.parse(await boundedRead(join(directory, 'state.json'), CHECKPOINT_LIMITS.stateBytes));
      assert.equal(owned.purpose, PURPOSE, 'Refusing to overwrite unrecognized staging ownership');
      const known = new Set(['state.json', ...(owned.state?.nodes || []).map(node => node.payload).filter(Boolean)]);
      assert.ok(files.every(name => known.has(name)), 'Refusing to overwrite unexpected staging files');
    }
    if (files.length) warn(`Discarding unusable full-rebuild checkpoint: ${error.message}`);
    await rm(directory, {recursive: true, force: true});
    state = {identity, epoch: randomUUID(), acquisitionStartedAt: new Date(now).toISOString(),
      watermark: crossingWatermark(now), updatedAt: new Date(now).toISOString(), nodes: []};
    await mkdir(directory, {recursive: true});
    await atomicWrite(join(directory, 'state.json'), envelopeFor(state));
  }
  let resumedLeaves = 0, newLeaves = 0;
  const nodes = validateState(state, identity, now);
  async function save(node, bytes) {
    assert.ok(!nodes.has(key(node.box)), 'Checkpoint node already acquired');
    const next = {...state, updatedAt: new Date().toISOString(), nodes: [...state.nodes, node]};
    validateState(next, identity, Date.now());
    const envelope = envelopeFor(next);
    assert.ok(Buffer.byteLength(envelope) <= CHECKPOINT_LIMITS.stateBytes, 'Oversized checkpoint state');
    if (bytes) await atomicWrite(join(directory, node.payload), bytes);
    await atomicWrite(join(directory, 'state.json'), envelope);
    state = next;
    nodes.set(key(node.box), node);
  }
  return {
    get epoch() { return state.epoch; },
    get watermark() { return state.watermark; },
    async get(box) {
      const node = nodes.get(key(box));
      if (!node) return null;
      if (node.kind === 'split') return {kind: 'split'};
      const rows = await readLeaf(directory, state, node);
      resumedLeaves++;
      return {kind: 'leaf', rows};
    },
    async leaf(box, rows, {requestStartedAt, observedAt}) {
      validateRows(rows, box);
      const query = sha256(regionQuery(box));
      const expanded = Buffer.from(JSON.stringify({epoch: state.epoch, identity: sha256(JSON.stringify(identity)), box, query, requestStartedAt, observedAt, rows}));
      assert.ok(expanded.length <= CHECKPOINT_LIMITS.expandedLeafBytes, 'Oversized expanded leaf');
      const bytes = gzipSync(expanded, {level: 9}), payloadHash = sha256(bytes);
      await save({box, kind: 'leaf', query, requestStartedAt, observedAt, rows: rows.length,
        payload: `${payloadHash}.json.gz`, payloadHash, bytes: bytes.length, expandedBytes: expanded.length}, bytes);
      newLeaves++;
    },
    async split(box) { await save({box, kind: 'split', query: sha256(regionQuery(box)), observedAt: new Date().toISOString()}); },
    summary() {
      const leaves = state.nodes.filter(node => node.kind === 'leaf');
      return {epoch: state.epoch, startedAt: state.acquisitionStartedAt, watermark: state.watermark,
        observationStartedAt: leaves.map(node => node.requestStartedAt).sort()[0] || null,
        observationCompletedAt: leaves.map(node => node.observedAt).sort().at(-1) || null,
        parentSnapshot: identity.parentSnapshot, resumedLeaves, newLeaves};
    },
  };
}

// The workflow validates staging again before its separate work-branch commit.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'tree') {
    validateCrossingCheckpointTree((await boundedRead(process.argv[3], CHECKPOINT_LIMITS.stateBytes)).toString());
  } else {
    assert.equal(process.argv[2], 'validate');
    const identity = await crossingCheckpointIdentity(process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter', process.env.PREVIOUS_SNAPSHOT_ID, 3);
    const state = await loadCrossingCheckpoint(process.env.CROSSING_CHECKPOINT_DIR, identity);
    console.log(`Validated full-rebuild epoch ${state.epoch}: ${state.nodes.length} completed leaves/split decisions`);
  }
}
