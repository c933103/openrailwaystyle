import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {readDrawing, Drawing} from '../styles/draw.mjs';

const feature = (type, coordinates, properties = {}) => ({type:'Feature', properties, geometry:{type, coordinates}});
const point = feature('Point', [1,2], {name:'Healthy point'});
const line = [[0,0],[1,1],[2,0]];
const ring = [[0,0],[1,0],[1,1],[0,0]];
const collection = features => ({type:'FeatureCollection', features});

for (const type of ['MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon']) {
  for (const coordinates of [null, false, 7, 'broken', {}, {0:ring}]) {
    test(`drawing import isolates ${type} with ${JSON.stringify(coordinates)} coordinates`, () => {
      assert.deepEqual(readDrawing(collection([point, feature(type, coordinates), point])), [point,point]);
    });
  }
}
for (const features of [null, false, 7, 'broken', {}, {0:point}]) {
  test(`drawing import rejects non-array feature collections: ${JSON.stringify(features)}`, () => {
    assert.deepEqual(readDrawing(collection(features)), []);
  });
}

test('drawing import retains independent valid multi-geometry components', () => {
  const actual = readDrawing(collection([
    feature('MultiPoint', [[1,2],null,[3,4,5]]),
    feature('MultiLineString', [null,line,'broken',[[4,4],[5,5]]]),
    feature('MultiPolygon', [null,[ring],'broken',[ring]]),
  ]));
  assert.deepEqual(actual.map(f => f.geometry), [
    {type:'Point',coordinates:[1,2]}, {type:'Point',coordinates:[3,4]},
    {type:'LineString',coordinates:line}, {type:'LineString',coordinates:[[4,4],[5,5]]},
    {type:'Polygon',coordinates:[ring]}, {type:'Polygon',coordinates:[ring]},
  ]);
});

for (const bad of [null, [], [1], ['1',2], [1,null], [1,Infinity], [NaN,2]]) {
  test(`drawing import never joins across an invalid connected vertex: ${JSON.stringify(bad)}`, () => {
    const brokenLine = [line[0],bad,...line.slice(1)], brokenRing = [ring[0],bad,...ring.slice(1)];
    assert.deepEqual(readDrawing(collection([
      feature('LineString', brokenLine), feature('Polygon', [brokenRing]),
      feature('MultiLineString', [brokenLine,line]), feature('MultiPolygon', [[brokenRing],[ring]]),
    ])).map(f => f.geometry), [{type:'LineString',coordinates:line},{type:'Polygon',coordinates:[ring]}]);
  });
}

test('malformed optional editing points fall back to the complete line geometry', () => {
  for (const value of ['broken',{},[line[0],null,line[2]]]) {
    const [actual] = readDrawing(feature('LineString',line,{line_points:value,curve_points:value,curved:[0,1,0]}));
    assert.deepEqual(actual,feature('LineString',line));
  }
  const properties = {line_points:line,curved:[0,1,0]};
  assert.deepEqual(readDrawing(feature('LineString',line,properties)),[feature('LineString',line,properties)]);
});

test('import copies supported coordinates and does not mutate the supplied file', () => {
  const source = collection([feature('LineString',[[179,1,7],[181,2,8]]), point]);
  const before = structuredClone(source), output = readDrawing(source);
  assert.deepEqual(output[0].geometry.coordinates,[[179,1],[181,2]]);
  output[0].geometry.coordinates[0][0] = 0;
  assert.deepEqual(source,before);
});

test('saved drawings restore healthy siblings beside malformed geometry', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:()=>JSON.stringify(collection([point,feature('LineString','broken'),point])),
  }});
  try {
    const drawing = new Drawing({on(){}});
    assert.deepEqual(drawing.features.map(f=>f.geometry),[point.geometry,point.geometry]);
  } finally {
    if (previous) Object.defineProperty(globalThis,'localStorage',previous);
    else delete globalThis.localStorage;
  }
});

test('actual file-open handler adds healthy drawings and keeps malformed JSON separate', async () => {
  const app = await readFile(new URL('../styles/app.mjs',import.meta.url),'utf8');
  const begin = app.indexOf("$('draw-file').addEventListener('change', async () => {");
  const end = app.indexOf("\naddEventListener('keydown'",begin);
  assert.ok(begin>=0 && end>begin,'actual file-open handler boundaries exist');
  const dom = new JSDOM('<input id="draw-file" type="file"><p id="draw-status"></p>');
  const document = dom.window.document, $ = id=>document.getElementById(id), added = [];
  let change, text;
  $('draw-file').addEventListener = (type, callback) => {assert.equal(type,'change');change=callback;};
  Object.defineProperty($('draw-file'),'files',{value:[{text:async()=>text}]});
  try {
    vm.runInNewContext(app.slice(begin,end),{$,readDrawing,drawing:{add:items=>added.push(...items)}});
    text=JSON.stringify(collection([point,feature('LineString','broken'),point]));
    await change();
    assert.deepEqual(structuredClone(added),[point,point]);
    assert.equal($('draw-status').textContent,'Opened 2 drawings.');
    text='{';await change();
    assert.equal(added.length,2);
    assert.equal($('draw-status').textContent,'That file is not valid GeoJSON.');
    text=JSON.stringify(feature('LineString',[line[0],null,line[2]]));await change();
    assert.equal(added.length,2);
    assert.equal($('draw-status').textContent,'No points, lines or areas found in that file.');
  } finally {dom.window.close();}
});
