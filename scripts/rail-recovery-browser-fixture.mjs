import assert from 'node:assert/strict';

// A real MapLibre source remains pending while rail recovery completes. This
// rules out idle as the cause of the visible status update. All data is local.
export async function checkRailRecoveryWithoutIdle({page,base,outage}) {
  let releasePending, pendingStarted;
  const started = new Promise(resolve => {pendingStarted = resolve;});
  const pending = new Promise(resolve => {releasePending = resolve;});
  await page.route(base+'pending-recovery.geojson', async route => {
    pendingStarted();await pending;
    await route.fulfill({json:{type:'FeatureCollection',features:[]}}).catch(() => {});
  });
  outage.enabled = true;outage.allowSuccess = false;outage.path = null;outage.otherPath = null;outage.recoveredPaths.clear();
  try {
    await page.goto(base+'?mode=speed&language=en&relief=0&inactive=0&transport=0&destinations=0&constraints=0#7/30.55/114.4',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body[data-map-ready="true"]',{timeout:90000});
    await page.evaluate(async base => {
      const {map}=await import(document.querySelector('script[type="module"]').src);
      window.fixtureMap=map;window.recoveryEvents=[];
      for(const type of ['error','sourcedata','idle','moveend'])map.on(type,event=>{
        if(type==='sourcedata'&&event.sourceId!=='railway'&&event.sourceId!=='pendingRecovery')return;
        window.recoveryEvents.push({type,sourceId:event.sourceId,tileState:event.tile?.state,
          sourceDataType:event.sourceDataType,isSourceLoaded:event.isSourceLoaded,
          coordinate:event.tile?.tileID?.canonical,
          message:event.error?.message,status:document.getElementById('map-status').textContent,at:performance.now()});
      });
      map.addSource('pendingRecovery',{type:'geojson',data:base+'pending-recovery.geojson'});
      map.addLayer({id:'pending-recovery',type:'circle',source:'pendingRecovery'});
    },base);
    let pendingTimer;
    try {await Promise.race([started,new Promise((_,reject)=>{pendingTimer=setTimeout(()=>reject(new Error('Pending local source was not requested')),10000);})]);}
    finally {clearTimeout(pendingTimer);}
    await page.waitForFunction(()=>document.getElementById('map-status').classList.contains('error')&&
      document.getElementById('map-status').textContent.includes('Retrying automatically')&&
      new Set(recoveryEvents.filter(e=>e.type==='error'&&e.sourceId==='railway').map(e=>JSON.stringify(e.coordinate))).size>=2,null,{timeout:30000});
    const settings=await page.evaluate(()=>{
      const at=performance.now(),center=fixtureMap.getCenter().toArray();
      document.querySelector('[data-background="satellite"]').click();
      const hidden=fixtureMap.getLayoutProperty('speed-tracks','visibility');
      document.querySelector('[data-background="map"]').click();
      return {at,center,hidden,shown:fixtureMap.getLayoutProperty('speed-tracks','visibility'),status:document.getElementById('map-status').textContent};
    });
    assert.equal(settings.hidden,'none');assert.equal(settings.shown,'visible');
    assert.match(settings.status,/Retrying automatically/);
    const before=await page.evaluate(()=>({status:document.getElementById('map-status').textContent,
      pending:!fixtureMap.isSourceLoaded('pendingRecovery'),at:performance.now()}));
    assert.equal(before.pending,true);
    await page.screenshot({path:'browser-review/rail-outage-before.png'});
    assert.ok(outage.path&&outage.otherPath,'two distinct visible tile failures are required');
    outage.recoveredPaths.add(outage.path);
    const recoveredCoordinate=outage.path.split('/').slice(-3).map(Number);
    await page.waitForFunction(([z,x,y])=>recoveryEvents.some(e=>e.type==='sourcedata'&&e.sourceId==='railway'&&e.tileState==='loaded'&&
      e.coordinate?.z===z&&e.coordinate?.x===x&&e.coordinate?.y===y),recoveredCoordinate,{timeout:30000});
    const partial=await page.evaluate(()=>({status:document.getElementById('map-status').textContent,
      error:document.getElementById('map-status').classList.contains('error'),pending:!fixtureMap.isSourceLoaded('pendingRecovery'),at:performance.now()}));
    assert.equal(partial.error,true,'one remaining failed tile must retain the outage warning');
    assert.match(partial.status,/Retrying automatically/);assert.equal(partial.pending,true);
    await page.screenshot({path:'browser-review/rail-outage-partial.png'});
    outage.allowSuccess=true;
    await page.waitForFunction(()=>!document.getElementById('map-status').classList.contains('error'),null,{timeout:30000});
    const after=await page.evaluate(()=>({status:document.getElementById('map-status').textContent,
      pending:!fixtureMap.isSourceLoaded('pendingRecovery'),loaded:fixtureMap.loaded(),
      rails:fixtureMap.queryRenderedFeatures({layers:['speed-tracks']}).filter(f=>f.properties.id==='fixture-wuhan-mainline').length,
      at:performance.now(),events:recoveryEvents}));
    assert.equal(after.pending,true,'unrelated local source is still pending');
    assert.equal(after.loaded,false,'map cannot become idle while the local source is pending');
    assert.ok(after.rails>0,'real renderer shows the recovered rail geometry');
    assert.ok(after.events.some(e=>e.type==='sourcedata'&&e.sourceId==='railway'&&e.tileState==='loaded'));
    assert.equal(after.events.filter(e=>e.type==='idle'&&e.at>=before.at).length,0,'no idle event can conceal stale recovery status');
    assert.equal(after.events.filter(e=>e.type==='moveend'&&e.at>=settings.at).length,0,'settings resume recovery without a pan');
    await page.screenshot({path:'browser-review/rail-outage-after.png'});
    // Unknown endpoints must retain their normal TileJSON fallback.
    await page.evaluate(()=>fixtureMap.addSource('unknownRailFixture',{type:'vector',url:'atlasrail://https://openrailwaymap.app/fixture_unknown'}));
    await page.waitForFunction(()=>fixtureMap.getSource('unknownRailFixture')?.tiles?.length>0,null,{timeout:10000});
    return {settings,before,partial,after,failedPaths:[outage.path,outage.otherPath],unknownMetadataFallback:true};
  } finally {outage.enabled=false;releasePending();}
}
