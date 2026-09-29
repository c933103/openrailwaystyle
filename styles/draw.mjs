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
    // Shortest arc, so an edge from 179° to −179° spans 2°, not 358°.
    const dLon = ((b[0] - a[0]) % 360 + 540) % 360 - 180;
    sum += rad(dLon) * (2 + Math.sin(rad(a[1])) + Math.sin(rad(b[1])));
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
export function formatRadius(km, units = 'metric') {
  if (units === 'imperial') { const ft = km * 3280.84; return ft < 52800 ? `${Math.round(ft).toLocaleString('en')} ft` : `${round(ft/5280, 2)} mi`; }
  return km < 10 ? `${Math.round(km*1000).toLocaleString('en')} m` : `${round(km, 2)} km`;
}
// Local planar coordinates in km around an origin; fine for the few
// kilometres a curve or a sketch spans.
const toPlane = ([lng0, lat0]) => { const k = Math.cos(rad(lat0)); return ([lng, lat]) => [rad(((lng - lng0) % 360 + 540) % 360 - 180)*R*k, rad(lat - lat0)*R]; };
const fromPlane = ([lng0, lat0]) => { const k = Math.cos(rad(lat0)); return ([x, y]) => [lng0 + x/(R*k)*180/Math.PI, lat0 + y/R*180/Math.PI]; };
// Smooth curve through the given points, one quintic Hermite span between
// each pair, so both direction and curvature run on without a break. At each
// point the direction bisects the chords either side and the curvature is
// that of the circle through it and its neighbours. Where the curve meets a
// straight stretch (before, after: the point before the first, after the
// last), it starts along the straight with no curvature, which then builds
// up over the first span, like a railway transition curve; a free end keeps
// its neighbour's curvature and mirrors its direction.
export function smoothCurve(points, steps = 24, {before, after} = {}) {
  if (points.length < 3) return points.map(p => [...p]);
  const [to, from] = [toPlane(points[0]), fromPlane(points[0])];
  const q = points.map(to), n = q.length, unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const chord = i => unit(sub(q[i+1], q[i]));
  const tangents = q.map((_, i) => i === 0 || i === n - 1 ? null : unit([chord(i-1)[0] + chord(i)[0], chord(i-1)[1] + chord(i)[1]]));
  const mirror = (c, t) => unit([2 * c[0] - t[0], 2 * c[1] - t[1]]);
  const along = (a, b) => unit(sub(to(b), to(a)));
  tangents[0] = before ? along(before, points[0]) : mirror(chord(0), tangents[1]);
  tangents[n - 1] = after ? along(points.at(-1), after) : mirror(chord(n - 2), tangents[n - 2]);
  // Curvature (signed, per km) through three points, as a vector along the
  // left normal of the direction there.
  const bend = i => {
    const a = sub(q[i], q[i-1]), b = sub(q[i+1], q[i]), c = sub(q[i+1], q[i-1]);
    const k = 2 * cross(a, b) / ((Math.hypot(...a) * Math.hypot(...b) * Math.hypot(...c)) || Infinity);
    return [-tangents[i][1] * k, tangents[i][0] * k];
  };
  const curvature = q.map((_, i) => i === 0 || i === n - 1 ? null : bend(i));
  curvature[0] = before ? [0, 0] : curvature[1];
  curvature[n - 1] = after ? [0, 0] : curvature[n - 2];
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const L = Math.hypot(...sub(q[i+1], q[i]));
    const v0 = tangents[i].map(c => c * L), v1 = tangents[i+1].map(c => c * L), a0 = curvature[i].map(c => c * L * L), a1 = curvature[i+1].map(c => c * L * L);
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t*t, t3 = t2*t, t4 = t3*t, t5 = t4*t;
      const h = [1 - 10*t3 + 15*t4 - 6*t5, t - 6*t3 + 8*t4 - 3*t5, 0.5*t2 - 1.5*t3 + 1.5*t4 - 0.5*t5, 0.5*t3 - t4 + 0.5*t5, -4*t3 + 7*t4 - 3*t5, 10*t3 - 15*t4 + 6*t5];
      out.push(from([0, 1].map(c => h[0]*q[i][c] + h[1]*v0[c] + h[2]*a0[c] + h[3]*a1[c] + h[4]*v1[c] + h[5]*q[i+1][c])));
    }
  }
  out.push([...points.at(-1)]);
  return out.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]);
}
// Least-squares circle through three or more points (Kåsa's method):
// {center, radiusKm}, or null when the points are (nearly) in a line.
export function fitCircle(points) {
  if (points.length < 3) return null;
  const [to, from] = [toPlane(points[0]), fromPlane(points[0])];
  const q = points.map(to);
  // Solve x² + y² + Dx + Ey + F = 0 by normal equations.
  let [sxx, sxy, sx, syy, sy, n, bx, by, b1] = [0,0,0,0,0,0,0,0,0];
  for (const [x, y] of q) { const z = x*x + y*y; sxx += x*x; sxy += x*y; sx += x; syy += y*y; sy += y; n++; bx -= z*x; by -= z*y; b1 -= z; }
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [bx, by, b1];
  const det = a => a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1]) - a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0]) + a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
  const d = det(m), scale = Math.max(...q.map(([x, y]) => Math.hypot(x - q[0][0], y - q[0][1])), 1e-9);
  if (Math.abs(d) < 1e-12 * scale**4 * n**2) return null;
  const col = k => m.map((row, i) => row.map((c, j) => j === k ? v[i] : c));
  const [D, E, F] = [0, 1, 2].map(k => det(col(k)) / d);
  const cx = -D/2, cy = -E/2, r2 = cx*cx + cy*cy - F;
  // A huge radius means the points are in a line.
  if (!(r2 > 0) || Math.sqrt(r2) > 1e4 * scale) return null;
  return {center: from([cx, cy]), radiusKm: Math.sqrt(r2), plane: {cx, cy, to, from}};
}
// The fitted arc from the first to the last point, on the side of the rest.
export function circleArc(fit, points, steps = 64) {
  const {cx, cy, to, from} = fit.plane, r = fit.radiusKm;
  const angle = p => { const [x, y] = to(p); return Math.atan2(y - cy, x - cx); };
  const a0 = angle(points[0]), a1 = angle(points.at(-1)), am = angle(points[Math.floor(points.length/2)]);
  const ccw = a => ((a - a0) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  // Go the way round that passes the middle point.
  const sweep = ccw(am) < ccw(a1) ? ccw(a1) : ccw(a1) - 2*Math.PI;
  return Array.from({length: steps + 1}, (_, i) => { const a = a0 + sweep*i/steps; return from([cx + r*Math.cos(a), cy + r*Math.sin(a)]); });
}
const finite = p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite);
// Drawing style kept on each feature and in saved files.
const DASHES = ['solid', 'dashed', 'dotted'];
export function drawingStyle(properties = {}) {
  const style = {};
  if (/^#[0-9a-f]{6}$/i.test(properties.color || '')) style.color = properties.color.toLowerCase();
  if (DASHES.includes(properties.dash)) style.dash = properties.dash;
  if (Number.isFinite(properties.width) && properties.width >= 1 && properties.width <= 12) style.width = properties.width;
  return style;
}
// Accept drawings from a file: points, lines and areas only, split from
// multi-geometries. Anything else is skipped.
export function readDrawing(json) {
  const features = json?.type === 'FeatureCollection' ? json.features : json?.type === 'Feature' ? [json] : [];
  const out = [];
  for (const f of features || []) {
    const g = f?.geometry, name = typeof f?.properties?.name === 'string' ? f.properties.name : undefined;
    const properties = {...(name ? {name} : {}), ...drawingStyle(f?.properties || {})};
    const add = geometry => out.push({type:'Feature', properties:{...properties}, geometry});
    const line = c => (c || []).filter(finite).map(p => p.slice(0, 2));
    if (g?.type === 'Point' && finite(g.coordinates)) add({type:'Point', coordinates:g.coordinates.slice(0, 2)});
    else if (g?.type === 'MultiPoint') { for (const p of line(g.coordinates)) add({type:'Point', coordinates:p}); }
    else if (g?.type === 'LineString') {
      // Lines drawn here keep their points and which of them are curve
      // points (line_points, curved); curve_points is the older form, all
      // curved.
      const c = line(g.coordinates), legacy = line(f.properties?.curve_points), points = line(f.properties?.line_points);
      const nodes = points.length >= 2 ? points : legacy;
      const curved = points.length >= 2 ? f.properties?.curved : legacy.map(() => 1);
      if (c.length >= 2) {
        add({type:'LineString', coordinates:c});
        if (nodes.length >= 2 && Array.isArray(curved) && curved.length === nodes.length) Object.assign(out.at(-1).properties, {line_points: nodes, curved: curved.map(v => v ? 1 : 0)});
      }
    }
    else if (g?.type === 'MultiLineString') { for (const l of g.coordinates || []) { const c = line(l); if (c.length >= 2) add({type:'LineString', coordinates:c}); } }
    else if (g?.type === 'Polygon') { const c = line(g.coordinates?.[0]); if (c.length >= 4) add({type:'Polygon', coordinates:[c]}); }
    else if (g?.type === 'MultiPolygon') { for (const poly of g.coordinates || []) { const c = line(poly?.[0]); if (c.length >= 4) add({type:'Polygon', coordinates:[c]}); } }
  }
  return out;
}

// A line through points where each point is a corner (0) or a curve point
// (1): runs of curve points are drawn as a smooth curve, and the line turns
// sharply at corners, so one line can join straight track and curves. The
// ends are always corners. Where a curve meets a straight stretch, it
// leaves (or joins) it along the straight, without a corner; a corner
// between two curves stays a corner.
export function buildLine(points, curved) {
  if (points.length < 2) return points.map(p => [...p]);
  const breaks = points.map((_, i) => i === 0 || i === points.length - 1 || !curved[i]).flatMap((b, i) => b ? [i] : []);
  const straight = k => k >= 1 && k < breaks.length && breaks[k] - breaks[k-1] === 1;
  const out = [];
  for (let k = 1; k < breaks.length; k++) {
    const [a, b] = [breaks[k-1], breaks[k]], run = points.slice(a, b + 1);
    const part = run.length > 2 ? smoothCurve(run, 24, {before: straight(k - 1) ? points[a - 1] : undefined, after: straight(k + 1) ? points[b + 1] : undefined}) : run.map(p => [...p]);
    out.push(...(out.length ? part.slice(1) : part));
  }
  return out;
}
// Editable points of a drawing (with their corner/curve flags for lines):
// a line's points, an area's corners (without the closing repeat), or the
// point.
export function editableNodes(feature) {
  const g = feature.geometry, p = feature.properties || {};
  if (g.type === 'Point') return {points: [g.coordinates], curved: [0]};
  if (g.type === 'Polygon') { const ring = g.coordinates[0].slice(0, -1); return {points: ring, curved: ring.map(() => 0)}; }
  if (p.line_points) return {points: p.line_points, curved: p.curved};
  return {points: g.coordinates, curved: g.coordinates.map(() => 0)};
}
export const editablePoints = feature => editableNodes(feature).points;
const MIN_POINTS = {Point: 1, LineString: 2, Polygon: 3};
// A copy of the drawing with its editable points (and, for lines, flags)
// replaced, or null when too few remain for its kind.
export function withNodes(feature, points, curved = editableNodes(feature).curved) {
  const type = feature.geometry.type;
  if (points.length < MIN_POINTS[type]) return null;
  const {line_points, curved: _, ...properties} = feature.properties || {};
  let coordinates;
  if (type === 'Point') coordinates = points[0];
  else if (type === 'Polygon') coordinates = [[...points, points[0]]];
  else if (curved.some(Boolean)) { Object.assign(properties, {line_points: points, curved}); coordinates = buildLine(points, curved); }
  else coordinates = points;
  return {...feature, properties, geometry: {type, coordinates}};
}
export const withPoints = (feature, points) => withNodes(feature, points);
// Drag a point to move it. layer: an invisible circle layer, larger than the
// visible points so a fingertip finds them, whose features carry what move
// needs. Registered once: MapLibre keeps layer-bound listeners across style
// replacements. Returns a check for the click that ends a drag, which must
// not also act.
export const pointTarget = (id, source, filter) => ({id, type:'circle', source, ...(filter ? {filter} : {}),
  paint:{'circle-radius':18, 'circle-color':'#000', 'circle-opacity':0.01}});
function dragPoints(map, layer, {enabled, move, done}) {
  let drag = null, quietUntil = 0;
  const start = (e, touch) => {
    if (!enabled() || (touch ? e.originalEvent.touches?.length > 1 : e.originalEvent.button !== 0)) return;
    const feature = e.features?.[0];
    if (!feature) return;
    e.preventDefault(); // no map panning for this gesture
    drag = {properties: feature.properties, from: e.point, moved: false, slop: touch ? 10 : 4};
  };
  const moving = e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.point.x - drag.from.x, e.point.y - drag.from.y) < drag.slop) return;
    drag.moved = true;
    move(drag.properties, [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]);
  };
  const end = () => { if (drag?.moved) { quietUntil = Date.now() + 700; done(); } drag = null; };
  map.on('mousedown', layer, e => start(e, false));
  map.on('touchstart', layer, e => start(e, true));
  map.on('mousemove', moving); map.on('touchmove', moving);
  map.on('mouseup', end); map.on('touchend', end); map.on('touchcancel', end);
  map.on('mouseenter', layer, () => { if (enabled()) map.getCanvas().style.cursor = 'move'; });
  map.on('mouseleave', layer, () => { if (enabled()) map.getCanvas().style.cursor = 'crosshair'; });
  return () => Date.now() < quietUntil;
}
const EDIT_HINT = ' Click a point to select it; drag a point to move it.';
const DRAW_EDIT_HINT = EDIT_HINT.slice(0, -1) + '; click or drag the small dot in the middle of a segment to add a point there.';
// A click on a point just added belongs to a double-click, not a selection.
const DOUBLE_CLICK_MS = 500;

