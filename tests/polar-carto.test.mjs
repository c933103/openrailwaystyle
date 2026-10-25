import test from 'node:test';
import assert from 'node:assert/strict';
import {CAP_RADIUS, decodeLine, detailOutlineLines, fromPolar, polarBandFor} from '../styles/polar.mjs';
import {PolarLayer, transportationGroups} from '../styles/polar-layer.mjs';
import {closedRings, detailQuery, detailTiles, parseOverpass, transportationType} from '../scripts/polar-features.mjs';

test('both drawn backgrounds use fine contours; imagery stays coarse and older snapshots work', () => {
  for (const background of ['satellite', 'hybrid']) for (const zoom of [8, 9, 11, 18])
    assert.equal(polarBandFor(zoom, background, 3), 0);
  for (const background of ['map', 'carto']) {
    assert.equal(polarBandFor(8.99, background, 3), 0);
    assert.equal(polarBandFor(9, background, 3), 1);
    assert.equal(polarBandFor(11, background, 3), 2);
    assert.equal(polarBandFor(18, background, 1), 0);
    assert.equal(polarBandFor(18, background, 0), -1);
  }
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

test('building outlines discard synthetic tile and cap cuts while preserving real edges and holes', () => {
  for (const y of [100,CAP_RADIUS-1]) {
    const left=y===100?-1:1,right=y===100?1:3;
    const shape=geometry([[left,y],[right,y],[right,y+2],[left,y+2],[left,y]]);
    const tiles=detailTiles('south',[{type:'way',id:90,tags:{building:'yes'},geometry:shape}]);
    let segments=0;
    for(const [key,tile] of tiles){
      const [tx,ty]=key.split('-').map(Number),size=2*CAP_RADIUS/4,x=-CAP_RADIUS+tx*size,by=-CAP_RADIUS+ty*size;
      const polygons=tile.buildings.map(rings=>rings.map(line=>decodeLine(line,0,line.length,tile.quantum)));
      const lines=detailOutlineLines(polygons,[x,by,x+size,by+size],tile.quantum);
      for(const line of lines)for(let i=1;i<line.length;i++){
        assert.ok(!(Math.abs(line[i-1][0])<1e-9&&Math.abs(line[i][0])<1e-9),'the shared x=0 tile cut is not a building edge');
        segments++;
      }
    }
    assert.equal(segments,y===100?6:3,'retain original edges, remove only clipping cuts');
  }
  const outer=[[10,10],[14,10],[14,14],[10,14],[10,10]],hole=[[11,11],[12,11],[12,12],[11,12],[11,11]];
  assert.deepEqual(detailOutlineLines([[outer,hole]],[-100,-100,100,100]),[outer,hole],'genuine closed rings and holes remain intact');
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
test('Map and Carto use visible fine assets; imagery cancels them', () => {
  const r = renderingLayer();
  r.render(); assert.deepEqual(r.calls.splice(0), ['south-metric-2-1-1','south-carto-1-1']);
  r.background('carto');r.zoom(9);r.render(); assert.deepEqual(r.calls.splice(0), ['south-metric-1-0-0']);
  r.zoom(13);r.render(); assert.deepEqual(r.calls.splice(0), ['south-metric-2-1-1','south-carto-1-1']);
  r.terrain(false);r.render(); assert.deepEqual(r.calls.splice(0), ['south-carto-1-1'], 'OSM detail is independent of relief');
  r.background('map');r.render();assert.deepEqual(r.calls.splice(0), ['south-carto-1-1']);
  assert.ok(r.layer.detailPending, 'Map keeps its visible detail budget');
  for (const background of ['satellite','hybrid']) {
    r.background(background);r.render();assert.deepEqual(r.calls.splice(0), []);
    assert.equal(r.layer.detailPending, null);
  }
  r.background('map');r.view({});r.render();assert.deepEqual(r.calls.splice(0), []);assert.equal(r.layer.detailPending,null);
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

test('polar detail tiles record each road piece\'s OpenMapTiles transportation class', () => {
  const way = (id, tags, points) => ({type:'way', id, tags, geometry:geometry(points)});
  const tiles = detailTiles('south', [
    way(10, {highway:'service'}, [[10,20],[40,20]]), way(11, {highway:'footway'}, [[10,22],[40,22]]),
    way(12, {highway:'service'}, [[10,24],[40,24]]), way(13, {highway:'proposed'}, [[10,26],[40,26]]),
    way(14, {highway:'construction', construction:'residential'}, [[10,28],[40,28]]), way(15, {waterway:'stream'}, [[10,30],[40,30]])]);
  const tile = tiles.get('2-2');
  assert.equal(tile.roadTypes.length, tile.roads.length); assert.equal(tile.pathTypes.length, tile.paths.length);
  const roadClasses = tile.roadTypes.map(i => tile.lineTypes[i]), pathClasses = tile.pathTypes.map(i => tile.lineTypes[i]);
  assert.deepEqual(roadClasses, [{class:'service',subclass:''}, {class:'service',subclass:''}, {class:'',subclass:''}, {class:'minor_construction',subclass:''}]);
  assert.deepEqual(pathClasses, [{class:'path',subclass:'footway'}]);
  assert.equal(new Set(tile.lineTypes.map(t => JSON.stringify(t))).size, tile.lineTypes.length, 'class table has no duplicates');
  assert.equal(tile.waterways.length, 1);
  assert.deepEqual(transportationType({highway:'primary_link'}), {class:'primary', subclass:''});
  assert.deepEqual(transportationType({highway:'unclassified'}), {class:'minor', subclass:''});
  assert.deepEqual(transportationType({highway:'construction'}), {class:'', subclass:''});
  assert.deepEqual(transportationType({highway:'service', bridge:'yes'}), {class:'service', subclass:'', brunnel:'bridge'});
  assert.deepEqual(transportationType({highway:'service', tunnel:'building_passage'}), {class:'service', subclass:'', brunnel:'tunnel'});
  assert.deepEqual(transportationType({highway:'track', ford:'yes', bridge:'no'}), {class:'track', subclass:'', brunnel:'ford'});
});

test('viewer groups classified lines and leaves older or misaligned tiles unclassified', () => {
  const classified = transportationGroups({roads:['a','b','c'], paths:['d'], lineTypes:[{class:'service',subclass:''},{class:'path',subclass:'steps'}], roadTypes:[0,0,0], pathTypes:[1]});
  assert.deepEqual(classified.map(g => [g.kind, g.class, g.subclass, g.brunnel, g.lines]), [['roads','service','',null,['a','b','c']], ['paths','path','steps',null,['d']]]);
  const tunnels = transportationGroups({roads:['a','b'], lineTypes:[{class:'service',subclass:''},{class:'service',subclass:'',brunnel:'tunnel'}], roadTypes:[0,1]});
  assert.deepEqual(tunnels.map(g => [g.brunnel, g.lines]), [[null,['a']], ['tunnel',['b']]]);
  const old = transportationGroups({roads:['a'], paths:['b']});
  assert.deepEqual(old.map(g => [g.kind, g.class, g.subclass]), [['roads','',''], ['paths','','']]);
  const misaligned = transportationGroups({roads:['a','b'], lineTypes:[{class:'service',subclass:''}], roadTypes:[0]});
  assert.deepEqual(misaligned.map(g => [g.class, g.lines.length]), [['', 2]], 'a type list of the wrong length is ignored, not shifted');
  assert.deepEqual(transportationGroups({}), []);
});
