// DOM layout for the map's controls. All measurements are in visible CSS
// pixels: More detail scales the map and counter-scales its control container.
export function installControlLayout({frame, mapElement, panel, status, readout, details}) {
  const document = frame.ownerDocument, window = document.defaultView, root = document.documentElement;
  const inset = document.createElement('div');
  inset.className = 'map-control-insets'; inset.setAttribute('aria-hidden', 'true');
  document.body.append(inset);
  let disposed = false, queued;
  const request = window.requestAnimationFrame?.bind(window) || (fn => window.setTimeout(fn, 16));
  const cancel = window.cancelAnimationFrame?.bind(window) || window.clearTimeout.bind(window);
  const set = (name, value) => {
    const next = `${Math.max(0, Math.round(value * 100) / 100)}px`;
    if (root.style.getPropertyValue(name) !== next) root.style.setProperty(name, next);
  };
  const visible = element => {
    if (!element || element.hidden) return null;
    const style = window.getComputedStyle(element), rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 ? rect : null;
  };
  function update() {
    if (disposed) return;
    const f = frame.getBoundingClientRect();
    if (!f.width || !f.height) return;
    const vv = window.visualViewport, safe = window.getComputedStyle(inset);
    const top = Math.max(f.top, vv?.offsetTop || 0);
    const left = Math.max(f.left, vv?.offsetLeft || 0);
    const right = Math.min(f.right, vv ? vv.offsetLeft + vv.width : window.innerWidth);
    const bottom = Math.min(f.bottom, vv ? vv.offsetTop + vv.height : window.innerHeight);
    const gap = 8, sl = parseFloat(safe.paddingLeft) || 0, sr = parseFloat(safe.paddingRight) || 0;
    const st = parseFloat(safe.paddingTop) || 0, sb = parseFloat(safe.paddingBottom) || 0;
    const low = bottom - Math.max(10, sb), high = top + Math.max(10, st);
    const narrow = right - left <= 650, menu = visible(panel);
    // A short landscape is not a narrow portrait: an expanded menu still
    // occupies the left side, even when the compact-menu media query matches.
    const x = Math.max(left + Math.max(10, sl), !narrow && menu ? menu.right + gap : 0);
    const available = Math.max(1, right - Math.max(10, sr) - x - 42);
    set('--map-control-left', x - f.left);
    set('--map-control-width', available);
    set('--map-info-right', f.right - right + Math.max(10, sr));
    set('--map-info-bottom', f.bottom - low);
    set('--map-info-width', Math.max(1, right - left - Math.max(10, sl) - Math.max(10, sr)));
    const corner = mapElement.querySelector('.maplibregl-ctrl-bottom-left');
    if (!corner) return;
    // Measure the actual stack after its available width is applied. A long
    // readout can wrap; its height is not a fixed 80-pixel clearance.
    const stack = corner.getBoundingClientRect(), height = stack.height;
    const stackTop = narrow && menu ? Math.max(high, menu.top + 48 + gap) : high;
    // The credits popover ends 40px above the info button's bottom. Reserve
    // space above it for the ruler/readout and the narrow menu's header, so
    // long credits scroll instead of pushing the controls above the viewport.
    set('--map-info-height', Math.max(1, low - 40 - stackTop - height - gap));
    // Keep the status pill and its padding below both ruler and readout.
    let floor = Math.min(low, visible(status)?.top - gap || low);
    // Bottom sheets and the expanded credits are real obstacles as well.
    for (const obstacle of [visible(details), visible(mapElement.querySelector('.maplibregl-ctrl-attrib-inner'))]) {
      if (obstacle && obstacle.left < x + stack.width + gap && obstacle.right > x - gap && obstacle.top < floor + gap && obstacle.bottom > floor - height - gap)
        floor = Math.min(floor, obstacle.top - gap);
    }
    set('--map-control-bottom', f.bottom - floor);
    // On narrow screens there is no side lane. Reserve the bottom controls'
    // measured height and let the expanded menu scroll above that area.
    set('--map-panel-height', narrow && menu ? Math.max(48, floor - height - gap - menu.top) : Math.max(48, bottom - (menu?.top || high) - Math.max(10, sb)));
  }
  function schedule() {
    if (disposed || queued !== undefined) return;
    queued = request(() => { queued = undefined; update(); });
  }
  const resizer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(schedule) : null;
  const corner = mapElement.querySelector('.maplibregl-ctrl-bottom-left');
  const attribution = mapElement.querySelector('.maplibregl-ctrl-attrib');
  for (const element of [frame, panel, status, readout, details, corner, attribution?.querySelector('.maplibregl-ctrl-attrib-inner')])
    if (element) resizer?.observe(element);
  const changes = new window.MutationObserver(schedule);
  for (const element of [mapElement, panel, status, readout, details, attribution])
    if (element) changes.observe(element, {attributes: true, attributeFilter: ['class', 'hidden', 'open']});
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  document.fonts?.ready.then(schedule);
  update();
  return {update, destroy() {
    disposed = true; if (queued !== undefined) cancel(queued);
    resizer?.disconnect(); changes.disconnect(); inset.remove();
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
  }};
}

// MapLibre owns credit collection/sanitization. The user's explicit toggle
// owns the presentation state; data, resize and drag callbacks must not erase
// a remembered choice. No private MapLibre members are used here.
export function rememberAttribution(container, {open = false, changed = () => {}} = {}) {
  if (!container) return () => {};
  const window = container.ownerDocument.defaultView;
  const button = container.querySelector('.maplibregl-ctrl-attrib-button');
  if (!button) return () => {};
  let expanded = open === true, disposed = false;
  const showClass = 'maplibregl-compact-show';
  function apply() {
    if (disposed) return;
    if (!container.classList.contains('maplibregl-compact')) container.classList.add('maplibregl-compact');
    if (container.classList.contains(showClass) !== expanded) container.classList.toggle(showClass, expanded);
    if (container.hasAttribute('open') !== expanded) container.toggleAttribute('open', expanded);
    if (button.getAttribute('aria-expanded') !== String(expanded)) button.setAttribute('aria-expanded', String(expanded));
  }
  function click(event) {
    // Own only the presentation toggle. Cancelling the native <summary>
    // action prevents a second, inverted toggle after the event handlers.
    event.preventDefault(); event.stopImmediatePropagation();
    expanded = !expanded; apply(); changed(expanded);
  }
  function keydown(event) {
    if (event.key !== 'Escape' || !expanded) return;
    event.preventDefault(); event.stopPropagation(); expanded = false;
    apply(); changed(false); button.focus();
  }
  apply();
  const observer = new window.MutationObserver(apply);
  observer.observe(container, {attributes: true, attributeFilter: ['class', 'open']});
  button.addEventListener('click', click, true);
  container.addEventListener('keydown', keydown);
  return () => { disposed = true; observer.disconnect(); button.removeEventListener('click', click, true); container.removeEventListener('keydown', keydown); };
}