const STORE = 'openrailwayatlas-drawing';
const COLOR = '#c2185b';
const colour = ['coalesce', ['get','color'], COLOR];
const HINTS = {point:'Click to place points.', line:'Click to add points; double-click or Finish to end. Turn on Curved for curve points (smooth), off for corners (straight). With the drawing tools closed, click a line for its elevation profile.', area:'Click to add corners; double-click or Finish to close.', erase:'Click a drawing to delete it.'};
export class Drawing {
  constructor(map, {units = () => 'metric', status = () => {}, changed = () => {}} = {}) {
    Object.assign(this, {map, units, status, changed});
    this.features = []; this.draft = []; this.draftCurved = []; this.mode = null; this.paused = false; this.cursor = null; this.next = 1;
    this.curved = false; this.selected = null; this.extending = null; this.lastAdd = 0;
    this.style = {color: COLOR, dash: 'solid', width: 3};
    try { this.add(readDrawing(JSON.parse(localStorage.getItem(STORE) || 'null')), false); } catch {}
    this.dragging = dragPoints(map, 'drawing-handle-targets', {
      enabled: () => this.mode !== null && !this.paused,
      move: (handle, p) => {
        // Dragging a segment's middle handle inserts a point there, then
        // moves it.
        if (handle.mid) { this.insertPoint(handle.drawing, handle.after + 1, p); Object.assign(handle, {mid: undefined, index: handle.after + 1}); return; }
        this.movePoint(handle.drawing, handle.index, p);
      },
      done: () => this.save(),
    });
  }
  get active() { return this.mode !== null; }
  get multiPoint() { return this.mode === 'line' || this.mode === 'area'; }
  // Sources and layers are re-added after every style replacement.
  install() {
    const map = this.map;
    if (!map.getSource('atlas-drawing')) map.addSource('atlas-drawing', {type:'geojson', data:this.collection(true)});
    if (!map.getSource('atlas-drawing-draft')) map.addSource('atlas-drawing-draft', {type:'geojson', data:this.draftCollection()});
    if (!map.getSource('atlas-drawing-handles')) map.addSource('atlas-drawing-handles', {type:'geojson', data:this.handleCollection()});
    const label = {'text-field':['get','measure'],'text-font':['Noto Sans Bold'],'text-size':12,'text-allow-overlap':true};
    const labelPaint = {'text-color':colour,'text-halo-color':'#fffef8','text-halo-width':2};
    // line-dasharray cannot vary by feature: one line layer per dash style.
    const line = (id, dash, dasharray) => ({id, type:'line', source:'atlas-drawing',
      filter:['all', ['!=',['geometry-type'],'Point'], ['==', ['coalesce',['get','dash'],'solid'], dash]],
      layout:{'line-join':'round','line-cap':'round'},
      paint:{'line-color':colour, 'line-width':['coalesce',['get','width'],3], ...(dasharray ? {'line-dasharray':dasharray} : {})}});
    const selected = ['boolean', ['get','selected'], false];
    this.layers = [
      {id:'drawing-fill', type:'fill', source:'atlas-drawing', filter:['==',['geometry-type'],'Polygon'], paint:{'fill-color':colour,'fill-opacity':0.14}},
      line('drawing-line', 'solid'), line('drawing-line-dashed', 'dashed', [2.5, 1.8]), line('drawing-line-dotted', 'dotted', [0.1, 2]),
      {id:'drawing-points', type:'circle', source:'atlas-drawing', filter:['==',['geometry-type'],'Point'], paint:{'circle-color':colour,'circle-radius':['+', 3, ['coalesce',['get','width'],3]],'circle-stroke-color':'#fffef8','circle-stroke-width':2}},
      // symbol-placement cannot vary by feature: one layer each.
      {id:'drawing-line-labels', type:'symbol', source:'atlas-drawing', filter:['==',['geometry-type'],'LineString'], layout:{...label, 'symbol-placement':'line-center'}, paint:labelPaint},
      {id:'drawing-area-labels', type:'symbol', source:'atlas-drawing', filter:['==',['geometry-type'],'Polygon'], layout:label, paint:labelPaint},
      {id:'drawing-draft-line', type:'line', source:'atlas-drawing-draft', filter:['!=',['geometry-type'],'Point'], paint:{'line-color':colour,'line-width':2,'line-dasharray':[2,1.5]}},
      // Editable points, shown while a drawing tool is in use: curve points
      // round, corners square-ish (thicker ring); the selected one filled.
      {id:'drawing-handles', type:'circle', source:'atlas-drawing-handles', paint:{
        'circle-color':['case', selected, colour, '#fffef8'], 'circle-radius':['case', ['has','mid'], 3.5, selected, 7, 5],
        'circle-stroke-color':['case', selected, '#fffef8', colour], 'circle-stroke-width':['case', ['has','mid'], 1.2, ['==', ['get','curved'], 1], 1.5, 2.5],
        'circle-opacity':['case', ['has','mid'], 0.75, 1], 'circle-stroke-opacity':['case', ['has','mid'], 0.6, 1]}},
      pointTarget('drawing-handle-targets', 'atlas-drawing-handles'),
    ];
    for (const layer of this.layers) if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
  collection(withMeasure = false) {
    const units = this.units();
    // Rendered copies carry an id for erasing and their measurement; saved
    // files carry neither. A line being extended is saved as it was until
    // the extension is finished.
    const features = !withMeasure && this.extending ? [...this.features, this.extending.feature] : this.features;
    return {type:'FeatureCollection', features:features.map(({id, ...f}) => withMeasure ? {...f, properties:{...f.properties, drawing:id, measure:measure(f.geometry, units)}} : f)};
  }
  // The shape being drawn, including the pointer position.
  shape() {
    const points = this.cursor ? [...this.draft, this.cursor] : this.draft;
    const curved = this.cursor ? [...this.draftCurved, this.curved ? 1 : 0] : this.draftCurved;
    return this.mode === 'line' ? buildLine(points, curved) : points;
  }
  draftCollection() {
    const points = this.shape();
    const properties = {color: this.style.color};
    const features = [];
    if (points.length >= 2) features.push({type:'Feature', properties, geometry: this.mode === 'area' && points.length >= 3
      ? {type:'Polygon', coordinates:[[...points, points[0]]]} : {type:'LineString', coordinates:points}});
    return {type:'FeatureCollection', features};
  }
  // Handles for every drawing's points and the shape in progress (drawing
  // 0), and a fainter one in the middle of each segment for inserting a
  // point there (not in Erase).
  handleCollection() {
    if (!this.mode || this.paused) return {type:'FeatureCollection', features:[]};
    const handle = (coordinates, drawing, index, color, curved) => ({type:'Feature', geometry:{type:'Point', coordinates},
      properties:{drawing, index, color, curved: curved ? 1 : 0, selected: this.selected?.drawing === drawing && this.selected?.index === index}});
    const middles = (drawing, color, points, closed, drawn) => this.mode === 'erase' ? [] : points.slice(0, closed ? points.length : -1).map((p, i) => {
      const q = points[(i + 1) % points.length], chord = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      // On a curve, the drawn line's point nearest the chord's middle.
      const near = (a, b) => (b[0]-chord[0])**2 + (b[1]-chord[1])**2 < (a[0]-chord[0])**2 + (a[1]-chord[1])**2 ? b : a;
      const at = drawn.length ? drawn.reduce(near) : chord;
      return {type:'Feature', geometry:{type:'Point', coordinates: at}, properties:{drawing, after: i, mid: 1, color}};
    });
    return {type:'FeatureCollection', features:[
      ...this.features.flatMap(f => {
        const {points, curved} = editableNodes(f), polygon = f.geometry.type === 'Polygon';
        if (f.geometry.type === 'Point') return points.map((p, i) => handle(p, f.id, i, f.properties.color, 0));
        return [...middles(f.id, f.properties.color, points, polygon, polygon ? [] : f.geometry.coordinates), ...points.map((p, i) => handle(p, f.id, i, f.properties.color, curved[i]))];
      }),
      ...middles(0, this.style.color, this.draft, false, this.mode === 'line' ? buildLine(this.draft, this.draftCurved) : []),
      ...this.draft.map((p, i) => handle(p, 0, i, this.style.color, this.draftCurved[i])),
    ]};
  }
  // Insert a point before `index`: a curve point where either neighbour is
  // one (inside a curve), else a corner.
  insertPoint(drawing, index, p) {
    if (drawing === 0) {
      this.draft.splice(index, 0, p);
      this.draftCurved.splice(index, 0, this.mode === 'line' && (this.draftCurved[index - 1] || this.draftCurved[index]) ? 1 : 0);
      this.refresh(); return;
    }
    const at = this.features.findIndex(f => f.id === drawing);
    if (at < 0) return;
    const {points, curved} = editableNodes(this.features[at]), line = this.features[at].geometry.type === 'LineString';
    const flag = line && (curved[index - 1] || curved[index % curved.length]) ? 1 : 0;
    this.features[at] = withNodes(this.features[at], [...points.slice(0, index), p, ...points.slice(index)], [...curved.slice(0, index), flag, ...curved.slice(index)]);
    this.refresh();
  }
  nodesOf(drawing) {
    if (drawing === 0) return {points: this.draft, curved: this.draftCurved, type: this.mode === 'area' ? 'Polygon' : 'LineString'};
    const f = this.features.find(f => f.id === drawing);
    return f && {...editableNodes(f), type: f.geometry.type};
  }
  // What can be done with the selected point: delete it always; switch
  // between corner and curve point for a line's middle points; extend a
  // finished line from either end.
  selection() {
    if (!this.selected) return null;
    const nodes = this.nodesOf(this.selected.drawing);
    if (!nodes || !nodes.points[this.selected.index]) return null;
    const {index, drawing} = this.selected, last = nodes.points.length - 1, end = index === 0 || index === last;
    return {...this.selected, curved: Boolean(nodes.curved[index]),
      canCurve: nodes.type === 'LineString' && !end, canExtend: drawing !== 0 && nodes.type === 'LineString' && end};
  }
  select(selected) { this.selected = selected; this.refresh(); this.changed(); }
  movePoint(drawing, index, p) {
    if (drawing === 0) { if (this.draft[index]) this.draft[index] = p; this.refresh(); return; }
    const at = this.features.findIndex(f => f.id === drawing);
    if (at < 0) return;
    const {points, curved} = editableNodes(this.features[at]);
    const moved = [...points]; moved[index] = p;
    this.features[at] = withNodes(this.features[at], moved, curved); this.refresh();
  }
  // Delete one point; a drawing left with too few points is deleted.
  removePoint(drawing, index) {
    this.selected = null;
    if (drawing === 0) { this.draft.splice(index, 1); this.draftCurved.splice(index, 1); this.refresh(); this.changed(); return; }
    const at = this.features.findIndex(f => f.id === drawing);
    if (at < 0) return;
    const {points, curved} = editableNodes(this.features[at]);
    const keep = (_, i) => i !== index;
    const edited = withNodes(this.features[at], points.filter(keep), curved.filter(keep));
    if (edited) this.features[at] = edited; else this.features.splice(at, 1);
    this.save();
  }
  deleteSelected() { const s = this.selection(); if (s) this.removePoint(s.drawing, s.index); }
  // Switch the selected point between corner and curve point.
  toggleSelectedCurve() {
    const s = this.selection();
    if (!s?.canCurve) return;
    if (s.drawing === 0) { this.draftCurved[s.index] = s.curved ? 0 : 1; this.refresh(); this.changed(); return; }
    const at = this.features.findIndex(f => f.id === s.drawing);
    const {points, curved} = editableNodes(this.features[at]);
    const flags = [...curved]; flags[s.index] = s.curved ? 0 : 1;
    this.features[at] = withNodes(this.features[at], points, flags);
    this.save();
  }
  // Continue a finished line from the selected end: it becomes the shape in
  // progress again (reversed when extended from its start), keeping its
  // style and name. The line as it was stays saved, and comes back if the
  // extension is cancelled, until Finish replaces it.
  extendSelected() {
    const s = this.selection();
    if (!s?.canExtend) return;
    const at = this.features.findIndex(f => f.id === s.drawing), feature = this.features[at];
    let {points, curved} = editableNodes(feature);
    if (s.index === 0) { points = [...points].reverse(); curved = [...curved].reverse(); }
    this.features.splice(at, 1);
    const {line_points, curved: _, measure: __, drawing: ___, ...properties} = feature.properties;
    this.extending = {feature, at, properties};
    this.style = {...this.style, ...drawingStyle(properties)};
    this.mode = 'line'; this.paused = false; this.selected = null;
    this.draft = points.map(p => [...p]); this.draftCurved = [...curved];
    this.map.doubleClickZoom.disable(); this.map.getCanvas().style.cursor = 'crosshair';
    this.refresh(); this.changed();
  }
  refresh() {
    this.map.getSource('atlas-drawing')?.setData(this.collection(true));
    this.map.getSource('atlas-drawing-draft')?.setData(this.draftCollection());
    this.map.getSource('atlas-drawing-handles')?.setData(this.handleCollection());
    const points = this.shape(), units = this.units();
    this.status(this.mode === 'line' && points.length >= 2 ? formatLength(lengthKm(points), units)
      : this.mode === 'area' && points.length >= 3 ? formatArea(areaKm2(points), units)
      : this.paused && this.mode ? 'Moving the map: drag, pinch or tap freely. Press Move map again to keep drawing.'
      : this.mode ? HINTS[this.mode] + (this.mode === 'erase' ? '' : DRAW_EDIT_HINT) : '');
  }
  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.collection())); } catch {}
    this.refresh(); this.changed();
  }
  setStyle(style) { this.style = {...this.style, ...drawingStyle({...this.style, ...style})}; this.refresh(); }
  setCurved(curved) { this.curved = Boolean(curved); this.refresh(); this.changed(); }
  setMode(mode) {
    this.finish();
    // Curve is the line tool starting with curve points on.
    if (mode === 'curve') { this.curved = true; mode = 'line'; }
    this.mode = this.mode === mode ? null : mode;
    this.paused = false; this.selected = null;
    // Double-click finishes a line or area instead of zooming.
    if (this.multiPoint) this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = this.mode ? 'crosshair' : '';
    this.refresh(); this.changed();
  }
  // Pause input so the map can be moved without leaving the drawing tools or
  // losing a shape in progress.
  setPaused(paused) {
    this.paused = paused;
    this.cursor = null; this.selected = null;
    if (this.multiPoint && !paused) this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = this.mode && !paused ? 'crosshair' : '';
    this.refresh(); this.changed();
  }
  newFeature(geometry) {
    const {color, dash, width} = this.style;
    return {type:'Feature', properties: geometry.type === 'Point' ? {color, width} : {color, dash, width}, geometry};
  }
  click(lngLat, point) {
    if (this.paused || this.dragging?.()) return;
    const p = [Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))];
    // Clicking the first corner closes an area.
    if (this.mode === 'area' && this.draft.length >= 3) {
      const first = this.map.project(this.draft[0]);
      if (Math.hypot(first.x - point.x, first.y - point.y) < 10) { this.finish(); return; }
    }
    // A click on a point selects it (not in Erase, which deletes whole
    // drawings). The click after a selection clears it.
    const handle = this.mode !== 'erase' && this.map.getLayer('drawing-handle-targets') && this.map.queryRenderedFeatures(point, {layers:['drawing-handle-targets']})[0];
    if (handle) {
      const {drawing, index, mid, after} = handle.properties;
      // A segment's middle handle: a new point there, selected.
      if (mid) {
        this.insertPoint(drawing, after + 1, handle.geometry?.coordinates ?? p);
        if (drawing !== 0) this.save();
        this.select({drawing, index: after + 1});
        return;
      }
      if (drawing === 0 && index === this.draft.length - 1 && Date.now() - this.lastAdd < DOUBLE_CLICK_MS) return;
      this.select({drawing, index});
      return;
    }
    if (this.selected) { this.select(null); return; }
    if (this.mode === 'point') this.add([this.newFeature({type:'Point', coordinates:p})]);
    else if (this.multiPoint) {
      this.draft.push(p); this.draftCurved.push(this.mode === 'line' && this.curved ? 1 : 0);
      this.lastAdd = Date.now(); this.refresh();
    } else if (this.mode === 'erase') {
      const box = [[point.x-6, point.y-6], [point.x+6, point.y+6]];
      const hit = this.map.queryRenderedFeatures(box, {layers:['drawing-points','drawing-line','drawing-line-dashed','drawing-line-dotted','drawing-fill']})[0];
      const index = hit ? this.features.findIndex(f => f.id === hit.properties.drawing) : -1;
      if (index >= 0) { this.features.splice(index, 1); this.save(); }
    }
  }
  move(lngLat) {
    if (!this.multiPoint || this.paused) return;
    this.cursor = [lngLat.lng, lngLat.lat]; this.refresh();
  }
  finish() {
    // A double-click may add its point twice before finishing.
    const keep = this.draft.map((p, i, all) => !i || p[0] !== all[i-1][0] || p[1] !== all[i-1][1]);
    const points = this.draft.filter((_, i) => keep[i]), curved = this.draftCurved.filter((_, i) => keep[i]);
    const n = points.length, extending = this.extending;
    this.draft = []; this.draftCurved = []; this.cursor = null; this.selected = null; this.extending = null;
    let feature = null;
    if (this.mode === 'line' && n >= 2) feature = withNodes(this.newFeature({type:'LineString', coordinates:points}), points, curved);
    else if (this.mode === 'area' && n >= 3) feature = this.newFeature({type:'Polygon', coordinates:[[...points, points[0]]]});
    if (!feature) { if (extending) this.restore(extending); else { this.refresh(); this.changed(); } return; }
    if (extending?.properties.name) feature.properties.name = extending.properties.name;
    this.add([feature]);
  }
  // Put back a line whose extension was cancelled.
  restore({feature, at}) {
    this.features.splice(Math.min(at, this.features.length), 0, feature);
    this.save();
  }
  cancel() {
    const extending = this.extending;
    this.draft = []; this.draftCurved = []; this.cursor = null; this.selected = null; this.extending = null;
    if (extending) this.restore(extending); else this.refresh();
  }
  undo() {
    this.selected = null;
    if (this.draft.length) { this.draft.pop(); this.draftCurved.pop(); this.refresh(); }
    else if (this.features.length) { this.features.pop(); this.save(); }
  }
  clear() { this.features = []; this.draft = []; this.draftCurved = []; this.cursor = null; this.selected = null; this.extending = null; this.save(); }
  add(features, store = true) {
    this.features.push(...features.map(f => ({...f, id:this.next++})));
    if (store) this.save();
  }
  file() { return new Blob([JSON.stringify(this.collection(), null, 1)], {type:'application/geo+json'}); }
}

