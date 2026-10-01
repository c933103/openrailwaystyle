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
export const fromVector = ([x, y, z]) => [deg(Math.atan2(y, x)), deg(Math.asin(Math.max(-1, Math.min(1, z))))];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const n = Math.hypot(...v); return v.map(c => c / n); };
// The centre may come this close to a pole; exactly at it the heading and
// MapLibre's zoom are undefined.
export const POLE_LIMIT = 89.9;
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
  // The movement is followed in small steps, each with the heading the last
  // one left, so it ends where the same movement in small events would
  // (however the browser groups them). East–west motion is magnified by
  // 1/cos(latitude) near the poles, so the steps shrink with it.
  const total = deg(Math.hypot(dx, dy) * radiansPerPixel);
  for (let done = 0, guard = 0; done < total && guard < 50000; guard++) {
    const size = Math.min(total - done, 0.05 * Math.max(0.02, Math.cos(rad(view.center[1]))));
    const f = size / total, d = dx * f, e = dy * f;
    // Within the polar caps a constant heading has no steady meaning (a
    // step east near a pole spins the view round it): there the globe turns
    // as a ball, over the pole, the heading following.
    view = Math.abs(view.center[1]) >= POLAR_DRAG ? frameView(stepFrame(startFrame(view.center, view.bearing), d, e, radiansPerPixel)) : step(view, d, e, radiansPerPixel);
    done += size;
  }
  return view;
}
// Where the constant heading gives way to turning the globe as a ball: the
// edge of the flat map's tiles.
export const POLAR_DRAG = 85;
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
function step({center: [lng, lat], bearing}, dx, dy, radiansPerPixel) {
  const β = rad(bearing), right = -dx * radiansPerPixel, up = dy * radiansPerPixel;
  const north = up * Math.cos(β) - right * Math.sin(β), east = up * Math.sin(β) + right * Math.cos(β);
  let φ = lat + deg(north);
  // East–west at the mean latitude of the step, never closer to a pole
  // than the centre may come (where a parallel is a point).
  const mid = rad(clampLat((lat + φ) / 2));
  let λ = lng + deg(east) / Math.cos(mid);
  // Over a pole: on down the far meridian, the view turned round.
  if (φ > 90 || φ < -90) { φ = Math.sign(φ) * 180 - φ; λ += 180; bearing += 180; }
  λ = ((λ + 180) % 360 + 360) % 360 - 180;
  bearing = ((bearing + 180) % 360 + 360) % 360 - 180;
  return {center: [λ, φ], bearing};
}
export function frameView({c, u}) {
  const {north, east} = axes(c);
  return {center: fromVector(c), bearing: deg(Math.atan2(dot(u, east), dot(u, north)))};
}
const clampLat = lat => Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, lat));
// The zoom that shows the planet at the same size with the centre moved
// from oldLat to newLat (MapLibre's getZoomAdjustment).
export const zoomForLatitude = (zoom, oldLat, newLat) => zoom + Math.log2(Math.cos(rad(clampLat(newLat))) / Math.cos(rad(clampLat(oldLat))));
// Let the globe's centre go beyond 85.05°, up to POLE_LIMIT, while the globe
// is drawn (close up MapLibre draws the flat map, which cannot). MapLibre
// creates a new transform whenever the projection changes, so each one is
// adjusted as it arrives. LngLat: maplibregl.LngLat; minZoom(): the map's
// smallest zoom at the equator. On the globe the smallest zoom follows the
// latitude like the planet's size, which near a pole goes below what
// MapLibre accepts as a minimum (−2): there the transform's own minimum is
// set low and the real one applied here. Returns {refresh}, to call after
// the map's minimum zoom is set.
const LOWEST = -24;
export function allowPolarCentres(map, LngLat, minZoom) {
  const isGlobe = transform => Boolean(transform?._verticalPerspectiveTransform);
  const adjust = transform => {
    if (!isGlobe(transform)) return;
    for (const t of [transform, transform._verticalPerspectiveTransform]) {
      if (t.__polarCentres || typeof t.getConstrained !== 'function') continue;
      const constrain = t.getConstrained.bind(t);
      t.getConstrained = (lngLat, zoom) => {
        const result = constrain(lngLat, zoom);
        if (transform.isGlobeRendering === false) return result;
        const lat = Math.abs(lngLat.lat) > MERCATOR_LIMIT ? clampLat(lngLat.lat) : result.center.lat;
        const lowest = minZoom() + Math.log2(Math.cos(rad(lat)));
        return {center: new LngLat(result.center.lng, lat), zoom: Math.max(lowest, Math.min(t.maxZoom, +zoom))};
      };
      t.__polarCentres = true;
    }
  };
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
  const target = toVector(at), angle = Math.acos(Math.max(-1, Math.min(1, dot(c, target))));
  const axis = cross(c, target), n = Math.hypot(...axis);
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
    const {clientWidth: w, clientHeight: h} = map.getContainer();
    const a = map.unproject([w / 2, h / 2]), b = map.unproject([w / 2, h / 2 - 10]);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(toVector([a.lng, a.lat]), toVector([b.lng, b.lat])))));
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
    justDragged: () => Date.now() < quietUntil,
  };
}
