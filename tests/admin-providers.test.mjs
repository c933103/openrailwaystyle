import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {ownerSessionEnd, viewportRanges, bindAdminProviders} from '../styles/admin-providers.mjs';

const html = await readFile('styles/index.html','utf8');
const ownerId='1525293';
const user={providerData:[{providerId:'github.com',uid:ownerId}]};
const result={signInProvider:'github.com',authTime:'2026-11-01T07:00:00Z',claims:{firebase:{identities:{'github.com':[ownerId]}}}};

test('the owner session requires matching GitHub identity, sign-in provider, and age', () => {
  assert.equal(ownerSessionEnd(result,user,ownerId),Date.parse('2026-11-01T19:00:00Z'));
  assert.equal(ownerSessionEnd({...result,signInProvider:'password'},user,ownerId),0);
  assert.equal(ownerSessionEnd(result,user,'1000'),0);
  assert.equal(ownerSessionEnd({...result,claims:{}},user,ownerId),0);
  assert.deepEqual(viewportRanges({getWest:()=>175,getEast:()=>-175}),[[175,180],[-180,-175]]);
});

test('settings login reveals both switches only to the owner; sign-out restores the public background', async () => {
  const dom=new JSDOM(html,{url:'https://atlas.example/'}), {document}=dom.window;
  const el=id=>document.getElementById(id);
  const settings={background:'soviet',language:'en'}, layers=new Map(),sources=new Map(),protocols=new Map();
  const map={getStyle:()=>({layers:[{id:'rail',metadata:{'atlas:group':'railway'}}]}),getLayer:id=>layers.get(id),getSource:id=>sources.get(id),
    addLayer:l=>layers.set(l.id,l),addSource:(id,s)=>sources.set(id,s),removeLayer:id=>layers.delete(id),removeSource:id=>sources.delete(id),on:()=>{}};
  let notify;
  const api=bindAdminProviders({document,window:dom.window,settings,refresh:()=>api.sync(),
    fetcher:async()=>Response.json({firebase:{apiKey:'fixture',authDomain:'fixture',projectId:'fixture'},ownerId}),
    loadAuth:async (_,cb)=>{notify=cb;return {login:async()=>{},logout:async()=>{}};}});
  api.bind(map);api.installProtocols({addProtocol:(name,fn)=>protocols.set(name,fn)});
  assert.equal(el('admin-login').closest('section').id,'settings-view');
  assert.equal(el('admin-login').textContent,'Administrator login');
  assert.equal(el('admin-providers').hidden,true);
  el('soviet-provider').value='nakarte';el('soviet-provider').dispatchEvent(new dom.window.Event('change'));
  await assert.rejects(protocols.get('atlasnakarte')({url:'atlasnakarte://2/1/1'},new AbortController()));
  el('admin-login').click(); await new Promise(resolve=>setImmediate(resolve));
  notify(0); notify(Date.now()+10000);
  assert.equal(el('admin-providers').hidden,false);
  assert.equal(el('map-provider').value,'standard');
  el('soviet-provider').value='nakarte';el('soviet-provider').dispatchEvent(new dom.window.Event('change'));
  assert.equal(settings.nakarte,true); assert.ok(layers.has('admin-nakarte'));
  el('admin-login').click(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el('admin-providers').hidden,true);assert.equal(settings.nakarte,false);
  assert.equal(el('soviet-provider').value,'indian');assert.equal(layers.size,0);dom.window.close();
});

test('Google requests start on owner selection, carry viewport credit and stop on logout', async () => {
  const dom = new JSDOM(html,{url:'https://atlas.example/'}), {document} = dom.window;
  const el = id => document.getElementById(id);
  const settings = {background:'hybrid', language:'en'};
  const layers = new Map(), sources = new Map(), protocols = new Map(), requests = [];
  const bounds = {getWest:()=>175,getEast:()=>185,getNorth:()=>10,getSouth:()=>-10};
  const map = {getBounds:()=>bounds,getZoom:()=>5,getStyle:()=>({layers:[{id:'rail',metadata:{'atlas:group':'railway'}}]}),
    getLayer:id=>layers.get(id),getSource:id=>sources.get(id),addLayer:l=>layers.set(l.id,l),addSource:(id,s)=>sources.set(id,s),
    removeLayer:id=>layers.delete(id),removeSource:id=>sources.delete(id),on:()=>{}};
  let principal;
  const fetcher = async (url, init) => {
    if (String(url).includes('admin-config')) return Response.json({firebase:{apiKey:'fixture',authDomain:'test',projectId:'test'},ownerId,googleMapsKey:'fixture'});
    requests.push(String(url));
    assert.equal(init.credentials,'omit');
    if (url.pathname.includes('createSession')) return Response.json({session:'fixture',expiry:Date.now()/1000+3600});
    if (url.pathname.includes('viewport')) return Response.json({copyright:'Fixture imagery'});
    return new Response('fixture');
  };
  const api = bindAdminProviders({document,window:dom.window,settings,refresh:()=>api.sync(),fetcher,
    loadAuth:async (_,cb)=>{principal=cb;return {login:async()=>{},logout:async()=>{}};}});
  api.bind(map);api.installProtocols({addProtocol:(k,f)=>protocols.set(k,f)});
  el('admin-login').click(); await new Promise(resolve=>setImmediate(resolve));
  principal(Date.now()+10000);
  assert.equal(requests.length,0);
  el('map-provider').value='google';el('map-provider').dispatchEvent(new dom.window.Event('change'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(layers.has('admin-google'));assert.equal(el('google-credit-text').textContent,'Fixture imagery');
  assert.equal(requests.filter(r=>r.includes('viewport')).length,2);
  const tile={url:'atlasgoogle://6/34/33'};
  await protocols.get('atlasgoogle')(tile,new AbortController());
  assert.ok(requests.at(-1).includes('v1/2dtiles/6/34/33'));
  principal(0);
  assert.equal(layers.size,0);assert.equal(el('google-map-credit').hidden,true);
  await assert.rejects(protocols.get('atlasgoogle')(tile,new AbortController()));
  dom.window.close();
});