// Measuring: a multi-segment distance, or the radius of a curve fitted to
// three or more points on it. Measurements are not kept.
const INK = '#16414d';
// Height difference and gradient between the ends of a route of `km`.
export function climb(start, end, km) {
  if (start === null || end === null || !(km > 0)) return null;
  const rise = end - start;
  return {rise, gradient: rise / (km * 1000)};
}
// A height difference and gradient: "+12 m · 1.20% (12.0‰)".
export function formatClimb({rise, gradient}, units = 'metric') {
  const value = units === 'imperial' ? rise * 3.28084 : rise, unit = units === 'imperial' ? 'ft' : 'm';
  const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
  return `${sign(Math.round(value))} ${unit} · ${sign(Number((gradient * 100).toFixed(2)))}% (${Math.abs(gradient * 1000).toFixed(1)}‰)`;
}
export class Measure {
  // heights(points): a promise of the height at each point, for the rise
  // and gradient between a distance's ends (none when not given).
  constructor(map, {units = () => 'metric', status = () => {}, changed = () => {}, heights = null} = {}) {
    Object.assign(this, {map, units, status, changed, heights});
    this.climb = null;
    this.mode = null; this.points = []; this.cursor = null; this.ended = false; this.selected = null; this.lastAdd = 0;
    this.dragging = dragPoints(map, 'measure-point-targets', {
      enabled: () => this.mode !== null,
      move: ({index}, p) => { if (this.points[index]) { this.points[index] = p; this.refresh(); } },
      done: () => {},
    });
  }
  get active() { return this.mode !== null; }
  install() {
    const map = this.map;
    if (!map.getSource('atlas-measure')) map.addSource('atlas-measure', {type:'geojson', data:this.collection()});
    const text = {'text-font':['Noto Sans Bold'],'text-size':12,'text-allow-overlap':true,'text-ignore-placement':true};
    const halo = {'text-color':INK,'text-halo-color':'#fffef8','text-halo-width':2.5};
    const selected = ['boolean', ['get','selected'], false];
    const layers = [
      {id:'measure-line', type:'line', source:'atlas-measure', filter:['==',['get','kind'],'segment'], layout:{'line-cap':'round'}, paint:{'line-color':INK,'line-width':2.5,'line-dasharray':[3,1.5]}},
      {id:'measure-arc', type:'line', source:'atlas-measure', filter:['==',['get','kind'],'arc'], layout:{'line-cap':'round'}, paint:{'line-color':'#e0701b','line-width':3}},
      pointTarget('measure-point-targets', 'atlas-measure', ['has','index']),
      {id:'measure-points', type:'circle', source:'atlas-measure', filter:['has','index'], paint:{'circle-color':['case', selected, INK, '#fffef8'],'circle-radius':['case', selected, 6.5, 4.5],'circle-stroke-color':['case', selected, '#fffef8', INK],'circle-stroke-width':2}},
      {id:'measure-segment-labels', type:'symbol', source:'atlas-measure', filter:['all',['==',['get','kind'],'segment'],['has','label']], layout:{...text,'text-field':['get','label'],'symbol-placement':'line-center','text-size':11}, paint:halo},
      {id:'measure-labels', type:'symbol', source:'atlas-measure', filter:['all',['==',['geometry-type'],'Point'],['has','label']], layout:{...text,'text-field':['get','label'],'text-offset':[0,-1.3]}, paint:halo},
    ];
    for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
  collection() {
    const units = this.units(), live = this.cursor && !this.ended && this.mode === 'distance' ? [...this.points, this.cursor] : this.points;
    const feature = (geometry, properties = {}) => ({type:'Feature', properties, geometry});
    const features = this.points.map((p, index) => feature({type:'Point', coordinates:p}, {index, selected: this.selected === index}));
    if (this.mode === 'distance') {
      for (let i = 1; i < live.length; i++) features.push(feature({type:'LineString', coordinates:[live[i-1], live[i]]}, {kind:'segment', ...(live.length > 2 ? {label: formatLength(lengthKm([live[i-1], live[i]]), units)} : {})}));
      const climbed = this.ended && this.climbFor() && this.climb?.key === this.climbFor() ? this.climb.value : null;
      if (live.length >= 2) features.push(feature({type:'Point', coordinates:live.at(-1)}, {kind:'total', label: formatLength(lengthKm(live), units) + (climbed ? `\n${formatClimb(climbed, units)}` : '')}));
    } else if (this.mode === 'radius') {
      const fit = fitCircle(this.points);
      if (fit) {
        const arc = circleArc(fit, this.points);
        features.push(feature({type:'LineString', coordinates:arc}, {kind:'arc'}));
        features.push(feature({type:'Point', coordinates:arc[Math.floor(arc.length/2)]}, {kind:'radius', label:`R ≈ ${formatRadius(fit.radiusKm, units)}`}));
      }
    }
    return {type:'FeatureCollection', features};
  }
  // The finished distance's ends, as a key for its heights.
  climbFor() { return this.mode === 'distance' && this.points.length >= 2 ? JSON.stringify([this.points[0], this.points.at(-1), lengthKm(this.points)]) : null; }
  // Heights of a finished distance's ends, fetched once per pair of ends.
  updateClimb() {
    const key = this.ended ? this.climbFor() : null;
    if (!key || !this.heights || this.climb?.key === key) return;
    this.climb = {key, value: null};
    const km = lengthKm(this.points);
    this.heights([this.points[0], this.points.at(-1)]).then(([a, b]) => {
      if (this.climb?.key !== key) return;
      this.climb.value = climb(a, b, km);
      this.refresh();
    }).catch(() => {});
  }
  refresh() {
    this.updateClimb();
    this.map.getSource('atlas-measure')?.setData(this.collection());
    const units = this.units(), hint = this.points.length ? EDIT_HINT : '';
    if (this.mode === 'distance') {
      const live = this.cursor && !this.ended ? [...this.points, this.cursor] : this.points;
      const climbed = this.ended && this.climb?.key === this.climbFor() ? this.climb.value : null;
      const heights = !this.ended || !this.heights ? '' : climbed ? ` End to end: ${formatClimb(climbed, units)}.` : this.climb?.key === this.climbFor() && this.climb.value === null ? ' Finding heights…' : '';
      this.status(live.length >= 2 ? `Distance: ${formatLength(lengthKm(live), units)} over ${live.length - 1} segment${live.length > 2 ? 's' : ''}${this.ended ? '' : ' · double-click to end'}.${heights}${hint}` : `Click points to measure; double-click to end.${hint}`);
    } else if (this.mode === 'radius') {
      const fit = fitCircle(this.points);
      this.status(fit ? `Curve radius ≈ ${formatRadius(fit.radiusKm, units)}, fitted to ${this.points.length} points. Add more points along the curve to refine it.${hint}`
        : this.points.length >= 3 ? `These points are in a line; click points around the curve.${hint}` : `Click ${3 - this.points.length} more point${this.points.length === 2 ? '' : 's'} along the curve.${hint}`);
    } else this.status('');
  }
  setMode(mode) {
    this.mode = this.mode === mode ? null : mode;
    this.points = []; this.cursor = null; this.ended = false; this.selected = null;
    if (this.mode === 'distance') this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = this.mode ? 'crosshair' : '';
    this.refresh(); this.changed();
  }
  select(index) { this.selected = index; this.refresh(); this.changed(); }
  deleteSelected() {
    if (this.selected === null || !this.points[this.selected]) return;
    this.points.splice(this.selected, 1); this.selected = null;
    if (this.points.length < 2) this.ended = false;
    this.refresh(); this.changed();
  }
  click(lngLat, point) {
    if (!this.mode || this.dragging?.()) return;
    // A click on a point selects it; the click after a selection clears it.
    const handle = point && this.map.getLayer?.('measure-point-targets') && this.map.queryRenderedFeatures(point, {layers:['measure-point-targets']})[0];
    if (handle) {
      const {index} = handle.properties;
      if (index === this.points.length - 1 && Date.now() - this.lastAdd < DOUBLE_CLICK_MS) return;
      this.select(index); return;
    }
    if (this.selected !== null) { this.select(null); return; }
    // After a finished distance, the next click starts a new one.
    if (this.ended) { this.points = []; this.ended = false; }
    const p = [Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))];
    const last = this.points.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) { this.points.push(p); this.lastAdd = Date.now(); }
    this.refresh();
  }
  move(lngLat) { if (this.mode === 'distance' && !this.ended) { this.cursor = [lngLat.lng, lngLat.lat]; this.refresh(); } }
  end() { if (this.mode === 'distance' && this.points.length >= 2) { this.ended = true; this.cursor = null; this.refresh(); } }
  undo() { this.ended = false; this.selected = null; this.points.pop(); this.refresh(); this.changed(); }
  clear() { this.points = []; this.cursor = null; this.ended = false; this.selected = null; this.refresh(); this.changed(); }
}
