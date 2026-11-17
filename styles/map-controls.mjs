// MapLibre 5.24.0 prepares tile clipping before renderLayer rejects hidden
// layers. Skip that work with the very same visibility predicate, before any
// stencil state changes. Keep the immutable vendor distribution/prototype
// untouched; visibility and zoom are read afresh for every frame/style.
const hiddenTileMaskGuards = new WeakMap();
export function installHiddenTileMaskGuard(map) {
  const painter = map?.painter, original = painter?._renderTileClippingMasks;
  if (typeof original !== 'function' || !Number.isFinite(painter?.transform?.zoom))
    throw new Error('Pinned MapLibre tile-mask boundary unavailable');
  if (hiddenTileMaskGuards.get(painter) === original) return;
  const guarded = function(layer, ...args) {
    if (layer.isHidden(this.transform.zoom)) return;
    return original.call(this, layer, ...args);
  };
  painter._renderTileClippingMasks = guarded;
  hiddenTileMaskGuards.set(painter, guarded);
}

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
    // Keep the toolbar action focusable while the browser prompt is pending.
    // The click guard prevents another prompt or an accidental help dialog.
    if (prompting) {
      opener.setAttribute('aria-busy', 'true');
      opener.setAttribute('aria-disabled', 'true');
    } else {
      opener.removeAttribute('aria-busy');
      opener.removeAttribute('aria-disabled');
    }
    if (deferredPrompt || prompting) {
      opener.removeAttribute('aria-haspopup');
      opener.removeAttribute('aria-controls');
    } else {
      opener.setAttribute('aria-haspopup', 'dialog');
      opener.setAttribute('aria-controls', dialog.id);
    }
    ios.hidden = !iosInstructions;
    generic.hidden = iosInstructions;
    nativeButton.hidden = nativeHidden;
    nativeButton.disabled = prompting;
    nativeButton.textContent = prompting ? 'Waiting for browser…' : 'Install app';
    if (hidden) close();
  }
  function open() {
    if (destroyed || unavailable() || document.body.dataset.ui === 'watch' || isOpen()) return;
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
  async function requestInstall({direct = false} = {}) {
    if (!deferredPrompt || prompting || destroyed || unavailable() || document.body.dataset.ui === 'watch') return;
    const prompt = deferredPrompt;
    const initialFocus = document.activeElement, initialLocation = window.location.href;
    let failed = false;
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
      failed = true;
      setStatus('Your browser could not open the installation prompt. Use the browser menu instructions below.');
    } finally {
      prompting = false;
      render();
      // A failed direct prompt can fall back to instructions, but a delayed
      // result must not interrupt another control or a changed map location.
      const sameInteraction = direct && !destroyed && !unavailable() && document.body.dataset.ui !== 'watch'
        && window.location.href === initialLocation
        && [initialFocus, opener, document.body].includes(document.activeElement);
      if (sameInteraction && !isOpen()) {
        if (failed) open();
        else if (document.activeElement === document.body) opener.focus();
      }
    }
  }
  listen(opener, 'click', () => {
    if (prompting || destroyed || unavailable() || document.body.dataset.ui === 'watch') return;
    if (deferredPrompt) requestInstall({direct: true});
    else open();
  });
  listen(closeButton, 'click', close);
  listen(nativeButton, 'click', () => requestInstall());
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

