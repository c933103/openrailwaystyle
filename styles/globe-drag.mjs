// Moving the globe as a globe.
// - Dragging keeps the direction of travel and the compass heading: a
//   sideways drag runs along the parallel (from Japan to California, not
//   along a great circle down to South America) and an up-and-down drag
//   along the meridian, the same distance on the planet per pixel at the
//   centre. Within the polar caps (beyond 85°) the globe turns as a ball
//   instead and carries on over the pole; the map is then the other way
//   up, as the ground under it is.
// - The planet keeps its size while dragging: MapLibre's zoom is relative
//   to the latitude of the centre (a zoom level shows a bigger planet
//   nearer the poles), so the zoom is adjusted as the centre's latitude
//   changes, as MapLibre's own panning does.
// - MapLibre stops the centre at 85.05° (where its tiles end) even on the
//   globe; allowPolarCentres lifts that while the globe is drawn, so the
//   view can pass over the poles like anywhere else.
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
export const toVector = ([lng, lat]) => [Math.cos(rad(lat)) * Math.cos(rad(lng)), Math.cos(rad(lat)) * Math.sin(rad(lng)), Math.sin(rad(lat))];
export const fromVector = ([x, y, z]) => [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const n = Math.hypot(...v); return v.map(c => c / n); };
// Avoid the singularity at exactly 90°, where MapLibre's latitude-relative
// zoom is undefined. The offset is about 1 mm on the ground, rather than
// the former 11 km barrier at 89.9° which froze small close-up drag steps.
export const POLE_LIMIT = 90 - 1e-8;
const MERCATOR_LIMIT = 85.051129;
// North and east directions at a point on the sphere.
function axes(c) {
  const [lng, lat] = fromVector(c), φ = rad(lat), λ = rad(lng);
  return {north: [-Math.sin(φ) * Math.cos(λ), -Math.sin(φ) * Math.sin(λ), Math.cos(φ)], east: [-Math.sin(λ), Math.cos(λ), 0]};
}
// The view as a frame: centre c and the direction that is up on screen, u.
export function startFrame(center, bearing) {
  const c = toVector(center), {north, east} = axes(c), β = rad(bearing);
  return {c, u: north.map((n, i) => n * Math.cos(β) + east[i] * Math.sin(β))};
}
// The view after a pointer movement of dx, dy pixels (right, down) at a
// constant heading: the centre moves the other way, by the pointer's
// distance on the planet, north–south along the meridian and east–west
// along the parallel; the bearing stays.
export function stepView(view, dx, dy, radiansPerPixel) {
  // The movement is followed as the same movement in many small events
  // would be, however the browser groups them, in closed form: at a
  // constant heading the centre runs along a rhumb line, and within the
  // polar caps (where a constant heading has no steady meaning: a step east
  // near a pole spins the view round it) the globe turns as a ball, about
  // one axis. Each part is followed to where it meets the edge of a cap, so
  // the work is a few segments whatever the distance.
  let left = 1, polar = Math.abs(view.center[1]) > POLAR_DRAG;
  for (let n = 0; left > 0 && n < SEGMENTS; n++) {
    const last = n === SEGMENTS - 1;
    if (polar) {
      const {view: next, used} = turnBall(view, dx * left, dy * left, radiansPerPixel, last);
      view = next; left *= 1 - used;
    } else {
      const {view: next, used} = rhumb(view, dx * left, dy * left, radiansPerPixel, last);
      view = next; left *= 1 - used;
    }
    if (left < 1e-12) break;
    polar = !polar;
  }
  return view;
}
// Where the constant heading gives way to turning the globe as a ball: the
// edge of the flat map's tiles.
export const POLAR_DRAG = 85;
// Each segment ends at the edge of a cap, so a drag needs one more than the
// number of cap edges it crosses; this bounds the work for any distance
// (the last segment takes what is left).
const SEGMENTS = 64;
// Along the rhumb line at the view's heading, until the movement ends or
// the centre reaches the edge of a polar cap (unless `all`). Returns the
// view and the fraction of the movement used.
function rhumb({center: [lng, lat], bearing}, dx, dy, radiansPerPixel, all) {
  const β = rad(bearing), right = -dx * radiansPerPixel, up = dy * radiansPerPixel;
  const north = deg(up * Math.cos(β) - right * Math.sin(β)), east = up * Math.sin(β) + right * Math.cos(β);
  let used = 1;
  // Moving towards a pole: stop at the cap's edge.
  if (!all && north && Math.abs(lat + north) > POLAR_DRAG && Math.sign(north) === Math.sign(lat + north)) used = Math.max(0, (Math.sign(north) * POLAR_DRAG - lat) / north);
  const φ = clampLat(lat + north * used);
  // East–west motion is magnified by 1/cos(latitude): over the rhumb line,
  // by the change of the Mercator y over the change of latitude.
  const y = l => Math.log(Math.tan(Math.PI / 4 + rad(l) / 2));
  const stretch = Math.abs(φ - lat) > 1e-9 ? (y(φ) - y(lat)) / rad(φ - lat) : 1 / Math.cos(rad(lat));
  let λ = lng + deg(east * used * stretch);
  λ = ((λ + 180) % 360 + 360) % 360 - 180;
  return {view: {center: [λ, φ], bearing}, used};
}
// Turning the globe as a ball for a movement of dx, dy pixels: many small
// turns about the screen's axes, as stepFrame makes, add up to one turn
// about a single axis. Stops where the centre leaves the polar cap (unless
// `all`). Returns the view and the fraction of the movement used.
function turnBall(view, dx, dy, radiansPerPixel, all) {
  const {c, u} = startFrame(view.center, view.bearing), r = cross(u, c);
  const b = dx * radiansPerPixel, a = dy * radiansPerPixel, angle = Math.hypot(a, b);
  if (!angle) return {view, used: 1};
  // The centre moves along the great circle through c towards m.
  const m = unit(r.map((v, i) => -v * b + u[i] * a));
  let t = angle;
  if (!all) {
    // z(t) = c.z cos t + m.z sin t = R cos(t − α): first outward crossing
    // of the cap's edge.
    const edge = Math.sin(rad(POLAR_DRAG)), R = Math.hypot(c[2], m[2]), α = Math.atan2(m[2], c[2]);
    if (R > edge) for (const level of [edge, -edge]) for (const sign of [1, -1]) {
      let x = α + sign * Math.acos(level / R);
      x = ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      // A crossing at the start (rounded to just below a full turn) counts.
      if (x > 2 * Math.PI - 1e-9) x = 0;
      const z = Math.cos(x - α) * R, slope = -Math.sin(x - α) * R;
      if (x < t && Math.sign(z) * slope < 0) t = x;
    }
  }
  const k = unit(cross(c, m));
  const turn = v => { const kv = cross(k, v), kd = dot(k, v); return unit(v.map((x, i) => x * Math.cos(t) + kv[i] * Math.sin(t) + k[i] * kd * (1 - Math.cos(t)))); };
  return {view: frameView({c: turn(c), u: turn(u)}), used: t / angle};
}
// Turn the frame for a pointer movement of dx, dy pixels (right, down):
// the globe follows the pointer, so the centre moves the other way.
export function stepFrame({c, u}, dx, dy, radiansPerPixel) {
  const b = dx * radiansPerPixel, a = dy * radiansPerPixel;
  const r = cross(u, c); // screen right
  const c1 = unit(c.map((v, i) => v * Math.cos(b) - r[i] * Math.sin(b)));
  return {
    c: unit(c1.map((v, i) => v * Math.cos(a) + u[i] * Math.sin(a))),
    u: unit(u.map((v, i) => v * Math.cos(a) - c1[i] * Math.sin(a))),
  };
}
export function frameView({c, u}) {
  const {north, east} = axes(c);
  return {center: fromVector(c), bearing: deg(Math.atan2(dot(u, east), dot(u, north)))};
}
const clampLat = lat => Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, lat));
// The zoom that shows the planet at the same size with the centre moved
// from oldLat to newLat (MapLibre's getZoomAdjustment).
// Ground scale on the globe is proportional to cos(center latitude)/2^zoom.
// Expose its equatorial equivalent for a stable readout while panning across
// a pole. MapLibre's camera/hash continues to use the latitude-relative value.
export const globeGroundZoom = (zoom, latitude) => zoomForLatitude(zoom, latitude, 0);
// The zoom the readout shows: MapLibre's own (the same as on the flat map, so
// it does not jump when the projection changes) up to 85.05°, and beyond it
// the zoom at 85.05° with the same ground scale, which stays continuous across
// a pole.
export const readoutZoom = (zoom, latitude) => zoomForLatitude(zoom, latitude, Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, latitude)));
// The view in the address (#zoom/lat/lng[/bearing[/pitch]], as MapLibre
// writes it). The zoom written is the readout zoom, which near a pole keeps
// the ground scale with a zoom the flat map can show, instead of MapLibre's
// latitude-relative one (negative close to a pole); coordinates get enough
// decimals for that ground scale, so a close-up polar view survives a link.
export function viewHash({zoom, lat, lng, bearing = 0, pitch = 0}) {
  const z = readoutZoom(zoom, lat), digits = Math.max(0, Math.ceil((z * Math.LN2 + Math.log(512 / 360 / 0.5)) / Math.LN10)), m = 10 ** digits;
  const round = v => Math.round(v * m) / m, b = Math.round(bearing * 10) / 10, p = Math.round(pitch);
  return `#${Math.round(z * 100) / 100}/${round(lat)}/${round(lng)}${b || p ? `/${b}` : ''}${p ? `/${p}` : ''}`;
}
export function parseViewHash(hash) {
  const parts = String(hash || '').replace(/^#/, '').split('/');
  if (parts.length < 3) return null;
  const [z, lat, lng, bearing = 0, pitch = 0] = parts.map(Number);
  if (![z, lat, lng, bearing, pitch].every(Number.isFinite) || Math.abs(lat) > 90) return null;
  const zoom = Math.abs(lat) > MERCATOR_LIMIT ? zoomForLatitude(z, Math.sign(lat) * MERCATOR_LIMIT, lat) : z;
  return {center: [lng, Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, lat))], zoom, bearing, pitch};
}
export const zoomForLatitude = (zoom, oldLat, newLat) => zoom + Math.log2(Math.cos(rad(clampLat(newLat))) / Math.cos(rad(clampLat(oldLat))));
// MapLibre's globe radius is worldSize / (2π cos(latitude)). Use its
// centre scale directly: inverse projection rounds very close polar
// latitudes to 90° and makes two nearby screen points identical.
export const globeRadiansPerPixel = (worldSize, latitude, pitch = 0) => 2 * Math.PI * Math.cos(rad(clampLat(latitude))) / (worldSize * Math.cos(rad(pitch)));
// Let the globe's centre go beyond 85.05°, up to POLE_LIMIT, while the globe
// is drawn (close up MapLibre draws the flat map, which cannot). MapLibre
// creates a new transform whenever the projection changes, so each one is
// adjusted as it arrives. LngLat: maplibregl.LngLat; minZoom(): the map's
// smallest zoom at the equator. On the globe the smallest zoom follows the
// latitude like the planet's size, which near a pole goes below what
// MapLibre accepts as a minimum (−2): there the transform's own minimum is
// set low and the real one applied here. Returns {refresh}, to call after
// the map's minimum zoom is set.
const LOWEST = -40;
export function allowPolarCentres(map, LngLat, minZoom) {
  const isGlobe = transform => Boolean(transform?._verticalPerspectiveTransform);
  // One constrain for every transform (MapLibre's transformConstrain). On a
  // projection change MapLibre copies it from the old transform to the new
  // one and constrains the new one before the map uses it, so it works on
  // the transform last handed over, not map.transform.
  let current = map.transform;
  const constrain = (lngLat, zoom) => {
    const t = current, result = t.defaultConstrain(lngLat, zoom);
    if (!isGlobe(t) || t.isGlobeRendering === false) return result;
    const lat = Math.abs(lngLat.lat) > MERCATOR_LIMIT ? clampLat(lngLat.lat) : result.center.lat;
    const lowest = minZoom() + Math.log2(Math.cos(rad(lat)));
    return {center: new LngLat(result.center.lng, lat), zoom: Math.max(lowest, Math.min(t.maxZoom, +zoom))};
  };
  const adjust = transform => { current = transform; transform.setConstrainOverride(constrain); };
  const refresh = () => { const t = map.transform; if (isGlobe(t)) t.setMinZoom(LOWEST); else if (t.minZoom !== minZoom()) map.setMinZoom(minZoom()); };
  // Zooming around the pointer: near a pole, MapLibre's globe zoom moves
  // the centre in longitude and latitude and clamps it at 85.05°, pulling
  // the view off the pole. There the centre moves instead along the great
  // circle towards the point under the pointer, which stays under it.
  const adjustHelper = helper => {
    const globe = helper?._verticalPerspectiveCameraHelper;
    if (!globe || globe.__polarCentres) return;
    const original = globe.handleMapControlsRollPitchBearingZoom.bind(globe);
    globe.handleMapControlsRollPitchBearingZoom = (deltas, tr) => {
      const at = deltas.around && tr.screenPointToLocation(deltas.around);
      if (!deltas.zoomDelta || Math.abs(tr.center.lat) <= POLAR_ZOOM_LATITUDE || !at || !Number.isFinite(at.lat)) return original(deltas, tr);
      if (deltas.bearingDelta) tr.setBearing(tr.bearing + deltas.bearingDelta);
      if (deltas.pitchDelta) tr.setPitch(tr.pitch + deltas.pitchDelta);
      if (deltas.rollDelta) tr.setRoll(tr.roll + deltas.rollDelta);
      const oldZoom = tr.zoom, oldLat = tr.center.lat;
      tr.setZoom(oldZoom + deltas.zoomDelta);
      const zoomed = tr.zoom - oldZoom;
      if (!zoomed) return;
      const view = frameView(zoomTowards(startFrame([tr.center.lng, tr.center.lat], tr.bearing), [at.lng, at.lat], zoomed));
      tr.setCenter(new LngLat(view.center[0], view.center[1]));
      tr.setBearing(view.bearing);
      tr.setZoom(zoomForLatitude(tr.zoom, oldLat, tr.center.lat));
    };
    globe.__polarCentres = true;
  };
  adjust(map.transform); adjustHelper(map.cameraHelper); refresh();
  const migrate = map.migrateProjection.bind(map);
  map.migrateProjection = (transform, helper) => { adjust(transform); adjustHelper(helper); const result = migrate(transform, helper); refresh(); return result; };
  return {refresh};
}
// Above this latitude zooming around the pointer uses zoomTowards.
const POLAR_ZOOM_LATITUDE = 70;
// Move the view's centre towards the point `at` for a zoom change of
// `zoomed` levels, so that the point keeps its place on screen: the centre
// covers the fraction 1 − 2^−zoomed of the way (backwards when zooming out).
export function zoomTowards({c, u}, at, zoomed) {
  const target = toVector(at), axis = cross(c, target), n = Math.hypot(...axis);
  const angle = Math.atan2(n,dot(c,target));
  if (n < 1e-12) return {c, u};
  const k = axis.map(v => v / n), w = angle * (1 - 2 ** -zoomed);
  const turn = v => { const kv = cross(k, v), kd = dot(k, v); return unit(v.map((x, i) => x * Math.cos(w) + kv[i] * Math.sin(w) + k[i] * kd * (1 - Math.cos(w)))); };
  return {c: turn(c), u: turn(u)};
}
// Install on a MapLibre map. active(): whether the globe is showing;
// ignore(point): true where a press belongs to something else (editable
// points). Two fingers still pinch and rotate through MapLibre. Returns
// {sync, justDragged}: sync() hands panning to MapLibre or to this as the
// projection changes; justDragged() is true for the click that ends a drag
// (moving the camera resets MapLibre's record of where the press began, so
// it would otherwise report that release as a click on the map).
export function installGlobeDrag(map, {active, ignore = () => false}) {
  const canvas = map.getCanvasContainer(), pointers = new Set();
  let drag = null, quietUntil = 0;
  // In layout pixels, as the map measures them: More detail draws the map
  // scaled down, so on-screen pixels are larger (k layout pixels each).
  const at = e => { const r = canvas.getBoundingClientRect(), k = r.width ? canvas.clientWidth / r.width : 1; return {x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k}; };
  // The globe's scale at the centre of the view, measured from the map.
  function radiansPerPixel() {
    const t = map.transform;
    if (t?.isGlobeRendering && t.worldSize > 0) return globeRadiansPerPixel(t.worldSize, t.center.lat, t.pitch);
    const {clientWidth: w, clientHeight: h} = map.getContainer();
    const a = map.unproject([w / 2, h / 2]), b = map.unproject([w / 2, h / 2 - 10]);
    // atan2 retains small angles: acos(dot) rounds to zero at close zooms
    // and loses precision on either side of a pole.
    const av = toVector([a.lng, a.lat]), bv = toVector([b.lng, b.lat]);
    const angle = Math.atan2(Math.hypot(...cross(av, bv)), dot(av, bv));
    return Number.isFinite(angle) && angle > 0 ? angle / 10 : null;
  }
  canvas.addEventListener('pointerdown', e => {
    pointers.add(e.pointerId);
    if (pointers.size > 1) { drag = null; return; }
    if (!active() || e.button !== 0 || e.ctrlKey || e.metaKey) return;
    const p = at(e);
    if (ignore(p)) return;
    const c = map.getCenter();
    drag = {start: p, last: p, moved: false, view: {center: [c.lng, c.lat], bearing: map.getBearing()}};
  });
  const release = e => { pointers.delete(e.pointerId); if (drag?.moved) quietUntil = Date.now() + 400; drag = null; };
  addEventListener('pointerup', release); addEventListener('pointercancel', release);
  addEventListener('pointermove', e => {
    if (!drag || !pointers.has(e.pointerId)) return;
    const p = at(e);
    // A press becomes a drag after 3 on-screen pixels, whatever the scale.
    if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 3 * p.k) return;
    drag.moved = true;
    const scale = radiansPerPixel();
    if (!scale) return;
    drag.view = stepView(drag.view, p.x - drag.last.x, p.y - drag.last.y, scale);
    drag.last = p;
    const {center, bearing} = drag.view, before = map.getCenter().lat;
    map.jumpTo({center, bearing, zoom: zoomForLatitude(map.getZoom(), before, center[1])});
  });
  return {
    // MapLibre's panning is off while this handles the globe.
    sync: () => { if (active()) map.dragPan.disable(); else map.dragPan.enable(); },
    // Pan by dx, dy pixels (as map.panBy) the way a drag does, over the
    // poles; false when the flat map should pan instead.
    pan: (dx, dy, eventData) => {
      const scale = active() && radiansPerPixel();
      if (!scale) return false;
      const c = map.getCenter(), view = stepView({center: [c.lng, c.lat], bearing: map.getBearing()}, -dx, -dy, scale);
      map.jumpTo({center: view.center, bearing: view.bearing, zoom: zoomForLatitude(map.getZoom(), c.lat, view.center[1])}, eventData);
      return true;
    },
    justDragged: () => Date.now() < quietUntil,
  };
}
