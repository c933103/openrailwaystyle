import {assert, start, test} from './startup-harness.mjs';

test('Settings keeps the frontend-only administrator panel locked for every integer draw', async t => {
  const {dom, window, maps} = await start({styleLoaded: true});
  try {
    const element = id => window.document.getElementById(id);
    const settings = element('settings-view');
    const login = element('admin-login');
    const providers = element('admin-providers');
    const notice = element('admin-notice');
    assert.equal(settings.hidden, true);
    assert.equal(login.closest('section'), settings);
    assert.equal(login.textContent, 'Administrator login');
    element('settings-open').click();
    assert.equal(settings.hidden, false);
    assert.equal(providers.hidden, true);
    assert.equal(notice.hidden, true);
    assert.deepEqual(Array.from(element('soviet-provider').options, option => option.text), ['Indian Open Maps', 'Alternate source']);
    assert.deepEqual(Array.from(element('map-provider').options, option => option.text), ['Standard', 'Google Maps']);

    const fetch = t.mock.method(window, 'fetch');
    let result = 0;
    const random = t.mock.method(window.Math, 'random', () => result);
    for (let draw = 0; draw <= 100; draw++) {
      result = (draw + 0.5) / 101;
      login.click();
      assert.equal(providers.hidden, true);
      assert.equal(notice.hidden, false);
    }
    assert.equal(random.mock.callCount(), 101);
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    maps[0]?.handlers.remove?.();
    dom.window.close();
  }
});
