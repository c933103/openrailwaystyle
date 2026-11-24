import {flatCamera, fitFlatBounds} from './flat-camera.mjs';
import {compileFlatVectorQuery} from './flat-vector-query.mjs';
import {compileFlatFrame} from './flat-frame.mjs';
import {planFlatSourceTiles} from './flat-source-plan.mjs';
import {createFlatSourceLoader} from './flat-source-loader.mjs';
import {createFlatTileRequests} from './flat-tile-requests.mjs';

const tileLayer = layer => layer.type === 'raster' ||
  (['fill','line','circle'].includes(layer.type) && layer['source-layer'] != null &&
    layer.paint?.['fill-pattern'] == null && layer.paint?.['line-pattern'] == null);

export function mountFlatMap({mount, style, styleURL, protocols, requestedView, onNavigate, onStatus, interactiveLayer, onInspect}) {
  const document = mount.ownerDocument, window = document.defaultView;
  const canvas = document.createElement('canvas');
  canvas.className = 'atlas-flat-preview';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label','Canvas map preview. Drag or use the arrow keys to move.');
  Object.assign(canvas.style,{display:'block',width:'100%',height:'100%',touchAction:'none'});
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not start Canvas 2D.');
  const draw = compileFlatFrame(style.layers);
  const query = compileFlatVectorQuery(style.layers,{include:interactiveLayer});
  const loader = createFlatSourceLoader({protocols}), metadata = new Map();
  const lifetime = new AbortController(), signal = lifetime.signal;
  const pixelRatio = Math.max(1,Math.min(3,window.devicePixelRatio||1));
  let camera, frame = 0, drag, disposed = false, navigated = false;
  const queue = createFlatTileRequests({
    load:({revision,canonical,controller})=>loader.load(revision,canonical,{pixelRatio,controller}),
    dispose:tile=>tile.image?.close?.(),
    changed:schedule,
  });

  function schedule() {
    if (!disposed && !frame) frame=window.requestAnimationFrame(render);
  }
  function setCamera(next, navigate=false) {
    camera=next;
    mount.dataset.flatCenter=camera.center.join(',');
    if (navigate) {
      navigated=true;
      onNavigate({c:camera.center,z:camera.zoom,b:camera.bearing,p:0,g:false,t:false});
    }
    schedule();
  }
  function resize() {
    const width=Math.max(1,mount.clientWidth),height=Math.max(1,mount.clientHeight);
    if (camera?.width===width && camera.height===height) return;
    canvas.width=Math.round(width*pixelRatio); canvas.height=Math.round(height*pixelRatio);
    context.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
    setCamera(flatCamera({center:camera?.center??requestedView.center,zoom:camera?.zoom??requestedView.zoom,
      bearing:camera?.bearing??requestedView.bearing,width,height}));
  }
  function render() {
    frame=0;
    const active = new Set(style.layers.filter(layer => layer.layout?.visibility !== 'none' &&
      camera.zoom >= (layer.minzoom ?? -Infinity) && camera.zoom < (layer.maxzoom ?? Infinity) &&
      tileLayer(layer)).map(layer=>layer.source));
    for (const [id,entry] of metadata) {
      if (!active.has(id)) {entry.controller.abort(); metadata.delete(id);}
    }
    const plans=new Map(),errors=new Set();
    let resolvedTilesExpected=false;
    for (const id of active) {
      let entry=metadata.get(id);
      if (!entry) {
        const controller=new AbortController();
        entry={controller};
        metadata.set(id,entry);
        loader.resolve(style.sources[id]??{},{baseURL:styleURL,controller}).then(value=>{
          entry.value=value;
        },error=>{
          if (!controller.signal.aborted) entry.error=error;
        }).finally(()=>{if (!controller.signal.aborted) schedule();});
      }
      if (entry.error) {errors.add(id);continue;}
      if (!entry.value) continue;
      try {
        const tiles=planFlatSourceTiles(camera,entry.value);
        if (tiles.length) resolvedTilesExpected=true;
        plans.set(id,{revision:entry.value,tiles});
      } catch {errors.add(id);}
    }
    queue.update(plans);
    const tiles=queue.snapshot();
    for(const id of tiles.errors.keys()) errors.add(id);
    draw(context,camera,tiles.frame);
    const painting=[...tiles.frame.values()].some(items=>items.length);
    const loading=[...metadata.values()].some(entry=>!entry.value&&!entry.error) || resolvedTilesExpected&&!painting&&!errors.size;
    onStatus({errors:[...errors],painting,loading,clamped:Math.abs(requestedView.center[1])>85.05112878 && !navigated});
  }

  const listen=(type,fn,opts)=>canvas.addEventListener(type,fn,{...opts,signal});
  listen('pointerdown',e=>{
    if(e.button!==0 || drag) return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:camera,moved:false};
    canvas.setPointerCapture(e.pointerId);
  });
  listen('pointermove',e=>{
    if(e.pointerId!==drag?.id) return;
    const dx=drag.x-e.clientX,dy=drag.y-e.clientY;
    if(!drag.moved && Math.hypot(dx,dy)<3) return;
    drag.moved=true;
    setCamera(drag.start.panBy([dx,dy]));
  });
  function finishDrag(e,commit) {
    if(e.pointerId!==drag?.id) return;
    const start=drag.start,moved=drag.moved;
    drag=null;
    if(moved) setCamera(commit?camera:start,commit);
    else if(commit && onInspect) {
      const rect=canvas.getBoundingClientRect();
      const point=[e.clientX-rect.left,e.clientY-rect.top];
      const hits=query(camera,point,queue.snapshot().frame);
      if(hits.length) onInspect(hits,camera.unproject(point));
    }
  }
  listen('pointerup',e=>finishDrag(e,true));
  listen('pointercancel',e=>finishDrag(e,false));
  listen('lostpointercapture',e=>finishDrag(e,false));
  listen('wheel',e=>{
    e.preventDefault();
    if(drag || !e.deltaY) return;
    const zoom=Math.max(-0.5,Math.min(22,camera.zoom-Math.sign(e.deltaY)*0.25));
    if(zoom===camera.zoom) return;
    const rect=canvas.getBoundingClientRect();
    setCamera(camera.zoomAt(zoom,[e.clientX-rect.left,e.clientY-rect.top]),true);
  },{passive:false});
  listen('keydown',e=>{
    const pan={ArrowLeft:[-60,0],ArrowRight:[60,0],ArrowUp:[0,-60],ArrowDown:[0,60]}[e.key];
    if (!pan || drag || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    setCamera(camera.panBy(pan),true);
  });
  mount.replaceChildren(canvas);
  resize();
  const observer=new window.ResizeObserver(resize);
  observer.observe(mount);
  const close=()=>{
    if(disposed) return;
    disposed=true; lifetime.abort(); observer.disconnect();
    if(frame) window.cancelAnimationFrame(frame);
    for(const entry of metadata.values()) entry.controller.abort();
    queue.close();canvas.remove();
  };
  window.addEventListener('pagehide',event=>{if(!event.persisted) close();},{signal});
  const moveTo=({center,zoom,bounds})=>{
    if(disposed) return;
    const next=bounds?fitFlatBounds(camera,bounds):null;
    setCamera(next??flatCamera({center,zoom,width:camera.width,height:camera.height,bearing:camera.bearing}),true);
  };
  return {close,moveTo};
}
