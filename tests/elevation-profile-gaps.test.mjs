import test from 'node:test';
import assert from 'node:assert/strict';
import * as elevation from '../styles/elevation.mjs';
const {profileStats, profileSegments} = elevation;
import {profileHarness} from './helpers/profile-ui-harness.mjs';

const samples = heights => heights.map((height, i) => ({at: i * .05, height, point: [i * .001, 0]}));
test('missing heights separate observed stretches rather than manufacturing a slope', () => {
  const profile = samples([0, null, 100]);
  assert.deepEqual(profileSegments(profile), [[profile[0]], [profile[2]]]);
  assert.deepEqual(profileStats(profile), {min: 0, max: 100, ascent: null, descent: null, steepest: null, over: .1});
  assert.equal(profileStats(samples([null, null])), null);
});
test('partial profiles retain genuine ascent, descent and qualifying slopes on both sides', () => {
  const stats = profileStats(samples([0, 5, 10, null, 100, 80, 90]));
  assert.equal(stats.ascent, 20);
  assert.equal(stats.descent, 20);
  assert.ok(Math.abs(stats.steepest - .1) < 1e-12, 'neither the height jump nor the missing span is measured');
  assert.deepEqual([stats.min, stats.max], [0, 100]);
});
test('flat known stretches remain 0%, but isolated samples and zero distance are unknown', () => {
  assert.equal(profileStats(samples([10, 10, 10])).steepest, 0);
  assert.equal(profileStats(samples([10, null, 10])).steepest, null);
  assert.equal(profileStats([{at: 0, height: 10}]).steepest, null);
  assert.equal(profileStats([{at: 0, height: 10}, {at: 0, height: 10}]).steepest, null);
});
for (const units of ['metric', 'imperial']) test(`actual profile UI leaves internal gaps blank in ${units}`, async () => {
  const h = profileHarness({units, heights: points => points.map((_, i) => i >= 6 && i <= 16 ? null : i)});
  try {
    await h.show();
    assert.match(h.content().textContent, /Incomplete elevation profile/);
    const lines = [...h.content().querySelectorAll('polyline.profile-line')];
    const areas = [...h.content().querySelectorAll('polygon.profile-area')];
    assert.equal(lines.length, 2); assert.equal(areas.length, 2);
    const positions = lines.map(line => line.getAttribute('points').split(' ').map(pair => Number(pair.split(',')[0])));
    assert.ok(positions[0].at(-1) < positions[1][0], 'no stroke spans the missing interval');
    const filled = areas.map(area => area.getAttribute('points').split(' ').map(pair => Number(pair.split(',')[0])));
    assert.ok(Math.max(...filled[0]) < Math.min(...filled[1]), 'no fill spans the missing interval');
    assert.match(h.summary()['Steepest (known stretches)'], /^Unavailable:/, 'short fragments cannot establish the requested 100 m gradient');
    assert.match(h.summary()['Ascent / descent (known stretches)'], units === 'metric' ? / m \/ 0 m$/ : / ft \/ 0 ft$/);
    const svg = h.content().querySelector('svg');
    svg.getBoundingClientRect = () => ({left: 0, width: 280});
    svg.dispatchEvent(new h.dom.window.MouseEvent('pointermove', {clientX: 158}));
    assert.match(svg.querySelector('.profile-readout').textContent, /Height unavailable$/);
    svg.dispatchEvent(new h.dom.window.MouseEvent('pointermove', {clientX: 44}));
    assert.match(svg.querySelector('.profile-readout').textContent, units === 'metric' ? /0 m$/ : /0 ft$/);
    svg.dispatchEvent(new h.dom.window.MouseEvent('pointerleave'));
    assert.equal(h.markers.at(-1).visible, false);
    assert.equal(svg.querySelector('.profile-cursor').getAttribute('visibility'), 'hidden');
  } finally {h.close();}
});
test('isolated successful samples stay visible without a false slope or connecting fill', async () => {
  const h = profileHarness({heights: points => points.map((_, i) => i === 0 ? 0 : i === points.length - 1 ? 100 : null)});
  try {
    await h.show();
    assert.equal(h.content().querySelectorAll('circle.profile-line').length, 2);
    assert.equal(h.content().querySelectorAll('polyline, polygon').length, 0);
    assert.equal(h.summary()['Ascent / descent (known stretches)'], 'Unavailable');
    assert.match(h.summary()['Steepest (known stretches)'], /^Unavailable:/);
    assert.match(h.summary()['End to end'], /^\+100 m/, 'known endpoints can still establish their explicitly labelled difference');
  } finally {h.close();}
});
test('unknown ends are not filled or presented as an end-to-end gradient', async () => {
  const h = profileHarness({heights: points => points.map((_, i) => i < 2 || i >= points.length - 2 ? null : 10)});
  try {
    await h.show();
    assert.equal(h.summary()['End to end'], undefined);
    const x = h.content().querySelector('polyline').getAttribute('points').split(' ').map(pair => Number(pair.split(',')[0]));
    assert.ok(x[0] > 44 && x.at(-1) < 272);
    assert.match(h.summary()['Steepest (known stretches)'], /^0\.0%/);
  } finally {h.close();}
});
test('complete flat profiles keep their normal continuous chart and honest zero gradient', async () => {
  const h = profileHarness({heights: points => points.map(() => 10)});
  try {
    await h.show();
    assert.doesNotMatch(h.content().textContent, /Incomplete|Unavailable/);
    assert.equal(h.content().querySelectorAll('polyline.profile-line').length, 1);
    assert.equal(h.content().querySelectorAll('polygon.profile-area').length, 1);
    assert.match(h.summary().Steepest, /^0\.0%/);
  } finally {h.close();}
});
test('all failed heights remain an unavailable profile with no invented statistics', async () => {
  const h = profileHarness({heights: points => points.map(() => null)});
  try {await h.show();assert.match(h.content().textContent, /terrain tiles could not load/);assert.equal(h.content().querySelector('svg, dl'), null);} finally {h.close();}
});
test('a repeated profile can recover from a partial response', async () => {
  let incomplete = true;
  const h = profileHarness({heights: points => points.map((_, i) => incomplete && i === 10 ? null : i)});
  try {await h.show();assert.match(h.content().textContent, /Incomplete/);incomplete = false;await h.show();assert.doesNotMatch(h.content().textContent, /Incomplete/);assert.equal(h.content().querySelectorAll('polyline').length, 1);} finally {h.close();}
});
test('actual terrain tile rejection reaches the UI as a gap and recovers on retry', async () => {
  const requests = [];
  let failed = true;
  const terrain = elevation.createElevation('fixture/{z}/{x}/{y}', {zoom: 2, load: async url => {
    requests.push(url);
    if (url.includes('/3/') && failed) throw new Error('Synthetic terrain outage');
    return {size: 1, data: new Uint8ClampedArray([128, 10, 0, 255])};
  }});
  const h = profileHarness({heights: points => terrain.heights(points)});
  try {
    await h.show('Three tile profile', [[-170, 10], [80, 10]]);
    assert.match(h.content().textContent, /Incomplete elevation profile/);
    assert.equal(h.content().querySelectorAll('polyline.profile-line').length, 2);
    failed = false;
    await h.show('Recovered profile', [[-170, 10], [80, 10]]);
    assert.doesNotMatch(h.content().textContent, /Incomplete|Unavailable/);
    assert.equal(h.content().querySelectorAll('polyline.profile-line').length, 1);
    assert.equal(requests.filter(url => url.includes('/3/')).length, 2, 'the failed tile is retried once');
    assert.equal(requests.filter(url => !url.includes('/3/')).length, 2, 'healthy tile bytes stay cached');
  } finally {h.close();}
});
for (const interruption of ['dismiss', 'newer profile', 'other details']) test(`late incomplete heights cannot replace ${interruption}`, async () => {
  let finish, calls = 0;
  const h = profileHarness({heights: points => ++calls === 1 ? new Promise(resolve => {finish = () => resolve(points.map(() => null));}) : points.map(() => 10)});
  try {
    const old = h.show('Older');
    if (interruption === 'dismiss') h.dismiss();
    else if (interruption === 'newer profile') await h.show('Latest');
    else h.content().textContent = 'Station details';
    const before = h.content().textContent;
    finish();await old;
    assert.equal(h.content().textContent, before);
  } finally {h.close();}
});
test('a zero-length line has finite chart positions and no asserted gradient', async () => {
  const h = profileHarness({heights: points => points.map(() => 10)});
  try {await h.show('Zero length', [[0, 0], [0, 0]]);assert.doesNotMatch(h.content().querySelector('svg').outerHTML, /NaN|Infinity/);assert.match(h.summary().Steepest, /^Unavailable:/);} finally {h.close();}
});
