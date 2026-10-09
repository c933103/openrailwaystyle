// DOM layout for the map's controls. All measurements are in visible CSS
// pixels: More detail scales the map and counter-scales its control container.
export function installControlLayout({frame, mapElement, panel, status, readout, details}) {
  const document = frame.ownerDocument, window = document.defaultView, root = document.documentElement;
  const inset = document.createElement('div');
  inset.className = 'map-control-insets'; inset.setAttribute('aria-hidden', 'true');
  document.body.append(inset);
  const originalDetailsHeight = details?.style.maxHeight || '';
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
    const bottomSheet = window.matchMedia ? window.matchMedia('(max-width:650px)').matches : window.innerWidth <= 650;
    const menu = visible(panel);
    // The ruler and readout stay in the bottom-left corner; the menu above
    // them is shortened instead of pushing them into the middle of the map.
    const x = left + Math.max(10, sl);
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
    const detail = visible(details);
    const horizontalOverlap = rect => rect && rect.left < x + stack.width + gap && rect.right > x - gap;
    const desktopDetail = !bottomSheet && horizontalOverlap(detail);
    let stackTop = menu ? Math.max(high, menu.top + 48 + gap) : high;
    if (desktopDetail) stackTop = Math.max(stackTop, detail.top + 48 + gap);
    // The credits popover ends 40px above the info button's bottom. Reserve
    // space above it for the ruler/readout and the narrow menu's header, so
    // long credits scroll instead of pushing the controls above the viewport.
    set('--map-info-height', Math.max(1, low - 40 - stackTop - height - gap));
    // The status pill, bottom sheets and expanded credits are obstacles only
    // where they share the corner's column.
    let floor = low;
    for (const obstacle of [visible(status), bottomSheet ? detail : null, visible(mapElement.querySelector('.maplibregl-ctrl-attrib-inner'))]) {
      if (horizontalOverlap(obstacle) && obstacle.top < floor + gap && obstacle.bottom > floor - height - gap)
        floor = Math.min(floor, obstacle.top - gap);
    }
    set('--map-control-bottom', f.bottom - floor);
    // A top-anchored desktop panel must scroll above the footer, not push the
    // footer above its top edge. Restore the CSS bottom-sheet cap on phones.
    if (details) {
      const cap = desktopDetail ? `${Math.max(48, Math.min(f.height - 80, floor - height - gap - detail.top))}px` : originalDetailsHeight;
      if (details.style.maxHeight !== cap) details.style.maxHeight = cap;
    }
    // Reserve the bottom controls' measured height and let the expanded menu
    // scroll above that area.
    set('--map-panel-height', menu ? Math.max(48, floor - height - gap - menu.top) : Math.max(48, bottom - high - Math.max(10, sb)));
  }
  function schedule() {
    if (disposed || queued !== undefined) return;
    queued = request(() => { queued = undefined; update(); });
  }
  const resizer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(schedule) : null;
  const corner = mapElement.querySelector('.maplibregl-ctrl-bottom-left');
  const attribution = mapElement.querySelector('.maplibregl-ctrl-attrib');
  // The inset probe has an empty content box; padding changes its border box.
  resizer?.observe(inset, {box: 'border-box'});
  for (const element of [frame, panel, status, readout, details, corner, attribution?.querySelector('.maplibregl-ctrl-attrib-inner')])
    if (element) resizer?.observe(element);
  // New status text can wrap the pill onto more lines: lay out at once, so
  // the corner never waits for a later frame's resize notification. The map
  // rewrites the same text on every idle event; only a real change counts.
  let statusText = status?.textContent;
  const text = new window.MutationObserver(() => {
    if (status.textContent === statusText) return;
    statusText = status.textContent; update();
  });
  if (status) text.observe(status, {childList: true, characterData: true, subtree: true});
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
    resizer?.disconnect(); changes.disconnect(); text.disconnect(); inset.remove();
    if (details) details.style.maxHeight = originalDetailsHeight;
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

