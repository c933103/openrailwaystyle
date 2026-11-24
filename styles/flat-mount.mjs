import {flatCamera, flatScaleBar, fitFlatBounds} from './flat-camera.mjs';
import {compileFlatVectorQuery} from './flat-vector-query.mjs';
import {compileFlatFrame} from './flat-frame.mjs';
import {planFlatSourceTiles} from './flat-source-plan.mjs';
import {createFlatSourceLoader} from './flat-source-loader.mjs';
import {createFlatTileRequests} from './flat-tile-requests.mjs';
import {createFlatGesture} from './flat-gesture.mjs';
import {flatTextLabel} from './flat-labels.mjs';
import {flatSourcePoints} from './flat-source-points.mjs';
import {contextIcon} from './context.mjs';
import {flatMeasureAdapter} from './flat-measure.mjs';
import {flatDrawingAdapter, drawingLines} from './flat-drawing.mjs';

const tileLayer = layer => layer.type === 'raster' || flatTextLabel(layer) ||
  (['fill','line','circle'].includes(layer.type) && layer['source-layer'] != null &&
    layer.paint?.['fill-pattern'] == null && layer.paint?.['line-pattern'] == null);

export function mountFlatMap({mount, style, styleURL, protocols, requestedView, onNavigate, onStatus, interactiveLayer, onInspect, onDrawingProfile, onReadout, onCamera}) {
  const document = mount.ownerDocument, window = document.defaultView;
  const canvas = document.createElement('canvas');
  canvas.className = 'atlas-flat-preview';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label','Canvas map preview. Drag or use the arrow keys to move; pinch to zoom.');
  Object.assign(canvas.style,{display:'block',width:'100%',height:'100%',touchAction:'none'});
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not start Canvas 2D.');
  let draw = compileFlatFrame(style.layers);
  let query = compileFlatVectorQuery(style.layers,{include:interactiveLayer});
  const loader = createFlatSourceLoader({protocols}), metadata = new Map();
  const lifetime = new AbortController(), signal = lifetime.signal;
  const pixelRatio = Math.max(1,Math.min(3,window.devicePixelRatio||1));
  let camera, frame = 0, disposed = false, navigated = false, readoutPoint = null;
  let sourceFrame=new Map(), paintedSymbols=[], measure=null, drawing=null, toolDrag=null;
  const measureOverlay=flatMeasureAdapter(canvas,schedule);
  const drawingOverlay=flatDrawingAdapter(canvas,schedule);
  const icons=new Map();
  const getIcon=id=>{
    if(!icons.has(id)){
      const image=contextIcon(id,document);
      let sprite=null;
      if(image){
        sprite=document.createElement('canvas');
        sprite.width=image.width;sprite.height=image.height;
        sprite.getContext('2d').putImageData(image,0,0);
      }
      icons.set(id,sprite);
    }
    return icons.get(id);
  };
  const queue = createFlatTileRequests({
    load:({revision,canonical,controller})=>loader.load(revision,canonical,{pixelRatio,controller}),
    dispose:tile=>tile.image?.close?.(),
    changed:schedule,
  });

  function schedule() {
    if (!disposed && !frame) frame=window.requestAnimationFrame(render);
  }
  function updateReadout() {
    if (camera && onReadout) onReadout(readoutPoint ? camera.unproject(readoutPoint) : camera.center, camera.zoom);
  }
  function setCamera(next, navigate=false) {
    camera=next;
    measureOverlay.setCamera(next);drawingOverlay.setCamera(next);
    mount.dataset.flatCenter=camera.center.join(',');
    onCamera?.();
    updateReadout();
    if (navigate) {
      navigated=true;
      onNavigate({c:camera.center,z:camera.zoom,b:camera.bearing,p:0,g:false,t:false});
    }
    schedule();
  }
  function resize() {
    const width=Math.max(1,mount.clientWidth),height=Math.max(1,mount.clientHeight);
    if (camera?.width===width && camera.height===height) return;
    gesture.cancel();
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
    sourceFrame=new Map([...active].map(id=>{
      const entry=metadata.get(id), count=plans.get(id)?.tiles.length??0;
      const drawn=tiles.frame.get(id)??[];
      const seen=new Set(drawn.map(({tile:{x,y,z}})=>z+'/'+x+'/'+y)).size;
      return [id,{tiles:drawn,state:errors.has(id)||entry?.error?'failed':
        tiles.errors.has(id)?'failed':!entry?.value||seen<count?'loading':'ready'}];
    }));
    for(const id of tiles.errors.keys()) errors.add(id);
    paintedSymbols=[];
    draw(context,camera,tiles.frame,{getIcon,onSymbol:({id,source,sourceLayer},label,bounds)=>{
      if(!interactiveLayer?.(id))return;
      const [rawLng,lat]=camera.unproject([label.px,label.py]);
      const lng=((rawLng+180)%360+360)%360-180;
      const feature=label.feature;
      paintedSymbols.push({bounds,px:label.px,py:label.py,hit:{
        type:'Feature',id:feature.id,properties:feature.properties,source,sourceLayer,
        layer:{id,type:'symbol',source},geometry:{type:'Point',coordinates:[lng,lat]},
      }});
    }});
    drawingOverlay.draw(context);
    measureOverlay.draw(context,camera);
    const painting=[...tiles.frame.values()].some(items=>items.length);
    const loading=[...metadata.values()].some(entry=>!entry.value&&!entry.error) || resolvedTilesExpected&&!painting&&!errors.size;
    onStatus({errors:[...errors],painting,loading,clamped:Math.abs(requestedView.center[1])>85.05112878 && !navigated});
  }

  const listen=(type,fn,opts)=>canvas.addEventListener(type,fn,{...opts,signal});
  const localPoint=e=>{
    const rect=canvas.getBoundingClientRect();
    return [e.clientX-rect.left,e.clientY-rect.top];
  };
  const activeTool=()=>measure?.active?measure:drawing?.active&&!drawing.paused?drawing:null;
  const overlayFor=tool=>tool===measure?measureOverlay:drawingOverlay;
  function mapPosition(point,tool) {
    const [raw,lat]=camera.unproject(point);
    return {lng:tool===drawing?((raw+180)%360+360)%360-180:raw,lat};
  }
  const screenPoint=([x,y])=>({x,y});
  const clickTool=(tool,point)=>tool.click(mapPosition(point,tool),screenPoint(point));
  const gesture=createFlatGesture({
    preview:setCamera,
    commit:next=>setCamera(next,true),
    inspect:point=>{
      const tool=activeTool();
      if(tool){clickTool(tool,point);return;}
      const [x,y]=point;
      if(drawing && !drawing.active && onDrawingProfile){
        const hit=drawingOverlay.map.queryRenderedFeatures([[x-5,y-5],[x+5,y+5]],{layers:drawingLines})
          .find(f=>f.geometry.type==='LineString');
        const line=hit&&drawing.features.find(f=>f.id===hit.properties.drawing);
        if(line){onDrawingProfile(line);return;}
      }
      if(!onInspect)return;
      const hits=query(camera,point,queue.snapshot().frame);
      for(const symbol of paintedSymbols){
        if(symbol.bounds.some(b=>x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom))
          hits.push({...symbol.hit,distance:Math.hypot(x-symbol.px,y-symbol.py)});
      }
      if(hits.length)onInspect(hits,camera.unproject(point));
    },
  });
  const toolEvent=(tool,e,mouse,touch)=>overlayFor(tool).emit(e.pointerType==='touch'?touch:mouse,localPoint(e),e);
  listen('pointerdown',e=>{
    if(e.button!==0||toolDrag)return;
    const tool=activeTool();
    if(tool&&tool.mode!=='erase'&&!gesture.active&&toolEvent(tool,e,'mousedown','touchstart')){
      toolDrag={id:e.pointerId,tool};
      canvas.setPointerCapture(e.pointerId);return;
    }
    if(gesture.start(e.pointerId,e.pointerType,localPoint(e),camera))canvas.setPointerCapture(e.pointerId);
  });
  listen('pointerleave',()=>{readoutPoint=null;updateReadout();});
  listen('pointermove',e=>{
    if(e.pointerType==='mouse'){readoutPoint=localPoint(e);updateReadout();}
    if(e.pointerId===toolDrag?.id){
      if(toolDrag.tool===activeTool())toolEvent(toolDrag.tool,e,'mousemove','touchmove');
      return;
    }
    gesture.move(e.pointerId,localPoint(e));
    const tool=activeTool();
    if(tool&&!gesture.active&&e.pointerType==='mouse'&&!e.buttons) {
      if(tool===drawing)toolEvent(tool,e,'mousemove','touchmove');
      tool.move(mapPosition(localPoint(e),tool));
    }
  });
  function endPointer(e,cancel=false){
    if(e.pointerId===toolDrag?.id){
      const {tool}=toolDrag;toolDrag=null;
      toolEvent(tool,e,'mouseup',cancel?'touchcancel':'touchend');
      if(!cancel&&tool===activeTool())clickTool(tool,localPoint(e));
    }else if(cancel)gesture.cancel(e.pointerId);
    else gesture.end(e.pointerId,localPoint(e));
  }
  listen('pointerup',e=>endPointer(e));
  listen('pointercancel',e=>endPointer(e,true));
  listen('lostpointercapture',e=>endPointer(e,true));
  listen('dblclick',e=>{
    const tool=activeTool();
    if(tool===measure&&tool?.mode==='distance'){e.preventDefault();tool.end();}
    if(tool===drawing&&tool?.multiPoint){e.preventDefault();tool.finish();}
  });
  listen('wheel',e=>{
    e.preventDefault();
    if(gesture.active || toolDrag || !e.deltaY) return;
    const zoom=Math.max(-0.5,Math.min(22,camera.zoom-Math.sign(e.deltaY)*0.25));
    if(zoom===camera.zoom) return;
    const rect=canvas.getBoundingClientRect();
    setCamera(camera.zoomAt(zoom,[e.clientX-rect.left,e.clientY-rect.top]),true);
  },{passive:false});
  listen('keydown',e=>{
    const pan={ArrowLeft:[-60,0],ArrowRight:[60,0],ArrowUp:[0,-60],ArrowDown:[0,60]}[e.key];
    if (!pan || gesture.active || toolDrag || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    setCamera(camera.panBy(pan),true);
  });
  mount.replaceChildren(canvas);
  resize();
  const observer=new window.ResizeObserver(resize);
  observer.observe(mount);
  const close=()=>{
    if(disposed) return;
    disposed=true;
    if(measure?.active)measure.setMode(measure.mode);
    lifetime.abort(); observer.disconnect();
    if(frame) window.cancelAnimationFrame(frame);
    for(const entry of metadata.values()) entry.controller.abort();
    queue.close();canvas.remove();
  };
  window.addEventListener('pagehide',event=>{if(!event.persisted) close();},{signal});
  const moveTo=({center,zoom,bounds})=>{
    if(disposed) return;
    gesture.cancel();
    const next=bounds?fitFlatBounds(camera,bounds):null;
    setCamera(next??flatCamera({center,zoom,width:camera.width,height:camera.height,bearing:camera.bearing}),true);
  };
  const setStyle=next=>{
    if(disposed) return;
    const nextDraw=compileFlatFrame(next.layers);
    const nextQuery=compileFlatVectorQuery(next.layers,{include:interactiveLayer});
    for(const [id,entry] of metadata) {
      if(JSON.stringify(style.sources[id])!==JSON.stringify(next.sources[id])){
        entry.controller.abort();
        metadata.delete(id);
      }
    }
    style=next;draw=nextDraw;query=nextQuery;
    // Install the new plan before a tap can inspect old pixels/data.
    if(frame)window.cancelAnimationFrame(frame);
    render();
  };
  const readSourcePoints=(source,sourceLayers,filter)=>{
    const entry=sourceFrame.get(source);
    return {state:entry?.state??'inactive',features:flatSourcePoints(entry?.tiles??[],sourceLayers,{filter,zoom:camera.zoom})};
  };
  return {close,moveTo,setStyle,readSourcePoints,measurementMap:measureOverlay.map,drawingMap:drawingOverlay.map,
    connectDrawing:tool=>{drawing=tool;schedule();},
    connectMeasure:tool=>{measure=tool;schedule();},setProfileMarker:measureOverlay.marker,getZoom:()=>camera.zoom,
    getCenter:()=>camera.center, scaleBar:units=>flatScaleBar(camera,units),getLayers:()=>style.layers};
}
