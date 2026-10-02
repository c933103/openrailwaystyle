// Share downloads/counts while at least one visible tile needs them. Only one
// worker message owns private copies at a time; cancelled work is discarded.
export function createTrackCounter(load, createWorker, {maxResults=64}={}) {
 const pending=new Map(),results=new Map(),queue=[];
 let worker,active,nextId=0,scheduled=false;
 function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;pump();});}
 const aborted=()=>new DOMException('Track count cancelled','AbortError');
 function finish(job,error,result){
  if(job.done)return;job.done=true;job.signal.removeEventListener('abort',job.cancel);
  if(active===job)active=undefined;else {const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);}
  error?job.reject(error):job.resolve(result);schedule();
 }
 function pump(){
  if(active||!queue.length)return;
  const job=active=queue.shift();
  try{
   if(!worker){
    const current=worker=createWorker();
    current.onmessage=({data:{id,result,error}})=>{if(worker!==current||active?.id!==id)return;finish(active,error?new Error(error):null,result);};
    current.onerror=event=>{if(worker!==current)return;worker=undefined;current.terminate();if(active)finish(active,new Error(event.message||'Track worker failed'));};
   }
   const copy=list=>list.filter(Boolean).map(t=>({...t,data:t.data.slice(0)}));
   const {tiles,areas,stations,y}=job.input;
   const message={id:job.id,tiles:copy(tiles),areas:copy(areas),stations:copy(stations),y};
   worker.postMessage(message,[...message.tiles,...message.areas,...message.stations].map(t=>t.data));
   // Avoid retaining the input buffers in the active queue entry after transfer.
   job.input=undefined;
  }catch(error){if(worker){const current=worker;worker=undefined;current.terminate();}finish(job,error);}
 }
 function count(input,signal){
  return new Promise((resolve,reject)=>{
   if(signal.aborted){reject(aborted());return;}
   const job={id:nextId++,input,signal,resolve,reject};
   job.cancel=()=>{
    if(active===job&&worker){const current=worker;worker=undefined;current.terminate();}
    job.input=undefined;finish(job,aborted());
   };
   signal.addEventListener('abort',job.cancel,{once:true});queue.push(job);schedule();
  });
 }
 return function request(x,y,signal){
  if(signal.aborted)return Promise.reject(aborted());
  const key=`${x}/${y}`;
  if(results.has(key)){const result=results.get(key);results.delete(key);results.set(key,result);return Promise.resolve(result);}
  let entry=pending.get(key);
  if(!entry){
   entry={controller:new AbortController(),users:0};pending.set(key,entry);
   const current=entry;
   entry.promise=Promise.resolve().then(()=>{if(current.controller.signal.aborted)throw aborted();return load(x,y,current.controller.signal);}).then(input=>count(input,current.controller.signal)).then(result=>{
    if(current.controller.signal.aborted)throw aborted();
    results.set(key,result);while(results.size>maxResults)results.delete(results.keys().next().value);
    return result;
   }).finally(()=>{if(pending.get(key)===current)pending.delete(key);});
  }
  const current=entry;current.users++;
  return new Promise((resolve,reject)=>{
   let done=false;
   const complete=(error,result)=>{
    if(done)return;done=true;signal.removeEventListener('abort',cancel);current.users--;
    if(!current.users&&pending.get(key)===current){pending.delete(key);current.controller.abort();}
    error?reject(error):resolve(result);
   };
   const cancel=()=>complete(aborted());
   signal.addEventListener('abort',cancel,{once:true});
   current.promise.then(result=>complete(null,result),error=>complete(error));
  });
 };
}