// Installation belongs to the page shell: it must work even if the renderer
// or a map provider fails. Nothing here loads map code or contacts a service.
export function installPwaInstall({window = globalThis.window, document = window.document} = {}) {
  const byId = id => document.getElementById(id);
  const opener = byId('pwa-install-open'), dialog = byId('pwa-install');
  const closeButton = byId('pwa-install-close'), nativeButton = byId('pwa-install-native');
  const ios = byId('pwa-install-ios'), generic = byId('pwa-install-generic'), status = byId('pwa-install-status');
  if (!opener || !dialog || !closeButton || !nativeButton || !ios || !generic || !status) return {destroy() {}};

  const navigator = window.navigator;
  // iPad Safari can use a desktop Mac user agent. This heuristic only chooses
  // relevant instructions; it never decides whether the app is installed.
  const iosInstructions = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || (/Mac/.test(navigator.platform || navigator.userAgent || '') && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)');
  let deferredPrompt = null, prompting = false, installedThisSession = false, destroyed = false;
  let returnFocus = null, fallback = null;
  const listeners = [];
  const listen = (target, type, callback, options) => {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  };
  // This describes the current window only. Do not persist an "installed"
  // flag: installation and removal in other contexts cannot be detected here.
  const runningAsApp = () => navigator.standalone === true || standalone?.matches === true;
  const unavailable = () => runningAsApp() || installedThisSession;
  // Native dialogs reflect this attribute through .open; unsupported
  // browsers have only the attribute used by our fallback.
  const isOpen = () => dialog.hasAttribute('open');
  const saveStyle = (element, property) => [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)];
  const restoreStyle = (element, property, [value, priority]) => {
    if (value) element.style.setProperty(property, value, priority);
    else element.style.removeProperty(property);
  };
  const restoreAttribute = (element, name, value) => {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  };
  function restoreFocus() {
    if (fallback) {
      const state = fallback;
      fallback = null;
      state.backdrop.remove();
      dialog.classList.remove('pwa-install-fallback');
      restoreAttribute(dialog, 'role', state.role);
      restoreStyle(document.body, 'overflow', state.overflow);
      for (const {element, ariaHidden, pointerEvents, inert} of state.background) {
        restoreAttribute(element, 'aria-hidden', ariaHidden);
        restoreStyle(element, 'pointer-events', pointerEvents);
        if (state.supportsInert) element.inert = inert;
      }
    }
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected && !target.closest('[hidden], [inert]') && !unavailable()) target.focus();
  }
  function close() {
    if (isOpen()) {
      if (!fallback && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    restoreFocus();
  }
  function render() {
    if (destroyed) return;
    const hidden = unavailable();
    const nativeHidden = hidden || (!deferredPrompt && !prompting);
    const nativeFocused = document.activeElement === nativeButton;
    // Disabling or hiding the active action can synchronously move focus to
    // the body. Transfer it first, without disturbing a user's later focus.
    if (nativeFocused && (nativeHidden || prompting) && !hidden && isOpen()) closeButton.focus();
    opener.hidden = hidden;
    ios.hidden = !iosInstructions;
    generic.hidden = iosInstructions;
    nativeButton.hidden = nativeHidden;
    nativeButton.disabled = prompting;
    nativeButton.textContent = prompting ? 'Waiting for browser…' : 'Install app';
    if (hidden) close();
  }
  function open() {
    if (unavailable() || document.body.dataset.ui === 'watch' || isOpen()) return;
    // WebKit pointer clicks need not focus buttons. Restore the invoking
    // control even when the previously focused control remains active.
    returnFocus = opener;
    render();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      // Browsers predating dialog also predate inert. The backdrop, pointer
      // guards, focus guards and aria-hidden work independently of that API.
      const backdrop = document.createElement('div');
      backdrop.id = 'pwa-install-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      fallback = {
        backdrop, role: dialog.getAttribute('role'), overflow: saveStyle(document.body, 'overflow'),
        supportsInert: 'inert' in window.HTMLElement.prototype,
        background: [...document.body.children].filter(element => element !== dialog && !element.contains(dialog))
          .map(element => ({element, ariaHidden: element.getAttribute('aria-hidden'),
            pointerEvents: saveStyle(element, 'pointer-events'), inert: element.inert})),
      };
      for (const {element} of fallback.background) {
        element.setAttribute('aria-hidden', 'true');
        element.style.setProperty('pointer-events', 'none', 'important');
        if (fallback.supportsInert) element.inert = true;
      }
      document.body.style.setProperty('overflow', 'hidden', 'important');
      document.body.append(backdrop);
      dialog.classList.add('pwa-install-fallback');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('open', '');
    }
    closeButton.focus();
  }
  const setStatus = text => {
    if (destroyed || unavailable()) return;
    status.textContent = text;
    status.hidden = !text;
  };
  async function requestInstall() {
    if (!deferredPrompt || prompting || unavailable()) return;
    const prompt = deferredPrompt;
    // Each browser event is usable once, even if the prompt is dismissed or
    // fails. A later beforeinstallprompt event can offer a fresh attempt.
    deferredPrompt = null;
    prompting = true;
    setStatus('Follow your browser’s installation prompt.');
    render();
    try {
      // Invoke prompt synchronously from this click to retain user activation.
      const result = await prompt.prompt();
      const choice = await (prompt.userChoice || result);
      setStatus(choice?.outcome === 'accepted'
        ? 'Your browser accepted the installation request. Finish any browser steps, then open Railway Atlas from your apps.'
        : choice?.outcome === 'dismissed'
          ? 'Installation dismissed. You can still use the browser menu instructions below.'
          : 'Finish any installation steps shown by your browser, or use the menu instructions below.');
    } catch {
      setStatus('Your browser could not open the installation prompt. Use the browser menu instructions below.');
    } finally {
      prompting = false;
      render();
    }
  }
  listen(opener, 'click', open);
  listen(closeButton, 'click', close);
  listen(nativeButton, 'click', requestInstall);
  listen(dialog, 'close', () => { if (!isOpen()) restoreFocus(); });
  listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  listen(dialog, 'keydown', event => {
    if (fallback) event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')]
      .filter(element => !element.closest('[hidden], [inert]'));
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  const blockBackground = event => {
    if (!fallback || !isOpen() || (event.target instanceof window.Node && dialog.contains(event.target))) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'keydown' && event.key === 'Escape') close();
    else if (/^(?:focus|key|click)/.test(event.type)) closeButton.focus();
  };
  // Capture also covers focus()/click() from another control and pointer
  // capture left over from a map gesture; the backdrop alone cannot do that.
  for (const type of ['focus', 'focusin', 'keydown', 'keyup', 'click', 'dblclick', 'contextmenu',
    'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup',
    'touchstart', 'touchmove', 'touchend', 'wheel']) listen(window, type, blockBackground, {capture: true, passive: false});
  listen(window, 'beforeinstallprompt', event => {
    if (typeof event.prompt !== 'function') return;
    event.preventDefault();
    if (unavailable()) return;
    deferredPrompt = event;
    setStatus('');
    render();
  });
  listen(window, 'appinstalled', () => { installedThisSession = true; deferredPrompt = null; render(); });
  listen(window, 'pageshow', render);
  listen(document, 'visibilitychange', render);
  if (standalone?.addEventListener) listen(standalone, 'change', render);
  else if (standalone?.addListener) { standalone.addListener(render); listeners.push(() => standalone.removeListener(render)); }
  render();
  return {destroy() {
    destroyed = true;
    deferredPrompt = null;
    for (const remove of listeners) remove();
    close();
  }};
}
