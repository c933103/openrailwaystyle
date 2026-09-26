// Drawing tool: points, lines and areas drawn on the map, kept in this
// browser and saved or opened as GeoJSON files.
const R = 6371.0088; // mean Earth radius, km
const rad = d => d * Math.PI / 180;
export function lengthKm(coordinates) {
  let km = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [a, b] = [coordinates[i-1], coordinates[i]];
    const h = Math.sin(rad(b[1]-a[1])/2)**2 + Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(rad(b[0]-a[0])/2)**2;
    km += 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return km;
}
// Spherical excess of a ring (as in Chamberlain & Duquette), km².
export function areaKm2(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i+1) % ring.length]];
    sum += rad(b[0]-a[0]) * (2 + Math.sin(rad(a[1])) + Math.sin(rad(b[1])));
  }
  return Math.abs(sum * R * R / 2);
}
const round = (value, digits) => Number(value.toFixed(value < 10 ? digits : value < 100 ? 1 : 0)).toLocaleString('en');
export function formatLength(km, units = 'metric') {
  if (units === 'imperial') { const mi = km / 1.609344; return mi < 0.1 ? `${Math.round(mi*5280).toLocaleString('en')} ft` : `${round(mi, 2)} mi`; }
  return km < 1 ? `${Math.round(km*1000).toLocaleString('en')} m` : `${round(km, 2)} km`;
}
export function formatArea(km2, units = 'metric') {
  if (units === 'imperial') { const mi2 = km2 / 2.589988; return mi2 < 0.1 ? `${round(mi2*640, 1)} acres` : `${round(mi2, 2)} sq mi`; }
  return km2 < 1 ? `${round(km2*100, 1)} ha` : `${round(km2, 2)} km²`;
}
export function measure(geometry, units) {
  if (geometry.type === 'LineString') return formatLength(lengthKm(geometry.coordinates), units);
  if (geometry.type === 'Polygon') return formatArea(areaKm2(geometry.coordinates[0]), units);
  return '';
}
const finite = p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite);
// Accept drawings from a file: points, lines and areas only, split from
// multi-geometries. Anything else is skipped.
export function readDrawing(json) {
  const features = json?.type === 'FeatureCollection' ? json.features : json?.type === 'Feature' ? [json] : [];
  const out = [];
  for (const f of features || []) {
    const g = f?.geometry, name = typeof f?.properties?.name === 'string' ? f.properties.name : undefined;
    const add = geometry => out.push({type:'Feature', properties: name ? {name} : {}, geometry});
    const line = c => (c || []).filter(finite).map(p => p.slice(0, 2));
    if (g?.type === 'Point' && finite(g.coordinates)) add({type:'Point', coordinates:g.coordinates.slice(0, 2)});
    else if (g?.type === 'MultiPoint') { for (const p of line(g.coordinates)) add({type:'Point', coordinates:p}); }
    else if (g?.type === 'LineString') { const c = line(g.coordinates); if (c.length >= 2) add({type:'LineString', coordinates:c}); }
    else if (g?.type === 'MultiLineString') { for (const l of g.coordinates || []) { const c = line(l); if (c.length >= 2) add({type:'LineString', coordinates:c}); } }
    else if (g?.type === 'Polygon') { const c = line(g.coordinates?.[0]); if (c.length >= 4) add({type:'Polygon', coordinates:[c]}); }
    else if (g?.type === 'MultiPolygon') { for (const poly of g.coordinates || []) { const c = line(poly?.[0]); if (c.length >= 4) add({type:'Polygon', coordinates:[c]}); } }
  }
  return out;
}

