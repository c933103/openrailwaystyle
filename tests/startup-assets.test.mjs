import {test,assert,start,style,tick} from './startup-harness.mjs';

const wait = async () => { for(let i=0;i<10;i++) await tick(); };
const close = async state => {
  state.loadLibraries();state.loadLabels();await wait();
  state.maps[0]?.handlers.remove?.();state.dom.window.close();
};
const fixture = (requests,{styleBody,imageryBody,styleStatus=200}={}) => async input => {
  const url=new URL(input);requests.push(url);
  if(url.pathname.endsWith('/world.style.json'))
    return {ok:styleStatus===200,status:styleStatus,json:async()=>styleBody?await styleBody:structuredClone(style)};
  if(url.pathname.endsWith('/imagery-config.json'))
    return {ok:true,json:async()=>imageryBody?await imageryBody:{}};
  throw new Error(`Unexpected startup fixture request: ${url}`);
};

test('first-party startup inputs begin before libraries and labels resolve, once per startup',async()=>{
  const requests=[];
  const state=await start({delayLibraries:true,delayLabels:true,assetQuery:'?v=overlap-fixture',fetcher:fixture(requests)});
  try{
    assert.equal(requests.filter(url=>url.pathname.endsWith('/world.style.json')).length,1);
    assert.equal(requests.filter(url=>url.pathname.endsWith('/imagery-config.json')).length,1);
    assert.ok(requests.every(url=>url.origin==='https://example.org'),'no provider request is needed');
    assert.equal(requests.find(url=>url.pathname.endsWith('/world.style.json')).searchParams.get('v'),'overlap-fixture');
    assert.equal(state.maps.length,0,'eager input fetches do not create a map without libraries');
    state.loadLibraries();await wait();
    assert.equal(state.maps.length,0,'labels remain a separate required input');
    state.loadLabels();await wait();
    assert.equal(state.maps.length,1);
    assert.equal(requests.filter(url=>url.pathname.endsWith('/world.style.json')).length,1,'no second style fetch after libraries resolve');
    assert.deepEqual(state.errors,[]);
  }finally{await close(state);}
});

for(const input of ['style','imagery'])test(`map waits for the ${input} body even when libraries are ready`,async()=>{
  let release;const body=new Promise(resolve=>{release=resolve;});
  const requests=[],state=await start({fetcher:fixture(requests,input==='style'?{styleBody:body}:{imageryBody:body})});
  try{
    assert.equal(requests.filter(url=>url.pathname.endsWith('/world.style.json')).length,1);
    assert.equal(requests.filter(url=>url.pathname.endsWith('/imagery-config.json')).length,1);
    assert.equal(state.maps.length,0);
    release(input==='style'?structuredClone(style):{});await wait();
    assert.equal(state.maps.length,1);
    assert.deepEqual(state.errors,[]);
  }finally{release(input==='style'?structuredClone(style):{});await close(state);}
});

for(const failure of ['http','json'])test(`early style ${failure} failure reaches the startup error handler while libraries are pending`,async()=>{
  const requests=[],state=await start({delayLibraries:true,delayLabels:true,fetcher:failure==='http'
    ?fixture(requests,{styleStatus:503})
    :async input=>{
      if(String(input).includes('imagery-config'))return {ok:true,json:async()=>({})};
      return {ok:true,json:async()=>{throw new Error('Synthetic invalid style JSON');}};
    }});
  try{
    assert.equal(state.maps.length,0);
    assert.equal(state.errors.length,1,'no unhandled rejection or silent pending failure');
    assert.match(state.window.document.getElementById('map-status').textContent,
      failure==='http'?/The map style could not load/:/Synthetic invalid style JSON/);
    state.loadLibraries();state.loadLabels();await wait();
    assert.equal(state.maps.length,0,'failed startup cannot later create a map');
    assert.equal(state.errors.length,1);
  }finally{await close(state);}
});

test('early imagery failure preserves the existing EOX-only fallback',async()=>{
  const state=await start({delayLibraries:true,fetcher:async input=>{
    if(String(input).includes('imagery-config'))throw new Error('Synthetic config outage');
    return {ok:true,json:async()=>structuredClone(style)};
  }});
  try{
    assert.equal(state.maps.length,0);state.loadLibraries();await wait();
    assert.equal(state.maps.length,1);
    assert.equal(state.maps.protocols.atlasimagery,undefined);
    assert.deepEqual(state.errors,[]);
  }finally{await close(state);}
});
