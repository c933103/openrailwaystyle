import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {installPwaInstall} from '../styles/map-controls.mjs';

const html = await readFile(new URL('../styles/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/app.css', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function start({userAgent = 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36', platform = 'Linux x86_64', maxTouchPoints = 0, standalone = false, displayMode = false, watch = false, noNativeDialog = false} = {}) {
  const dom = new JSDOM(html, {url: 'https://atlas.test/openrailwaystyle/#7/30.6/114.3'});
  const {window} = dom, {document} = window;
  for (const [name, value] of Object.entries({userAgent, platform, maxTouchPoints, standalone})) Object.defineProperty(window.navigator, name, {value, configurable: true});
  const media = new window.EventTarget();
  media.matches = displayMode;
  window.matchMedia = () => media;
  if (watch) document.body.dataset.ui = 'watch';
  if (noNativeDialog) {
    // A browser with no native dialog treats it as an ordinary element: no
    // reflected open property and no modal/close methods. jsdom otherwise
    // reflects open even though it has no showModal(), hiding this failure.
    for (const property of ['open', 'showModal', 'close']) delete window.HTMLDialogElement.prototype[property];
    delete window.HTMLElement.prototype.inert;
    const style = document.createElement('style');
    style.textContent = 'dialog{display:block;position:static;inset:auto;margin:0}\n' + css;
    document.head.append(style);
  }
  const controls = installPwaInstall({window, document});
  const byId = id => document.getElementById(id);
  return {window, document, controls, media, byId,
    offer({outcome = 'dismissed', failure = null, pending = null} = {}) {
      const event = new window.Event('beforeinstallprompt', {cancelable: true});
      let prompts = 0;
      event.prompt = () => { prompts++; if (failure) throw failure; return Promise.resolve(); };
      event.userChoice = pending || Promise.resolve({outcome});
      window.dispatchEvent(event);
      return {event, calls: () => prompts};
    },
    open() { byId('pwa-install-open').focus(); byId('pwa-install-open').click(); },
    cleanup() { controls.destroy(); dom.window.close(); },
  };
}

for (const [device, options] of [
  ['iPhone Safari', {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5}],
  ['iPad Safari with a desktop user agent', {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5}],
]) test(`${device}: installation instructions are available without an install event or renderer`, () => {
  const s = start(options);
  try {
    assert.equal(s.byId('pwa-install-open').hidden, false);
    assert.equal(s.byId('pwa-install').open, false, 'no automatic banner or dialog');
    s.open();
    assert.equal(s.byId('pwa-install').open, true);
    assert.equal(s.byId('pwa-install-ios').hidden, false);
    assert.equal(s.byId('pwa-install-generic').hidden, true);
    assert.equal(s.byId('pwa-install-native').hidden, true, 'no fabricated native install action');
    const instructions = s.byId('pwa-install-ios').textContent;
    assert.match(instructions, /Safari.*Share/s);
    assert.match(instructions, /Add to Home Screen/);
    assert.match(instructions, /Open as Web App/);
    assert.match(instructions, /Edit Actions/);
    assert.match(instructions, /Copy map link.*only copies/s);
    assert.equal(s.window.location.hash, '#7/30.6/114.3', 'opening installation help preserves the map position');
    assert.equal(s.document.activeElement, s.byId('pwa-install-close'));
  } finally { s.cleanup(); }
});

test('a Mac without touch and a browser without install prompt retain useful menu instructions', () => {
  const s = start({platform: 'MacIntel', maxTouchPoints: 0});
  try {
    s.open();
    assert.equal(s.byId('pwa-install-ios').hidden, true);
    assert.equal(s.byId('pwa-install-generic').hidden, false);
    assert.match(s.byId('pwa-install-generic').textContent, /Install app.*Add to Home Screen/s);
    assert.match(s.byId('pwa-install-generic').textContent, /File → Add to Dock/);
    assert.equal(s.byId('pwa-install-native').hidden, true);
  } finally { s.cleanup(); }
});

test('the toolbar icon directly prompts once, ignores pending clicks, and retains a fresh offer', async () => {
  const s = start();
  try {
    let finish;
    const first = s.offer({pending: new Promise(resolve => { finish = resolve; })});
    const opener = s.byId('pwa-install-open'), dialog = s.byId('pwa-install');
    assert.equal(first.event.defaultPrevented, true);
    assert.equal(first.calls(), 0);
    assert.equal(dialog.open, false, 'the browser event does not open an automatic modal');
    assert.equal(opener.hasAttribute('aria-controls'), false, 'a direct prompt does not claim to open manual help');
    s.open();
    assert.equal(first.calls(), 1, 'the original toolbar click synchronously invokes prompt()');
    assert.equal(dialog.open, false, 'there is no intermediate instructions dialog');
    assert.equal(opener.disabled, false, 'the pending icon remains focusable');
    assert.equal(opener.getAttribute('aria-busy'), 'true');
    assert.equal(s.document.activeElement, opener);
    opener.click();
    assert.equal(first.calls(), 1);
    assert.equal(dialog.open, false, 'a repeated pending click does not open fallback help');
    const second = s.offer();
    opener.click();
    assert.equal(second.calls(), 0, 'a fresh event still waits for the current prompt to settle');
    finish({outcome: 'dismissed'});
    await tick();
    assert.equal(dialog.open, false, 'dismissal does not reopen instructions');
    assert.equal(opener.hasAttribute('aria-busy'), false);
    assert.equal(s.document.activeElement, opener);
    assert.match(s.byId('pwa-install-status').textContent, /dismissed/);
    opener.click();
    assert.equal(second.calls(), 1, 'a later click uses the fresh event directly');
    await tick();
    assert.equal(dialog.open, false);
    opener.click();
    assert.equal(dialog.open, true, 'a later click without an offer opens manual instructions');
    assert.equal(opener.getAttribute('aria-controls'), dialog.id);
    assert.equal(first.calls(), 1);
    assert.equal(second.calls(), 1, 'neither consumed event is reused');
  } finally { s.cleanup(); }
});

test('prompt failure preserves instructions and does not repeatedly invoke the broken event', async () => {
  const s = start();
  try {
    const offer = s.offer({failure: new Error('NotAllowedError')});
    s.open();
    await tick();
    assert.equal(offer.calls(), 1);
    assert.match(s.byId('pwa-install-status').textContent, /could not open/);
    assert.equal(s.byId('pwa-install').open, true);
    assert.equal(s.byId('pwa-install-generic').hidden, false);
    assert.equal(s.byId('pwa-install-native').hidden, true);
    s.byId('pwa-install-native').click();
    await tick();
    assert.equal(offer.calls(), 1);
  } finally { s.cleanup(); }
});

test('a focused native action transfers focus before being disabled, then retains it after dismissal', async () => {
  const s = start();
  try {
    let finish;
    s.open();
    const offer = s.offer({pending: new Promise(resolve => { finish = resolve; })});
    const action = s.byId('pwa-install-native'), close = s.byId('pwa-install-close');
    let stateOnBlur;
    action.addEventListener('blur', () => { stateOnBlur = {hidden: action.hidden, disabled: action.disabled}; });
    action.focus();
    action.click();
    assert.equal(offer.calls(), 1, 'focus management does not defer prompt() beyond the click');
    assert.deepEqual(stateOnBlur, {hidden: false, disabled: false}, 'transfer focus before making the active action unusable');
    assert.equal(action.disabled, true);
    assert.equal(s.document.activeElement, close, 'pending installation leaves focus on an available control');
    finish({outcome: 'dismissed'});
    await tick();
    assert.equal(action.hidden, true);
    assert.equal(s.document.activeElement, close, 'hiding the consumed action retains dialog focus');
  } finally { s.cleanup(); }
});

test('finishing a pending prompt after help closes preserves focus on the user’s next control', async () => {
  const s = start();
  try {
    let finish;
    s.open();
    s.offer({pending: new Promise(resolve => { finish = resolve; })});
    const action = s.byId('pwa-install-native'), next = s.byId('share');
    action.focus();action.click();
    s.byId('pwa-install-close').click();
    next.focus();
    finish({outcome: 'dismissed'});
    await tick();
    assert.equal(action.hidden, true);
    assert.equal(s.byId('pwa-install').open, false);
    assert.equal(s.document.activeElement, next, 'completion does not move focus back to closed instructions');
  } finally { s.cleanup(); }
});

test('acceptance awaits installation confirmation, while appinstalled hides the current session action', async () => {
  const s = start();
  try {
    s.offer({outcome: 'accepted'});
    s.open();
    await tick();
    assert.equal(s.byId('pwa-install-open').hidden, false, 'accepting a request does not prove installation completed');
    assert.equal(s.byId('pwa-install').open, false, 'acceptance does not open manual instructions');
    assert.match(s.byId('pwa-install-status').textContent, /accepted the installation request/);
    s.window.dispatchEvent(new s.window.Event('appinstalled'));
    assert.equal(s.byId('pwa-install-open').hidden, true);
    assert.equal(s.byId('pwa-install').open, false);
    assert.equal(s.window.localStorage.length, 0, 'no permanent installed flag that could survive removal');
    assert.equal(s.document.cookie, '');
  } finally { s.cleanup(); }
});

for (const [context, options] of [
  ['iOS Home Screen', {standalone: true}],
  ['standalone display mode', {displayMode: true}],
]) test(`${context}: no install action in the current app window`, () => {
  const s = start(options);
  try {
    assert.equal(s.byId('pwa-install-open').hidden, true);
    s.open();
    assert.equal(s.byId('pwa-install').open, false);
    const offer = s.offer();
    s.open();
    assert.equal(s.byId('pwa-install-native').hidden, true);
    assert.equal(offer.calls(), 0);
  } finally { s.cleanup(); }
});

test('a change to standalone closes help and a regular browser context can show it again', () => {
  const s = start();
  try {
    s.open();
    s.media.matches = true;
    s.media.dispatchEvent(new s.window.Event('change'));
    assert.equal(s.byId('pwa-install-open').hidden, true);
    assert.equal(s.byId('pwa-install').open, false);
    s.media.matches = false;
    s.media.dispatchEvent(new s.window.Event('change'));
    assert.equal(s.byId('pwa-install-open').hidden, false);
    s.open();
    assert.equal(s.byId('pwa-install').open, true);
  } finally { s.cleanup(); }
});

test('manual help traps focus, closes by Escape or close button, and returns focus to Install', () => {
  const s = start();
  try {
    s.open();
    const dialog = s.byId('pwa-install'), close = s.byId('pwa-install-close');
    const tab = new s.window.KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true});
    close.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, true);
    assert.equal(s.document.activeElement, close, 'hidden native action cannot receive keyboard focus');
    close.dispatchEvent(new s.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    assert.equal(dialog.open, false);
    assert.equal(s.document.activeElement, s.byId('pwa-install-open'));
    s.open();
    close.click();
    assert.equal(dialog.open, false);
    assert.equal(s.document.activeElement, s.byId('pwa-install-open'));
    s.open();
    dialog.dispatchEvent(new s.window.Event('cancel', {cancelable: true}));
    assert.equal(dialog.open, false);
    assert.equal(s.document.activeElement, s.byId('pwa-install-open'));
  } finally { s.cleanup(); }
});

test('clicking Install restores focus to its invoking button even when the click does not focus it', () => {
  const s = start();
  try {
    const opener = s.byId('pwa-install-open'), previous = s.byId('share');
    previous.focus();
    let activeOnClick;
    opener.addEventListener('click', () => { activeOnClick = s.document.activeElement; }, {capture: true});
    opener.click();
    assert.equal(activeOnClick, previous, 'reproduce WebKit keeping the previous control active on pointer click');
    assert.equal(s.byId('pwa-install').open, true);
    s.byId('pwa-install-close').click();
    assert.equal(s.document.activeElement, opener, 'return to the control that opened the dialog, not the previous control');
  } finally { s.cleanup(); }
});

test('a dialog without native dialog or inert APIs closes and restores background state and focus', () => {
  const s = start({noNativeDialog: true});
  try {
    const opener = s.byId('pwa-install-open'), dialog = s.byId('pwa-install');
    const previous = s.byId('share'), close = s.byId('pwa-install-close');
    assert.equal('open' in dialog, false, 'the fallback must not rely on jsdom’s native open reflection');
    assert.equal(typeof dialog.showModal, 'undefined');
    assert.equal('inert' in s.window.HTMLElement.prototype, false);
    assert.equal(s.window.getComputedStyle(dialog).display, 'none', 'closed content is hidden without native dialog styling');
    s.byId('map-frame').inert = true;
    s.byId('map-frame').setAttribute('aria-hidden', 'false');
    s.byId('map-frame').style.setProperty('pointer-events', 'auto', 'important');
    s.document.querySelector('.panel').inert = false;
    s.document.body.style.setProperty('overflow', 'scroll', 'important');
    const original = [...s.document.body.children].filter(element => element !== dialog)
      .map(element => ({element, inert: element.inert, ariaHidden: element.getAttribute('aria-hidden'),
        pointerEvents: element.style.getPropertyValue('pointer-events'), priority: element.style.getPropertyPriority('pointer-events')}));
    const checkRestored = () => {
      assert.equal(dialog.hasAttribute('open'), false, 'fallback close removes the visible open state');
      assert.equal(s.window.getComputedStyle(dialog).display, 'none');
      assert.equal(s.byId('pwa-install-backdrop'), null);
      assert.equal(dialog.hasAttribute('role'), false);
      assert.equal(s.document.body.style.getPropertyValue('overflow'), 'scroll');
      assert.equal(s.document.body.style.getPropertyPriority('overflow'), 'important');
      for (const {element, inert, ariaHidden, pointerEvents, priority} of original) {
        assert.equal(element.inert, inert, 'preserve each element’s prior inert state');
        assert.equal(element.getAttribute('aria-hidden'), ariaHidden, 'restore existing and absent accessibility attributes exactly');
        assert.equal(element.style.getPropertyValue('pointer-events'), pointerEvents);
        assert.equal(element.style.getPropertyPriority('pointer-events'), priority);
      }
      assert.equal(s.document.activeElement, opener);
    };
    for (const dismiss of [
      () => close.click(),
      () => close.dispatchEvent(new s.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})),
      () => dialog.dispatchEvent(new s.window.Event('cancel', {cancelable: true})),
      () => s.controls.destroy(),
    ]) {
      previous.focus();
      opener.click();
      assert.equal(dialog.hasAttribute('open'), true);
      assert.equal(dialog.open, undefined);
      assert.equal(dialog.getAttribute('role'), 'dialog');
      assert.ok(s.byId('pwa-install-backdrop'));
      for (const {element, inert} of original) {
        assert.equal(element.getAttribute('aria-hidden'), 'true');
        assert.equal(element.style.getPropertyValue('pointer-events'), 'none');
        assert.equal(element.inert, inert, 'interaction blocking must not depend on inert expandos');
      }
      opener.click(); // Reopening must not overwrite the saved inert states.
      dismiss();
      checkRestored();
    }
  } finally { s.cleanup(); }
});