// MapLibre attribution hardening stays in an existing, versioned app module:
// an older worker already precaches it during an interrupted shell upgrade.
// Preserve upstream attribution fix 1da69f3cd913a39fa948708e01478663bf48bc27
// and retain GeoJSON raw bytes across interrupted parses. Inputs and output
// are pinned; the public v5 renderer API stays unchanged.
//
// The atlas.3 repair adds traditional Mongolian label shaping inside the
// distribution, at the same hook the RTL text plugin's Arabic shaping
// uses: atlasMongolianShapeText (defined below, embedded verbatim
// between the atlas-mongolian markers) runs inside the text transform, so
// Mongolian letters become private-use contextual forms before glyph
// collection and shaping, and atlasMongolianVerticalize restacks each
// Mongolian run vertically at the end of shaping. The glyph supply for
// the forms is the atlas's own (glyph-fallback.mjs).
// Joining model (DerivedJoiningType, Unicode 17; the Mongolian shaping
// model of the Unicode Mongolian shaping draft): Mongolian letters are
// dual-joining. Free variation selectors (U+180B–U+180D, U+180F) are
// transparent and select the preceding letter's variant. U+180A NIRUGU
// and U+200D ZWJ are join-causing: they join on both sides and take no
// form of their own. U+180E MVS and U+202F NNBSP are the Mongolian
// model's mid-word spaces: a letter joins forward across them (the
// letter before one takes the form it would take before a joining
// neighbour — the standardized variants confirm a medial context
// there), but not backward (the letter after one starts as at a word
// start). Everything else — spaces, digits, other scripts — breaks the
// word. The letter span U+1820–U+18AA is treated uniformly as
// dual-joining; U+1807, a syllable boundary marker, is treated as a
// break. Substitution replaces letters one-for-one and passes every
// other character through, so the string's length never changes.
export function atlasMongolianShapeText(text) {
  if (!/[\u1800-\u18AF\u{11660}-\u{1167F}]/u.test(text)) return text;
  const chars = [...text];
  const codes = chars.map(char => char.codePointAt(0));
  const isLetter = code => (code >= 0x1820 && code <= 0x18AA) || (code >= 0x11660 && code <= 0x1167F);
  const isSelector = code => code === 0x180B || code === 0x180C || code === 0x180D || code === 0x180F;
  const selectorValue = code => code === 0x180B ? 1 : code === 0x180C ? 2 : code === 0x180D ? 3 : 4;
  const isJoiner = code => code === 0x180A || code === 0x200D;
  const isMidSpace = code => code === 0x180E || code === 0x202F;
  const out = chars.slice();
  let i = 0;
  while (i < codes.length) {
    if (!isLetter(codes[i]) && !isJoiner(codes[i])) { i++; continue; }
    // One word: letters with their selectors, join-causing marks and
    // mid-word spaces.
    let end = i;
    const letters = [];
    while (end < codes.length && (isLetter(codes[end]) || isSelector(codes[end]) || isJoiner(codes[end]) || isMidSpace(codes[end]))) {
      if (isLetter(codes[end])) letters.push(end);
      end++;
    }
    for (const at of letters) {
      // The nearest word member on each side, selectors aside: a letter
      // joins backward to a letter or a join-causing mark, and forward
      // to those or to a mid-word space.
      let prev = false, next = false;
      for (let j = at - 1; j >= i; j--) {
        if (isSelector(codes[j])) continue;
        prev = isLetter(codes[j]) || isJoiner(codes[j]);
        break;
      }
      for (let j = at + 1; j < end; j++) {
        if (isSelector(codes[j])) continue;
        next = isLetter(codes[j]) || isJoiner(codes[j]) || isMidSpace(codes[j]);
        break;
      }
      const form = prev && next ? 2 : prev ? 3 : next ? 1 : 0;
      const fvs = at + 1 < codes.length && isSelector(codes[at + 1]) ? selectorValue(codes[at + 1]) : 0;
      const code = codes[at];
      const index = code <= 0x18AA ? code - 0x1820 : 139 + (code - 0x11660);
      out[at] = String.fromCodePoint(fvs === 0
        ? 0xF0000 + index * 4 + form
        : 0xF0300 + (index * 4 + form) * 4 + (fvs - 1));
    }
    i = end;
  }
  return out.join('');
}

// The layout half, called from the patched shaping entry with the
// finished horizontal shaping: each Mongolian run inside a line is
// restacked as a vertical column at the run's own place — glyphs keep
// the run's starting x, and y advances downward by each glyph form's
// advance (the horizontal advance of the form, which the 90-degree
// rotation turns into the vertical step). Glue characters between the
// run's first and last letters (spaces between the words of a name, the
// vowel separator, narrow no-break spaces, joiners, nirugu) stack with
// it, so a multi-word name forms one column with vertical gaps. Glyphs
// outside runs and the shaping's other bounds are untouched; the bottom
// grows to cover the column so collision keeps other labels clear.
// Vertical-orientation shapings (writingMode 2) and line placement —
// which shapes with an infinite maxWidth — keep the horizontal run.
export function atlasMongolianVerticalize(shaping, writingMode, maxWidth) {
  if (writingMode === 2 || !isFinite(maxWidth)) return;
  const isForm = code => (code >= 0xF0000 && code < 0xF02AC) || (code >= 0xF0300 && code < 0xF0DB0);
  const isGlue = code => code === 0x20 || code === 0x180E || code === 0x202F || code === 0x200D || code === 0x180A;
  for (const line of shaping.positionedLines) {
    const glyphs = line.positionedGlyphs;
    let i = 0;
    while (i < glyphs.length) {
      if (!isForm(glyphs[i].glyph) && !isGlue(glyphs[i].glyph)) { i++; continue; }
      let end = i, first = -1, last = -1;
      while (end < glyphs.length && (isForm(glyphs[end].glyph) || isGlue(glyphs[end].glyph))) {
        if (isForm(glyphs[end].glyph)) { if (first < 0) first = end; last = end; }
        end++;
      }
      if (first >= 0) {
        const x = glyphs[first].x;
        let y = glyphs[first].y;
        for (let k = first; k <= last; k++) {
          const glyph = glyphs[k];
          glyph.x = x;
          const step = glyph.metrics.advance * glyph.scale;
          glyph.y = y;
          y += step;
        }
        if (y > shaping.bottom) shaping.bottom = y;
      }
      i = end;
    }
  }
}

