import test from 'node:test';
import assert from 'node:assert/strict';
import {CAP_RADIUS, decodeLine, fromPolar, polarBandFor} from '../styles/polar.mjs';
import {PolarLayer} from '../styles/polar-layer.mjs';
import {closedRings, detailQuery, detailTiles, parseOverpass} from '../scripts/polar-features.mjs';

test('finer contour bands belong exclusively to Carto, with old-snapshot fallback', () => {
  for (const background of ['map', 'satellite', 'hybrid']) for (const zoom of [8, 9, 11, 18])
    assert.equal(polarBandFor(zoom, background, 3), 0);
  assert.equal(polarBandFor(8.99, 'carto', 3), 0);
  assert.equal(polarBandFor(9, 'carto', 3), 1);
  assert.equal(polarBandFor(11, 'carto', 3), 2);
  assert.equal(polarBandFor(18, 'carto', 1), 0);
  assert.equal(polarBandFor(18, 'carto', 0), -1);
});

test('detail extraction covers both full caps; incomplete Overpass responses are rejected', () => {
  for (const cap of ['north', 'south']) for (let west = -180; west < 180; west += 90) {
    const query = detailQuery(cap, west, west + 90);
    assert.ok(query.includes(cap === 'north' ? `85,${west},90,${west + 90}` : `-90,${west},-85,${west + 90}`));
    for (const selector of ['way[highway]', 'way[waterway]', 'way[building]', 'rel[building]', 'rel[aeroway=apron][type=multipolygon]', 'research_station']) assert.ok(query.includes(selector));
  }
  assert.deepEqual(parseOverpass('{"elements":[]}').elements, []);
  assert.throws(() => parseOverpass('{"elements":[{"id":1}],"remark":"runtime error: timeout"}'), /Incomplete/);
  assert.throws(() => parseOverpass('{}'), /Incomplete/);
});

const geometry = points => points.map(p => { const [lon, lat] = fromPolar('south', p); return {lon, lat}; });
test('Carto tiles preserve metre-scale buildings, join relation holes and deduplicate sector results', () => {
  const outer = geometry([[30,40],[30.006,40],[30.006,40.006],[30,40.006],[30,40]]);
  const inner = geometry([[30.002,40.002],[30.004,40.002],[30.004,40.004],[30.002,40.004],[30.002,40.002]]);
  const building = {type:'relation', id:1, tags:{building:'yes'}, members:[{role:'outer',geometry:outer},{role:'inner',geometry:inner}]};
  const road = {type:'way', id:2, tags:{highway:'service'}, geometry:geometry([[10,20],[40,20]])};
  const station = {type:'node', id:3, ...geometry([[35,45]])[0], tags:{man_made:'research_station',name:'Station', 'name:ja':'Station JA'}};
  const apron = {...building,id:4,tags:{aeroway:'apron'}};
  const tiles = detailTiles('south', [building, building, road, road, station, station, apron]);
  assert.equal(tiles.size, 1);
  const tile = tiles.get('2-2');
  assert.equal(tile.buildings.length, 1); assert.equal(tile.buildings[0].length, 2);
  assert.equal(tile.aprons.length, 1); assert.equal(tile.aprons[0].length, 2);
  const ring = tile.buildings[0][0], points = decodeLine(ring, 0, ring.length, tile.quantum);
  assert.equal(new Set(points.map(p => p.join(','))).size, 4, 'a six-metre building must not collapse');
  assert.equal(tile.roads.length, 1); assert.equal(tile.places.length, 1);
  assert.equal(tile.places[0]['name:ja'], 'Station JA');
});

test('unclosed area members are not invented into polygons; lines outside the cap are excluded', () => {
  assert.deepEqual(closedRings([{geometry:geometry([[0,0],[1,0],[1,1]])}]), []);
  const tiles = detailTiles('south', [{type:'way',id:1,tags:{highway:'path'},geometry:geometry([[CAP_RADIUS+1,1],[CAP_RADIUS+2,1]])}]);
  assert.equal(tiles.size, 0);
});

