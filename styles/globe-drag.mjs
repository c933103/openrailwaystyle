// Dragging the globe as a globe. MapLibre's own panning moves the centre in
// longitude and latitude and stops short of the poles; here a drag turns
// the sphere under the pointer, carrying the view over a pole with the
// heading turning as it would on a real globe. MapLibre cannot centre the
// view beyond about 85° (the edge of its tiles), so the orientation is
// tracked here through the whole drag and only its result is shown: over
// the polar cap the view waits at 85° and then continues on the other side.
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
export const toVector = ([lng, lat]) => [Math.cos(rad(lat)) * Math.cos(rad(lng)), Math.cos(rad(lat)) * Math.sin(rad(lng)), Math.sin(rad(lat))];
export const fromVector = ([x, y, z]) => [deg(Math.atan2(y, x)), deg(Math.asin(Math.max(-1, Math.min(1, z))))];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const n = Math.hypot(...v); return v.map(c => c / n); };
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
// MapLibre's tiles, and the centres it accepts, stop at this latitude.
export const LAT_LIMIT = 85.051129;
const forward = ({c, u}, angle) => ({
  c: unit(c.map((v, i) => v * Math.cos(angle) + u[i] * Math.sin(angle))),
  u: unit(u.map((v, i) => v * Math.cos(angle) - c[i] * Math.sin(angle))),
});
// Turn the frame for a pointer movement of dx, dy pixels (right, down):
// the globe follows the pointer, so the centre moves the other way. A view
// heading into the polar cap, which has no map, is carried straight across
// it to the same latitude on the far side, turned round.
export function stepFrame({c, u}, dx, dy, radiansPerPixel) {
  const b = dx * radiansPerPixel, a = dy * radiansPerPixel;
  const r = cross(u, c); // screen right
  const c1 = unit(c.map((v, i) => v * Math.cos(b) - r[i] * Math.sin(b)));
  const frame = forward({c: c1, u}, a);
  // Moving towards the nearer pole while inside its cap: carry on along the
  // same great circle across the cap.
  const lat = fromVector(frame.c)[1];
  if (Math.abs(lat) <= LAT_LIMIT || Math.abs(frame.c[2]) <= Math.abs(c[2])) return frame;
  const axis = cross(c, frame.c), n = Math.hypot(...axis);
  if (n < 1e-12) return frame;
  const k = axis.map(v => v / n), w = rad(180 - 2 * LAT_LIMIT);
  const turn = v => { const kv = cross(k, v), kd = dot(k, v); return unit(v.map((x, i) => x * Math.cos(w) + kv[i] * Math.sin(w) + k[i] * kd * (1 - Math.cos(w)))); };
  return {c: turn(frame.c), u: turn(frame.u)};
}
export function frameView({c, u}) {
  const {north, east} = axes(c);
  return {center: fromVector(c), bearing: deg(Math.atan2(dot(u, east), dot(u, north)))};
}
// Install on a MapLibre map. active(): whether the globe is showing;
// ignore(point): true where a press belongs to something else (editable
// points). Two fingers still pinch and rotate through MapLibre.
export function installGlobeDrag(map, {active, ignore = () => false}) {
  const canvas = map.getCanvasContainer(), pointers = new Set();
  let drag = null;
  const at = e => { const r = canvas.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
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
    drag = {start: p, last: p, moved: false, frame: startFrame([c.lng, c.lat], map.getBearing())};
  });
  const release = e => { pointers.delete(e.pointerId); drag = null; };
  addEventListener('pointerup', release); addEventListener('pointercancel', release);
  addEventListener('pointermove', e => {
    if (!drag || !pointers.has(e.pointerId)) return;
    const p = at(e);
    if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 3) return;
    drag.moved = true;
    const scale = radiansPerPixel();
    if (!scale) return;
    drag.frame = stepFrame(drag.frame, p.x - drag.last.x, p.y - drag.last.y, scale);
    drag.last = p;
    const {center, bearing} = frameView(drag.frame);
    map.jumpTo({center, bearing});
  });
  // MapLibre's panning is off while this handles the globe.
  return () => { if (active()) map.dragPan.disable(); else map.dragPan.enable(); };
}