export const MAPLIBRE_MONGOLIAN_SOURCE = `/*atlas-mongolian-start*/${atlasMongolianShapeText.toString()}\n${atlasMongolianVerticalize.toString()}/*atlas-mongolian-end*/`;
export const MAPLIBRE_MONGOLIAN_EDITS = Object.freeze([
  Object.freeze(['function Mh(t,e,n){', `${MAPLIBRE_MONGOLIAN_SOURCE}function Mh(t,e,n){`]),
  Object.freeze(['Bs.applyArabicShaping&&(t=Bs.applyArabicShaping(t)),t}',
    'Bs.applyArabicShaping&&(t=Bs.applyArabicShaping(t)),t=atlasMongolianShapeText(t),t}']),
  Object.freeze(['(_,n,r,i,g,a,l,u,p,c,f,y),!function(t){for(const e of t)if(0!==e.positionedGlyphs.length)return !1;return !0}(w)&&_}',
    '(_,n,r,i,g,a,l,u,p,c,f,y),atlasMongolianVerticalize(_,p,o),!function(t){for(const e of t)if(0!==e.positionedGlyphs.length)return !1;return !0}(w)&&_}']),
]);
export const MAPLIBRE_BACKPORT = Object.freeze({
  upstreamSha256: '45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb',
  previousSha256: '1d5066a984b7913ace268371faff76d16edfd2eb9d7331de56c33d93f31e201e',
  sha256: 'a1689c6e2f7119abaff9706daeaf6c3a2e9b184cf670120db5344f27b3c6caed',
  target: 'vendor/maplibre-gl-5.24.0-atlas.3.js',
});
export async function backportMapLibre524(bytes, subtle) {
  if (!subtle) throw new Error('MapLibre backport requires integrity verification');
  const digest = async value => [...new Uint8Array(await subtle.digest('SHA-256', value))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const inputHash = await digest(bytes);
  if (![MAPLIBRE_BACKPORT.upstreamSha256, MAPLIBRE_BACKPORT.previousSha256].includes(inputHash)) throw new Error('Unexpected MapLibre input');
  const original = 'static removeAttributes(e){for(const{name:t,value:i}of e.attributes)d.isPossiblyDangerous(t,i)&&e.removeAttribute(t);}';
  const replacement = original.replace('of e.attributes', 'of Array.from(e.attributes)');
  const source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const upstream = inputHash === MAPLIBRE_BACKPORT.upstreamSha256;
  if (source.split(upstream ? original : replacement).length !== 2) throw new Error('Unexpected MapLibre sanitizer');
  const workerOriginal = '_parseWorkerTile(t,i,s){return e._(this,void 0,void 0,(function*(){let r=yield t.parse(t.vectorTile,this.layerIndex,this.availableImages,this.actor,i.subdivisionGranularity);if(s){const{rawData:t}=s;r=e.e({rawTileData:t.slice(0),encoding:"mvt"},r);}return r}))}';
  const workerFixed = '_parseWorkerTile(t,i,s){return e._(this,void 0,void 0,(function*(){this._atlasPendingRaw||(this._atlasPendingRaw=new WeakMap);s&&this._atlasPendingRaw.set(t,s);const n=this._atlasPendingRaw.get(t);let r=yield t.parse(t.vectorTile,this.layerIndex,this.availableImages,this.actor,i.subdivisionGranularity);if(n){const{rawData:i}=n;r=e.e({rawTileData:i.slice(0),encoding:"mvt"},r);this._atlasPendingRaw.delete(t);}return r}))}';
  // The previous distribution already carries the worker repair; the
  // upstream distribution does not. Either input is accepted, and the
  // result carries the repair exactly once.
  const workerPresent = upstream ? workerOriginal : workerFixed;
  if (source.split(workerPresent).length !== 2) throw new Error('Unexpected MapLibre GeoJSON worker');
  for (const [editOriginal] of MAPLIBRE_MONGOLIAN_EDITS)
    if (source.split(editOriginal).length !== 2) throw new Error('Unexpected MapLibre Mongolian shaping');
  // These bounded changes invalidate the upstream source map's columns. Do not
  // advertise that unchanged map for the locally modified distribution.
  let patchedSource = source.replace(upstream ? original : replacement, replacement).replace(workerPresent, workerFixed);
  for (const [editOriginal, editReplacement] of MAPLIBRE_MONGOLIAN_EDITS) patchedSource = patchedSource.replace(editOriginal, editReplacement);
  const patched = new TextEncoder().encode(patchedSource.replace('//# sourceMappingURL=maplibre-gl.js.map\n', ''));
  if (await digest(patched) !== MAPLIBRE_BACKPORT.sha256) throw new Error('Unexpected MapLibre output');
  return patched;
}