test('fallback blocks background activation and redirects outside focus without inert', () => {
  const s = start({noNativeDialog: true});
  try {
    const previous = s.byId('share'), close = s.byId('pwa-install-close'), events = [];
    for (const type of ['click', 'pointerdown', 'touchstart', 'keydown', 'focus']) previous.addEventListener(type, () => events.push(type));
    s.open();
    previous.click();
    for (const type of ['pointerdown', 'touchstart', 'keydown']) {
      const event = new s.window.Event(type, {bubbles: true, cancelable: true});
      previous.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, `${type} cannot activate the background`);
    }
    previous.focus();
    assert.equal(s.document.activeElement, close, 'programmatic outside focus returns inside the modal');
    assert.deepEqual(events, [], 'background handlers are not activated');
    const tab = new s.window.KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true});
    close.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, true);
    assert.equal(s.document.activeElement, close);
    close.click();
    previous.click();
    previous.focus();
    assert.deepEqual(events, ['click', 'focus'], 'ordinary background controls work again after close');
    assert.equal(s.document.activeElement, previous);
  } finally { s.cleanup(); }
});

test('watch mode never opens an install overlay, including after a browser prompt event', () => {
  const s = start({watch: true});
  try {
    const offer = s.offer();
    s.open();
    assert.equal(s.byId('pwa-install').open, false);
    assert.equal(offer.calls(), 0, 'watch mode also blocks direct native prompts');
  } finally { s.cleanup(); }
});

