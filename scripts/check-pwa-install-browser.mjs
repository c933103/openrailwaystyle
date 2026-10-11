// Real DOM/dialog interactions under iPhone/iPad browser profiles. The map
// libraries deliberately fail here: installation help must remain usable.
// Set ATLAS_PWA_ENGINE=webkit for WebKit engine coverage (not physical iOS).
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';
import {blockRequiredBrowserScripts} from './required-browser-libraries.mjs';

const engine=process.env.ATLAS_PWA_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine),'Known test browser engine');
const server=await serveAtlasAppFixture();
const browser=await launchBrowser({engine});
const report=[];
const profiles=[
  {name:'iphone',viewport:{width:393,height:852},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',platform:'iPhone',touch:5},
  {name:'ipad-desktop',viewport:{width:834,height:1112},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',platform:'MacIntel',touch:5},
  {name:'browser',viewport:{width:1280,height:800},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',platform:'Linux x86_64',touch:0},
  {name:'standalone-ios',viewport:{width:393,height:852},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',platform:'iPhone',touch:5,standalone:true},
  {name:'legacy-dialog',viewport:{width:320,height:568},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 15_3 like Mac OS X) AppleWebKit/605.1.15 Version/15.3 Mobile/15E148 Safari/604.1',platform:'iPhone',touch:5,legacyDialog:true},
];

async function offerNativePrompt(page,scenario){
  // Controlled capability events exercise real DOM and focus rules without
  // performing an OS installation in browser automation.
  await page.evaluate(({outcome,immediateFailure})=>{
    window.installPromptCalls=0;window.installPromptInClick=false;
    const event=new Event('beforeinstallprompt',{cancelable:true});
    event.prompt=()=>{
      window.installPromptCalls++;window.installPromptInClick=window.installClickActive;
      if(immediateFailure)throw new Error('Installation prompt failed');
      return Promise.resolve();
    };
    event.userChoice=new Promise((resolve,reject)=>{
      window.finishInstallPrompt=()=>outcome==='failed'?reject(new Error('Installation choice failed')):resolve({outcome});
    });
    window.dispatchEvent(event);
  },scenario);
}

async function checkDirectInstallPrompt(page,opener,dialog){
  for(const scenario of [
    {outcome:'dismissed'},
    {outcome:'accepted'},
    {outcome:'failed'},
    {outcome:'failed',immediateFailure:true},
    {outcome:'failed',focusElsewhere:true},
    {outcome:'dismissed',blur:true},
  ]){
    await offerNativePrompt(page,scenario);
    assert.equal(await opener.getAttribute('aria-controls'),null,'direct install does not claim to open the help dialog');
    await opener.focus();
    await opener.press('Enter');
    assert.deepEqual(await page.evaluate(()=>({calls:window.installPromptCalls,inClick:window.installPromptInClick})),
      {calls:1,inClick:true},'the original icon activation calls prompt() synchronously');
    assert.equal(await opener.evaluate(node=>node.disabled),false,'the pending icon stays natively focusable');
    if(!scenario.immediateFailure){
      assert.equal(await dialog.isVisible(),false,'direct installation has no intermediate dialog');
      assert.equal(await opener.evaluate(node=>node===document.activeElement),true);
      assert.equal(await opener.getAttribute('aria-busy'),'true');
      await opener.press('Enter');
      assert.equal(await page.evaluate(()=>window.installPromptCalls),1,'a repeated pending click does not reuse the prompt');
      assert.equal(await dialog.isVisible(),false,'a repeated pending click does not open help');
      if(scenario.focusElsewhere)await page.locator('#settings-open').focus();
      if(scenario.blur)await opener.evaluate(node=>node.blur());
      await page.evaluate(()=>window.finishInstallPrompt());
    }
    const marker=scenario.outcome==='failed'?'could not open':scenario.outcome;
    await page.waitForFunction(marker=>document.getElementById('pwa-install-status').textContent.includes(marker),marker);
    const fallback=scenario.outcome==='failed'&&!scenario.focusElsewhere;
    assert.equal(await dialog.isVisible(),fallback,'only a relevant prompt failure opens the manual fallback');
    assert.equal(await opener.getAttribute('aria-busy'),null);
    assert.equal(await page.evaluate(()=>document.activeElement.id),
      fallback?'pwa-install-close':scenario.focusElsewhere?'settings-open':'pwa-install-open',
      'completion keeps meaningful focus and preserves a later control choice');
    if(!fallback){
      await opener.click();await dialog.waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>window.installPromptCalls),1,'a consumed offer falls back to instructions on the next click');
    }
    assert.equal(await page.locator('#pwa-install-native').isVisible(),false);
    await page.locator('#pwa-install-close').click();await dialog.waitFor({state:'hidden'});
  }
}

async function checkNativePromptFocus(page,opener,dialog){
  const action=page.locator('#pwa-install-native'),close=page.locator('#pwa-install-close');
  await page.evaluate(()=>{
    // This flag is cleared as the click bubbles out. A deferred prompt()
    // invocation would miss the initiating click even if it ran soon after.
    for(const id of ['pwa-install-open','pwa-install-native']){
      document.getElementById(id).addEventListener('click',()=>{window.installClickActive=true;},{capture:true});
    }
    window.addEventListener('click',()=>{window.installClickActive=false;});
  });
  await checkDirectInstallPrompt(page,opener,dialog);
  for(const scenario of [
    {outcome:'dismissed'},
    {outcome:'accepted'},
    {outcome:'failed'},
    {outcome:'failed',immediateFailure:true},
    {outcome:'dismissed',focusElsewhere:true},
    {outcome:'dismissed',closeBeforeChoice:true},
  ]){
    // A late capability event must retain the action in already-open help.
    await opener.click();
    await offerNativePrompt(page,scenario);
    // Pointer clicks in WebKit may retain the previous focus. Keyboard
    // activation ensures the action really owns focus before it is disabled.
    await action.focus();
    assert.equal(await action.evaluate(node=>node===document.activeElement),true);
    await action.press('Enter');
    assert.deepEqual(await page.evaluate(()=>({calls:window.installPromptCalls,inClick:window.installPromptInClick})),
      {calls:1,inClick:true},'prompt() runs synchronously inside the initiating click');
    if(!scenario.immediateFailure){
      assert.equal(await action.isVisible(),true,'pending browser action stays visible');
      assert.equal(await action.isDisabled(),true,'pending browser action cannot be reused');
      assert.equal(await close.evaluate(node=>node===document.activeElement),true,'disabling the focused action transfers focus to Close');
      if(scenario.focusElsewhere){
        await page.locator('#pwa-install-description').evaluate(node=>{node.tabIndex=-1;node.focus();});
      }else if(scenario.closeBeforeChoice){
        await close.click();await dialog.waitFor({state:'hidden'});
        assert.equal(await opener.evaluate(node=>node===document.activeElement),true);
      }
      await page.evaluate(()=>window.finishInstallPrompt());
    }
    const marker=scenario.outcome==='failed'?'could not open':scenario.outcome;
    await page.waitForFunction(marker=>document.getElementById('pwa-install-status').textContent.includes(marker),marker);
    assert.equal(await action.isVisible(),false,'a consumed action is hidden after the browser outcome');
    assert.equal(await opener.isVisible(),true,'the browser outcome retains manual installation help');
    const expectedFocus=scenario.closeBeforeChoice?'pwa-install-open':scenario.focusElsewhere?'pwa-install-description':'pwa-install-close';
    assert.equal(await page.evaluate(()=>document.activeElement.id),expectedFocus,'completion preserves a usable focus target or the user’s later focus');
    assert.equal(await dialog.isVisible(),!scenario.closeBeforeChoice,'completion does not reopen dismissed help');
    if(!scenario.closeBeforeChoice){await close.click();await dialog.waitFor({state:'hidden'});}
    if(scenario.focusElsewhere)await page.locator('#pwa-install-description').evaluate(node=>node.removeAttribute('tabindex'));
  }
}

try {
  await mkdir('browser-review',{recursive:true});
  for(const profile of profiles){
    const context=await browser.newContext({viewport:profile.viewport,userAgent:profile.userAgent,hasTouch:profile.touch>0,serviceWorkers:'block'});
    const page=await context.newPage(),errors=[],blocked=[];
    const base=server.origin+'/atlas-project/';
    await context.addInitScript(({platform,touch,standalone,legacyDialog})=>{
      Object.defineProperty(navigator,'platform',{configurable:true,get:()=>platform});
      Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,get:()=>touch});
      if(standalone)Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true});
      if(legacyDialog){
        for(const property of ['showModal','close','open'])delete HTMLDialogElement.prototype[property];
        delete HTMLElement.prototype.inert;
        delete Array.prototype.at;
      }
    },profile);
    await installEmptyMapProviders(context,base,{firstParty:'network'});
    const blockedLibraries=await blockRequiredBrowserScripts(page,base);
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(/jsdelivr\.net$/.test(url.hostname)){
        blocked.push(url.href);return route.abort('blockedbyclient');
      }
      if(['script','stylesheet'].includes(request.resourceType())&&url.origin!==server.origin)return route.abort('blockedbyclient');
      return route.fallback();
    });
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'?language=en&relief=0#5/30/114',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body[data-app-started="true"]');
    await page.waitForFunction(()=>document.getElementById('map-status').textContent.includes('could not load'));
    if(profile.legacyDialog){
      // An unknown dialog element also lacks the UA display:none/positioning
      // rules. Removing APIs alone would accidentally retain that protection.
      await page.addStyleTag({content:'dialog{display:block;position:static;inset:auto;margin:0}'});
      await page.evaluate(()=>{
        const frame=document.getElementById('map-frame'),share=document.getElementById('share');
        frame.setAttribute('aria-hidden','false');frame.style.setProperty('pointer-events','auto','important');
        document.body.style.setProperty('overflow','scroll','important');
        window.fallbackBackgroundState=()=>[frame,document.querySelector('.panel')].map(node=>({
          ariaHidden:node.getAttribute('aria-hidden'),pointer:node.style.getPropertyValue('pointer-events'),
          priority:node.style.getPropertyPriority('pointer-events'),inert:node.inert,
        }));
        window.fallbackOriginal=window.fallbackBackgroundState();
        window.fallbackEvents={pointers:0,clicks:0,focuses:0};
        frame.addEventListener('pointerdown',()=>window.fallbackEvents.pointers++);
        share.addEventListener('click',()=>window.fallbackEvents.clicks++);
        share.addEventListener('focus',()=>window.fallbackEvents.focuses++);
      });
    }
    assert.ok(blockedLibraries.some(request=>request.package==='maplibre-gl'),'the current renderer request must actually be blocked');
    assert.equal(await page.evaluate(()=>typeof window.maplibregl),'undefined','a different library failure must not mask a successfully loaded renderer');
    const opener=page.locator('#pwa-install-open'),dialog=page.locator('#pwa-install');
    assert.equal(await dialog.isVisible(),false,'no intrusive automatic installation dialog');
    if(profile.standalone){
      assert.equal(await opener.isVisible(),false,'standalone session hides installation control');
    }else{
      if(await page.locator('#controls-open').getAttribute('aria-expanded')==='false')await page.locator('#controls-open').click();
      await opener.scrollIntoViewIfNeeded();
      const toolbar=await opener.evaluate(button=>{
        const siblings=[...button.parentElement.querySelectorAll('button')];
        const cluster=siblings.slice(-3).map(node=>({id:node.id,...Object.fromEntries(
          ['left','top','right','width','height'].map(key=>[key,node.getBoundingClientRect()[key]]))}));
        return {text:button.textContent.trim(),label:button.getAttribute('aria-label'),title:button.title,
          icon:button.classList.contains('icon-button'),cluster};
      });
      assert.equal(toolbar.text,'','Install is icon-only');
      assert.equal(toolbar.icon,true);
      assert.equal(toolbar.label,'Install Railway Atlas');assert.equal(toolbar.title,toolbar.label);
      assert.deepEqual(toolbar.cluster.map(button=>button.id).sort(),['about-open','pwa-install-open','settings-open']);
      for(const button of toolbar.cluster){
        assert.ok(Math.abs(button.width-40)<1,'Install uses the existing compact icon width');
        assert.ok(Math.abs(button.top-toolbar.cluster[0].top)<1,'Install, Settings and Help share a row, including at 320px');
        assert.ok(button.left>=0&&button.right<=profile.viewport.width,'the icon cluster fits the viewport');
      }
      if(profile.viewport.width===320)await page.screenshot({path:`browser-review/pwa-install-${engine}-toolbar-320.png`});
      await opener.click();await dialog.waitFor({state:'visible'});
      if(profile.legacyDialog){
        const fallback=await page.evaluate(()=>{
          const dialog=document.getElementById('pwa-install'),backdrop=document.getElementById('pwa-install-backdrop');
          return {hasOpen:'open' in dialog,hasInert:'inert' in HTMLElement.prototype,hasArrayAt:typeof Array.prototype.at!=='undefined',
            position:getComputedStyle(dialog).position,role:dialog.getAttribute('role'),
            backdropAtCorner:document.elementFromPoint(4,4)===backdrop};
        });
        assert.deepEqual(fallback,{hasOpen:false,hasInert:false,hasArrayAt:false,position:'fixed',role:'dialog',backdropAtCorner:true});
        await page.mouse.click(4,4);await page.touchscreen.tap(4,4);
        await page.evaluate(()=>{const share=document.getElementById('share');share.click();share.focus();});
        assert.deepEqual(await page.evaluate(()=>window.fallbackEvents),{pointers:0,clicks:0,focuses:0},'background pointer, click and focus handlers stay blocked');
        assert.equal(await page.locator('#pwa-install-close').evaluate(node=>node===document.activeElement),true,'outside focus is redirected into the fallback');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#pwa-install-close').evaluate(node=>node===document.activeElement),true,'Tab stays in the fallback');
      }
      const ios=profile.name!=='browser';
      assert.equal(await page.locator('#pwa-install-ios').isVisible(),ios);
      assert.equal(await page.locator('#pwa-install-generic').isVisible(),!ios);
      if(ios){
        const text=await page.locator('#pwa-install-ios').innerText();
        for(const words of ['Share','Add to Home Screen','Open as Web App','Edit Actions'])assert.ok(text.includes(words),words);
      }
      const layout=await dialog.evaluate(node=>{
        const r=node.getBoundingClientRect();
        return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,overflow:node.scrollWidth>node.clientWidth};
      });
      assert.ok(layout.left>=0&&layout.top>=0&&layout.right<=profile.viewport.width&&layout.bottom<=profile.viewport.height,'installation dialog fits the viewport');
      assert.equal(layout.overflow,false,'instructions do not overflow horizontally');
      await page.screenshot({path:`browser-review/pwa-install-${engine}-${profile.name}.png`});
      await page.locator('#pwa-install-close').click();await dialog.waitFor({state:'hidden'});
      assert.equal(await opener.evaluate(node=>node===document.activeElement),true,'close returns focus to the install button');
      if(profile.legacyDialog){
        const restored=await page.evaluate(()=>({state:window.fallbackBackgroundState(),original:window.fallbackOriginal,
          backdrop:!!document.getElementById('pwa-install-backdrop'),overflow:document.body.style.getPropertyValue('overflow'),
          priority:document.body.style.getPropertyPriority('overflow')}));
        assert.deepEqual(restored.state,restored.original,'restore prior background aria, pointer and inert state');
        assert.equal(restored.backdrop,false);assert.equal(restored.overflow,'scroll');assert.equal(restored.priority,'important');
        await page.mouse.click(4,4);
        await page.evaluate(()=>{const share=document.getElementById('share');share.click();share.focus();});
        assert.deepEqual(await page.evaluate(()=>window.fallbackEvents),{pointers:1,clicks:1,focuses:1},'background interaction works after close');
      }
      await opener.click();await dialog.waitFor({state:'visible'});
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      if(profile.legacyDialog){
        assert.equal(await page.locator('#pwa-install-backdrop').count(),0);
        assert.equal(await opener.evaluate(node=>node===document.activeElement),true);
      }
      if(!ios){
        await checkNativePromptFocus(page,opener,dialog);
      }
    }
    assert.deepEqual(errors,[],'installation guidance survives renderer failure without unhandled errors');
    report.push({engine,profile:profile.name,rendererBlocked:true,blockedLibraries,blockedCdns:blocked,errors});
    await context.close();
  }
  await writeFile(`browser-review/pwa-install-${engine}.json`,JSON.stringify(report,null,2)+'\n');
  console.log(`PASS (${engine}): iPhone, desktop-UA iPad, browser prompt wiring, standalone UI and legacy dialog fallback with failed renderer`);
}finally{await browser.close();await server.close();}
