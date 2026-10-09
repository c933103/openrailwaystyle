// Real DOM/dialog interactions under iPhone/iPad browser profiles. The map
// libraries deliberately fail here: installation help must remain usable.
// Set ATLAS_PWA_ENGINE=webkit for WebKit engine coverage (not physical iOS).
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {webkit} from 'playwright';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';

const engine=process.env.ATLAS_PWA_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine),'Known test browser engine');
const server=await serveAtlasAppFixture();
const browser=engine==='webkit'?await webkit.launch({headless:true}):await launchBrowser();
const report=[];
const profiles=[
  {name:'iphone',viewport:{width:393,height:852},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',platform:'iPhone',touch:5},
  {name:'ipad-desktop',viewport:{width:834,height:1112},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',platform:'MacIntel',touch:5},
  {name:'browser',viewport:{width:1280,height:800},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',platform:'Linux x86_64',touch:0},
  {name:'standalone-ios',viewport:{width:393,height:852},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',platform:'iPhone',touch:5,standalone:true},
  {name:'legacy-dialog',viewport:{width:320,height:568},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 15_3 like Mac OS X) AppleWebKit/605.1.15 Version/15.3 Mobile/15E148 Safari/604.1',platform:'iPhone',touch:5,legacyDialog:true},
];
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
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(/\/(maplibre-gl-5\.24\.0|pmtiles-4\.2\.1)\.js$/.test(url.pathname)
        ||/jsdelivr\.net$/.test(url.hostname)){
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
    assert.ok(blocked.some(url=>url.includes('maplibre-gl-5.24.0.js')),'renderer must actually fail in this case');
    const opener=page.locator('#pwa-install-open'),dialog=page.locator('#pwa-install');
    assert.equal(await dialog.isVisible(),false,'no intrusive automatic installation dialog');
    if(profile.standalone){
      assert.equal(await opener.isVisible(),false,'standalone session hides installation control');
    }else{
      if(await page.locator('#controls-open').getAttribute('aria-expanded')==='false')await page.locator('#controls-open').click();
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
        // A controlled capability event validates user-gesture wiring; this
        // does not claim to perform an OS-level installation in automation.
        await page.evaluate(()=>{
          window.installPromptCalls=0;
          const event=new Event('beforeinstallprompt',{cancelable:true});
          event.prompt=async()=>{window.installPromptCalls++;return {outcome:'dismissed'};};
          event.userChoice=Promise.resolve({outcome:'dismissed'});
          window.dispatchEvent(event);
        });
        await opener.click();
        await page.locator('#pwa-install-native').click();
        await page.waitForFunction(()=>window.installPromptCalls===1);
        assert.equal(await opener.isVisible(),true,'dismissing the browser prompt retains manual help');
      }
    }
    assert.deepEqual(errors,[],'installation guidance survives renderer failure without unhandled errors');
    report.push({engine,profile:profile.name,rendererBlocked:true,errors});
    await context.close();
  }
  await writeFile(`browser-review/pwa-install-${engine}.json`,JSON.stringify(report,null,2)+'\n');
  console.log(`PASS (${engine}): iPhone, desktop-UA iPad, browser prompt wiring, standalone UI and legacy dialog fallback with failed renderer`);
}finally{await browser.close();await server.close();}