function renderingLayer() {
  let background = 'map', zoom = 13, terrain = true, view = {south: [-20,-20,20,20]};
  const calls = [], labels = [];
  const layer = new PolarLayer({data:'https://example.org/', units:()=> 'metric', palette:()=>background, imagery:()=>['satellite','hybrid'].includes(background), relief:()=>terrain, places:p=>labels.push(p)});
  const map = {getCenter:()=>({lat:0}),getZoom:()=>zoom,getProjection:()=>({type:'globe'}),getContainer:()=>({clientWidth:400,clientHeight:300}),project:()=>({x:200,y:150}),triggerRepaint(){}};
  const gl = {disable(){},enable(){},blendFunc(){},deleteBuffer(){},deleteTexture(){},deleteProgram(){}};
  layer.onAdd(map, gl);
  layer.visible=()=>view;layer.loadCap=()=>{};layer.fill=()=>{};layer.line=()=>{};
  layer.caps.south = {index:{units:{metric:[{n:1,tiles:['0-0']},{n:2,tiles:['0-0']},{n:4,tiles:['1-1']}]}, carto:{from:10,n:4,tiles:['1-1','3-3']}}};
  layer.loadTile=key=>{calls.push(key);return {loading:true};};
  layer.loadDetailTile=key=>{calls.push(key);return {loading:true};};
  const render=()=>layer.renderCaps(gl,{defaultProjectionData:{projectionTransition:1},shaderData:{}});
  return {layer, calls, labels, render, background:b=>background=b, zoom:z=>zoom=z, terrain:t=>terrain=t, view:v=>view=v};
}
test('real rendering decisions request only visible Carto detail; other views stay coarse', () => {
  const r = renderingLayer();
  r.render(); assert.deepEqual(r.calls.splice(0), ['south-metric-0-0-0']);
  r.background('carto');r.zoom(9);r.render(); assert.deepEqual(r.calls.splice(0), ['south-metric-1-0-0']);
  r.zoom(13);r.render(); assert.deepEqual(r.calls.splice(0), ['south-metric-2-1-1','south-carto-1-1']);
  r.terrain(false);r.render(); assert.deepEqual(r.calls.splice(0), ['south-carto-1-1'], 'Carto OSM detail is independent of relief');
  for (const background of ['map','satellite','hybrid']) {
    r.background(background);r.render();assert.deepEqual(r.calls.splice(0), []);
    assert.equal(r.layer.detailPending, null);
  }
  r.background('carto');r.view({});r.render();assert.deepEqual(r.calls.splice(0), []);assert.equal(r.layer.detailPending,null);
});

test('switching away from Carto cancels fine requests and discards late replies and GPU meshes', async () => {
  const layer = new PolarLayer({data:'https://example.org/',units:()=> 'metric'});
  const deleted = [], replies = []; let uploads = 0;
  layer.onAdd({triggerRepaint(){}},{deleteBuffer:b=>deleted.push(b),deleteTexture(){},deleteProgram(){}});
  layer.upload=()=>{uploads++;return {};};
  layer.json=(name,signal)=>new Promise(resolve=>{replies.push({name,signal,resolve});});
  layer.syncDetail(true);
  layer.tiles.set('loaded', {detailed:true,parts:[{buffers:['detail-buffer']}]});
  layer.tiles.set('coarse', {buffers:['coarse-buffer']});
  layer.loadTile('south-metric-2-0-0');layer.loadDetailTile('south-carto-0-0');
  layer.syncDetail(false);
  assert.ok(replies.every(r=>r.signal.aborted));assert.deepEqual(deleted, ['detail-buffer']);
  assert.deepEqual([...layer.tiles.keys()], ['coarse']);
  for (const r of replies) r.resolve(r.name.includes('carto') ? {quantum:0.001} : {lines:[]});
  await Promise.resolve();await Promise.resolve();assert.equal(uploads, 0);
  layer.onRemove();assert.deepEqual(deleted,['detail-buffer','coarse-buffer']);
});