const STORE = 'openrailwayatlas-drawing';
const COLOR = '#c2185b';
export class Drawing {
  constructor(map, {units = () => 'metric', status = () => {}, changed = () => {}} = {}) {
    Object.assign(this, {map, units, status, changed});
    this.features = []; this.draft = []; this.mode = null; this.cursor = null; this.next = 1;
    try { this.add(readDrawing(JSON.parse(localStorage.getItem(STORE) || 'null')), false); } catch {}
  }
  get active() { return this.mode !== null; }
  // Sources and layers are re-added after every style replacement.
  install() {
    const map = this.map;
    if (!map.getSource('atlas-drawing')) map.addSource('atlas-drawing', {type:'geojson', data:this.collection(true)});
    if (!map.getSource('atlas-drawing-draft')) map.addSource('atlas-drawing-draft', {type:'geojson', data:this.draftCollection()});
    const layers = [
      {id:'drawing-fill', type:'fill', source:'atlas-drawing', filter:['==',['geometry-type'],'Polygon'], paint:{'fill-color':COLOR,'fill-opacity':0.14}},
      {id:'drawing-line', type:'line', source:'atlas-drawing', filter:['!=',['geometry-type'],'Point'], layout:{'line-join':'round','line-cap':'round'}, paint:{'line-color':COLOR,'line-width':3}},
      {id:'drawing-points', type:'circle', source:'atlas-drawing', filter:['==',['geometry-type'],'Point'], paint:{'circle-color':COLOR,'circle-radius':6,'circle-stroke-color':'#fffef8','circle-stroke-width':2}},
      {id:'drawing-labels', type:'symbol', source:'atlas-drawing', filter:['!=',['coalesce',['get','measure'],''],''], layout:{'text-field':['get','measure'],'text-font':['Noto Sans Bold'],'text-size':12,'symbol-placement':['match',['geometry-type'],'LineString','line-center','point'],'text-allow-overlap':true}, paint:{'text-color':COLOR,'text-halo-color':'#fffef8','text-halo-width':2}},
      {id:'drawing-draft-line', type:'line', source:'atlas-drawing-draft', filter:['!=',['geometry-type'],'Point'], paint:{'line-color':COLOR,'line-width':2,'line-dasharray':[2,1.5]}},
      {id:'drawing-draft-vertices', type:'circle', source:'atlas-drawing-draft', filter:['==',['geometry-type'],'Point'], paint:{'circle-color':'#fffef8','circle-radius':4,'circle-stroke-color':COLOR,'circle-stroke-width':2}},
    ];
    for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
  collection(withMeasure = false) {
    const units = this.units();
    // Rendered copies carry an id for erasing and their measurement; saved
    // files carry neither.
    return {type:'FeatureCollection', features:this.features.map(({id, ...f}) => withMeasure ? {...f, properties:{...f.properties, drawing:id, measure:measure(f.geometry, units)}} : f)};
  }
  draftCollection() {
    const points = this.cursor ? [...this.draft, this.cursor] : this.draft;
    const features = this.draft.map(coordinates => ({type:'Feature', properties:{}, geometry:{type:'Point', coordinates}}));
    if (points.length >= 2) features.push({type:'Feature', properties:{}, geometry: this.mode === 'area' && points.length >= 3
      ? {type:'Polygon', coordinates:[[...points, points[0]]]} : {type:'LineString', coordinates:points}});
    return {type:'FeatureCollection', features};
  }
  refresh() {
    this.map.getSource('atlas-drawing')?.setData(this.collection(true));
    this.map.getSource('atlas-drawing-draft')?.setData(this.draftCollection());
    const points = this.cursor ? [...this.draft, this.cursor] : this.draft;
    const units = this.units();
    this.status(this.mode === 'line' && points.length >= 2 ? formatLength(lengthKm(points), units)
      : this.mode === 'area' && points.length >= 3 ? formatArea(areaKm2(points), units)
      : {point:'Click to place points.', line:'Click to add points; double-click or Finish to end.', area:'Click to add corners; double-click or Finish to close.', erase:'Click a drawing to delete it.'}[this.mode] || '');
  }
  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.collection())); } catch {}
    this.refresh(); this.changed();
  }
  setMode(mode) {
    this.finish();
    this.mode = this.mode === mode ? null : mode;
    // Double-click finishes a line or area instead of zooming.
    if (this.mode === 'line' || this.mode === 'area') this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = this.mode ? 'crosshair' : '';
    this.refresh(); this.changed();
  }
  click(lngLat, point) {
    const p = [Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))];
    if (this.mode === 'point') this.add([{type:'Feature', properties:{}, geometry:{type:'Point', coordinates:p}}]);
    else if (this.mode === 'line' || this.mode === 'area') {
      // Clicking the first corner closes an area.
      if (this.mode === 'area' && this.draft.length >= 3) {
        const first = this.map.project(this.draft[0]);
        if (Math.hypot(first.x - point.x, first.y - point.y) < 10) { this.finish(); return; }
      }
      this.draft.push(p); this.refresh();
    } else if (this.mode === 'erase') {
      const hit = this.map.queryRenderedFeatures([[point.x-6, point.y-6], [point.x+6, point.y+6]], {layers:['drawing-points','drawing-line','drawing-fill']})[0];
      const index = hit ? this.features.findIndex(f => f.id === hit.properties.drawing) : -1;
      if (index >= 0) { this.features.splice(index, 1); this.save(); }
    }
  }
  move(lngLat) {
    if (this.mode !== 'line' && this.mode !== 'area') return;
    this.cursor = [lngLat.lng, lngLat.lat]; this.refresh();
  }
  finish() {
    // A double-click adds its point twice before finishing.
    this.draft = this.draft.filter((p, i, all) => !i || p[0] !== all[i-1][0] || p[1] !== all[i-1][1]);
    const n = this.draft.length;
    const geometry = this.mode === 'line' && n >= 2 ? {type:'LineString', coordinates:this.draft}
      : this.mode === 'area' && n >= 3 ? {type:'Polygon', coordinates:[[...this.draft, this.draft[0]]]} : null;
    this.draft = []; this.cursor = null;
    if (geometry) this.add([{type:'Feature', properties:{}, geometry}]); else this.refresh();
  }
  cancel() { this.draft = []; this.cursor = null; this.refresh(); }
  undo() {
    if (this.draft.length) { this.draft.pop(); this.refresh(); }
    else if (this.features.length) { this.features.pop(); this.save(); }
  }
  clear() { this.features = []; this.draft = []; this.cursor = null; this.save(); }
  add(features, store = true) {
    this.features.push(...features.map(f => ({...f, id:this.next++})));
    if (store) this.save();
  }
  file() { return new Blob([JSON.stringify(this.collection(), null, 1)], {type:'application/geo+json'}); }
}