test('a direct prompt can recover focus after the browser blurs the icon', async () => {
  const s = start();
  try {
    let finish;
    s.offer({pending: new Promise(resolve => { finish = resolve; })});
    s.open();
    s.byId('pwa-install-open').blur();
    assert.equal(s.document.activeElement, s.document.body);
    finish({outcome: 'dismissed'});
    await tick();
    assert.equal(s.byId('pwa-install').open, false);
    assert.equal(s.document.activeElement, s.byId('pwa-install-open'));
  } finally { s.cleanup(); }
});

for (const change of ['focus', 'navigation', 'standalone', 'watch', 'destroy']) {
  test(`a delayed direct prompt failure does not interrupt a later ${change} change`, async () => {
    const s = start();
    try {
      let fail;
      const offer = s.offer({pending: new Promise((_, reject) => { fail = reject; })});
      s.open();
      if (change === 'focus') s.byId('share').focus();
      if (change === 'navigation') s.window.location.hash = '#8/31/115';
      if (change === 'standalone') { s.media.matches = true; s.media.dispatchEvent(new s.window.Event('change')); }
      if (change === 'watch') s.document.body.dataset.ui = 'watch';
      if (change === 'destroy') s.controls.destroy();
      fail(new Error('Browser prompt rejected'));
      await tick();
      assert.equal(offer.calls(), 1);
      assert.equal(s.byId('pwa-install').open, false, 'late failure does not reopen help in another interaction');
      if (change === 'focus') assert.equal(s.document.activeElement, s.byId('share'));
    } finally { s.cleanup(); }
  });
}
