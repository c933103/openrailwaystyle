// Keep evaluated startup fixtures isolated in their own Node process.
import {test,assert,readFile,style,start} from './startup-harness.mjs';
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));};
const ages=label=>({schema:1,staleAfterDays:90,datasets:[{label,date:label==='older'?'2000-01-01T00:00:00Z':new Date().toISOString()}]});
for(const stage of ['fetch','body'])for(const outcome of ['older success','older failure','newer failure'])
test(`Help data dates keep the newest result after a late ${outcome} at ${stage}`,async()=>{
 const pending=[];
 const {dom,window}=await start({fetcher:async input=>{
  if(!String(input).endsWith('data/data-ages.json'))return {ok:true,json:async()=>structuredClone(style)};
  const deferred=Promise.withResolvers();pending.push(deferred);
  return stage==='fetch'?deferred.promise:{ok:true,json:()=>deferred.promise};
 }});
 try{
  const $=id=>window.document.getElementById(id),dialog=$('about');
  dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');
  $('about-open').click();await settle();$('about-close').click();$('about-open').click();await settle();
  assert.equal(pending.length,2,'each opening requests fresh metadata');
  const complete=(index,label)=>pending[index].resolve(stage==='fetch'?{ok:true,json:async()=>ages(label)}:ages(label));
  if(outcome==='newer failure')pending[1].reject(new Error('newer metadata unavailable'));else complete(1,'newer');
  await settle();
  const rows=$('data-ages').tBodies[0],notice=$('data-ages-notice');
  assert.match(rows.textContent,outcome==='newer failure'?/Data dates are not available/:/newer/);
  const expected={rows:rows.innerHTML,notice:notice.textContent,hidden:notice.hidden};
  if(outcome==='older failure')pending[0].reject(new Error('older metadata unavailable'));else complete(0,'older');
  await settle();
  assert.deepEqual({rows:rows.innerHTML,notice:notice.textContent,hidden:notice.hidden},expected,'obsolete work cannot replace the current rows, warning or failure');
 }finally{dom.window.close();}
});

// Execute the browser check's actual helper against the real app/JSDOM, and
// verify that its assertion rejects an injected stale render. Hosted CI runs
// the same helper with genuine Chromium/WebKit dialogs and browser profiles.
for(const corrupt of [false,true])test(`browser date-ordering checker ${corrupt?'rejects a stale render':'accepts current app behavior'}`,async()=>{
 const source=await readFile(new URL('../scripts/check-pwa-install-browser.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function checkDataDatesOrdering('),source.indexOf('async function offerNativePrompt('));
 const check=new Function('assert',body+'return checkDataDatesOrdering;')(assert);
 const {dom,window}=await start();
 try{
  const dialog=window.document.getElementById('about');dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');
  const evaluate=async(fn,arg)=>{
   const value=await window.eval('('+fn.toString()+')')(arg);
   if(corrupt&&arg?.index===0)window.document.getElementById('data-ages').tBodies[0].textContent='injected stale render';
   return structuredClone(value);
  };
  const page={evaluate,locator:selector=>({click:async()=>window.document.querySelector(selector).click()}),waitForFunction:async fn=>{
   for(let i=0;i<50;i++){if(await evaluate(fn))return;await new Promise(resolve=>setTimeout(resolve,0));}
   throw new Error('Browser helper condition did not settle');
  }};
  if(corrupt)await assert.rejects(check(page),/obsolete metadata cannot overwrite/);
  else assert.equal(await check(page),6);
 }finally{dom.window.close();}
});
