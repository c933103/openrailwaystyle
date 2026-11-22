import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installSovietStyle, sovietTile} from '../styles/soviet-topo.mjs';
import {readSettings} from '../styles/map-model.mjs';
import {layerVisibility} from '../styles/layer-semantics.mjs';

test('public Soviet background uses six dated sheet series above seabed and below railway overlays', async () => {
  const style = JSON.parse(await readFile('styles/world.style.json', 'utf8'));
  installSovietStyle(style);
  const settings = readSettings('?background=soviet');
  assert.equal(settings.background, 'soviet');
  const ids = style.layers.map(layer => layer.id);
  const coarse = ids.indexOf('soviet-1m'), fine = ids.indexOf('soviet-25k');
  assert.ok(ids.indexOf('terrain-bathymetry') < coarse && fine === coarse + 5);
  assert.ok(fine < ids.indexOf('station-major-dots'));
  for (const layer of style.layers.slice(coarse, fine + 1)) {
    assert.equal(layer.layout.visibility, 'none');
    assert.equal(layerVisibility(layer, settings), true);
    assert.equal(layerVisibility(layer, {...settings, background:'map'}), false);
  }
  assert.equal(layerVisibility(style.layers.find(l => l.id === 'place_label_city'), settings), true);
});

test('uncovered ocean and an excluded 1993 sheet perform no remote fetch; the dated New York sheet is available', async () => {
  const urls = [];
  const fetcher = async (url, init) => {
    urls.push(url);
    assert.equal(init.credentials, 'omit');
    return new Response(null, {status:404});
  };
  for (const [scale, lon, lat, z] of [['500k', -150, 30, 9], ['1m', -74, 40.71, 10], ['500k', -74, 40.71, 10]]) {
    const n=2**z, x=Math.floor((lon+180)/360*n), y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
    const {data}=await sovietTile({url:`atlassoviet://${scale}/${z}/${x}/${y}`}, new AbortController(), fetcher);
    assert.ok(data.byteLength);
  }
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/indianopenmaps\.com\/world\/topo\/russian\/500k\/gs\//);
});
