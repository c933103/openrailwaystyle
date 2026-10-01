// Smooth panning with the arrow keys. MapLibre's keyboard handler starts a
// new 300 ms ease-out of 100 pixels on every keydown, including each key
// repeat (about 30 a second, after the system's repeat delay of about half a
// second): every ease restarts the curve, so a held key moved the map in
// jolts, with a pause after the first step. Here a held key moves the map at
// a steady speed, frame by frame, reached over a short ramp; a short press
// still moves it by at least one step. Shift with an arrow (turning and
// tilting) and the zoom keys stay with MapLibre.
const DIRECTIONS = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
export const STEP = 100, RAMP_MS = 180;

// Pixels per second after holding for `held` ms, for a map `size` pixels
// across (its smaller side): a smooth start up to about a screen's width in
// 1.4 seconds.
export function panSpeed(held, size) {
  const t = Math.max(0, Math.min(1, held / RAMP_MS)), ease = t * t * (3 - 2 * t);
  return ease * Math.max(400, size / 1.4);
}
// The combined direction of the held keys, as a unit vector (or [0, 0]).
export function panDirection(keys) {
  let x = 0, y = 0;
  for (const key of keys) { const d = DIRECTIONS[key]; if (d) { x += d[0]; y += d[1]; } }
  const length = Math.hypot(x, y);
  return length ? [x / length, y / length] : [0, 0];
}

export function installKeyboardPan(map, {reducedMotion = () => false} = {}) {
  // Keys are taken only from the map itself (its canvas container), not from
  // the zoom, compass and other controls, whose arrow keys stay their own.
  const container = map.getContainer(), surface = map.getCanvasContainer(), held = new Map();
  // The latest keydown goes with each pan as its originalEvent, so the map
  // treats it as the user's (the location control stops following).
  let frame = 0, last = 0, moved = 0, direction = [0, 0], keyEvent = null;
  // A held key is one movement: each frame's step would otherwise start and
  // end a movement of its own, running everything that waits for the map to
  // settle (redrawing the legend, looking up nearby stops) every frame. While
  // a key is held, the first movestart goes through, later ones are dropped,
  // and moveend is kept back until the keys are released.
  let pendingEnd = null, started = false;
  const hold = () => {
    started = false; pendingEnd = null;
    const fire = Object.getPrototypeOf(map).fire;
    map.fire = function (event, properties) {
      const type = typeof event === 'string' ? event : event?.type;
      if (type === 'moveend') { pendingEnd = [event, properties]; return this; }
      if (type === 'movestart') { if (started) return this; started = true; }
      return fire.call(this, event, properties);
    };
  };
  const release = () => {
    if (!Object.hasOwn(map, 'fire')) return;
    delete map.fire;
    const end = pendingEnd; pendingEnd = null; started = false;
    if (end) map.fire(...end);
  };
  const tick = now => {
    const keys = [...held.keys()];
    if (!keys.length) { frame = 0; return; }
    // A long frame (a slow device, a busy moment) moves its share, up to 0.1 s.
    const dt = Math.min(100, now - last); last = now;
    const since = now - Math.min(...held.values()), {clientWidth: w, clientHeight: h} = container;
    direction = panDirection(keys);
    const distance = panSpeed(since, Math.min(w, h)) * dt / 1000;
    if (distance > 0) { map.panBy([direction[0] * distance, direction[1] * distance], {animate: false}, {originalEvent: keyEvent}); moved += distance; }
    frame = requestAnimationFrame(tick);
  };
  const stop = (topUp = true) => {
    held.clear(); cancelAnimationFrame(frame); frame = 0;
    release();
    // A short press moves at least one step, as MapLibre's did.
    if (topUp && moved < STEP && (direction[0] || direction[1])) {
      const rest = STEP - moved;
      map.panBy([direction[0] * rest, direction[1] * rest], {duration: reducedMotion() ? 0 : 160}, {originalEvent: keyEvent});
    }
    moved = 0; direction = [0, 0];
  };
  // Capture: before MapLibre's own handler on the canvas inside.
  surface.addEventListener('keydown', event => {
    // A modifier pressed during a pan (Shift turns or tilts) hands the keys
    // back to MapLibre: the pan ends where it is.
    const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
    if (modified && held.size) stop(false);
    if (!DIRECTIONS[event.key] || modified) return;
    event.preventDefault(); event.stopPropagation();
    if (held.has(event.key)) return;
    if (!held.size) { moved = 0; map.stop(); hold(); }
    keyEvent = event;
    held.set(event.key, performance.now());
    direction = panDirection(held.keys());
    if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); }
  }, true);
  surface.addEventListener('keyup', event => {
    if (!held.has(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    held.delete(event.key);
    if (!held.size) stop();
  }, true);
  for (const target of [window, surface]) target.addEventListener(target === window ? 'blur' : 'focusout', () => { if (held.size) stop(); });
}
