import {assert, start, test, style, tick} from './startup-harness.mjs';

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

test('Configured administrator backend wires the supplied provider into the real app, without a live API key', async () => {
  const backend='https://auth.10671435.xyz', requests=[];
  const tile=new Uint8Array([137,80,78,71,13,10,26,10]);
  let tileServiceAvailable=false;
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const fetcher=async(input,options={})=>{
    const url=String(input);
    if(url.includes('/imagery-config.json'))return json({authBackendOrigin:backend,adminRepo:'c933103/openrailwaystyle'});
    if(url.startsWith(backend)){
      requests.push({url,options});
      if(url.endsWith('/api/gmaps/session'))return tileServiceAvailable?json({unlocked:true,mode:'tiles',variant:'roadmap'}):json({error:'Google Maps API key is not configured'},503);
      if(url.includes('/api/gmaps/tiles/'))return new Response(tile,{headers:{'Content-Type':'image/png'}});
      if(url.includes('/api/gmaps/viewport'))return json({copyright:'Mock Google attribution'});
      if(url.endsWith('/api/auth/logout'))return json({ok:true});
      return json({authenticated:false});
    }
    assert.ok(!/googleapis\.com|maps\.google\.com/.test(url),'No direct provider request with only a backend configured');
    return url.includes('/data/traction/power/')?json({type:'FeatureCollection',features:[]}):({ok:true,json:async()=>structuredClone(style)});
  };
  const {dom,window,maps}=await start({styleLoaded:true,fetcher});
  const element=id=>window.document.getElementById(id);
  const map=maps[0];
  try{
    assert.equal(element('admin-login').hidden,true);
    assert.equal(element('admin-settings').hidden,false);
    assert.ok(map.getStyle().sources.googleTiles);
    map.handlers['style.load']?.();
    assert.equal(map.visibility['google-tiles'],'none');
    assert.equal(requests.filter(r=>r.url.includes('/api/gmaps/')).length,0);
    window.dispatchEvent(new window.MessageEvent('message',{origin:backend,data:{type:'OAUTH_AUTH_SUCCESS',session:{token:'fixture-owner-session',login:'owner',repo:'c933103/openrailwaystyle',expiresAt:Date.now()+3600000}}}));
    assert.equal(element('admin-controls').hidden,false);
    const select=element('admin-map-source');
    const choose=value=>{select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));};
    choose('google');
    for(let i=0;i<20;i++)await tick();
    assert.equal(select.value,'standard');
    assert.equal(map.visibility['google-tiles'],'none');
    assert.match(element('admin-status').textContent,/not configured/);
    tileServiceAvailable=true;
    choose('google');
    for(let i=0;i<20;i++)await tick();
    assert.equal(select.value,'google');
    assert.equal(map.visibility['google-tiles'],'visible');
    const bytes=await maps.protocols.atlasgmaps({url:'atlasgmaps://roadmap/3/2/4?lang=en'},new AbortController());
    assert.deepEqual(new Uint8Array(bytes.data),tile);
    const served=requests.find(r=>r.url.includes('/api/gmaps/tiles/'));
    assert.equal(served.options.headers.Authorization,'Bearer fixture-owner-session');
    assert.ok(!served.url.includes('fixture-owner-session'));
    choose('standard');
    assert.equal(map.visibility['google-tiles'],'none');
  }finally{
    element('admin-signout')?.click();
    map?.handlers.remove?.();
    dom.window.close();
  }
});
