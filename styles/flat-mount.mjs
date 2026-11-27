import {isNeutralRailReference} from './railway-visibility.mjs';
import {flatRailReferenceClip} from './flat-rail-reference.mjs';
import {FLAT_MIN_ZOOM, FLAT_MAX_ZOOM, flatCamera, flatScaleBar, fitFlatBounds, flatBoxRect, fitFlatScreenBox} from './flat-camera.mjs';
import {compileFlatVectorQuery} from './flat-vector-query.mjs';
import {compileFlatFrame} from './flat-frame.mjs';
import {flatReliefPaint,flatReliefPixels} from './flat-relief.mjs';
import {flatFailure,flatRetryDue} from './flat-recovery.mjs';
import {planFlatSourceTiles} from './flat-source-plan.mjs';
import {createFlatSourceLoader} from './flat-source-loader.mjs';
import {createFlatTileRequests} from './flat-tile-requests.mjs';
import {flatStationFallbackLayer,flatStationFallbackMask,compileFlatCuratedStations,compileFlatPointCollection} from './flat-station-fallback.mjs';
import {createFlatGesture} from './flat-gesture.mjs';
import {flatTextLabel} from './flat-labels.mjs';
import {compileFlatLocalGeometry} from './flat-local-geometry.mjs';
import {flatSourcePoints} from './flat-source-points.mjs';
import {compileFlatGeometryStyle} from './flat-style.mjs';
import {flatPlatformIntersectsViewport,flatPolygonGeometry} from './flat-vector.mjs';
import {PLATFORM_GEOMETRY_LIMITS,PLATFORM_UPDATE_LIMITS,tileToLngLat} from './platform-length.mjs';
import {contextIcon} from './context.mjs';
import {flatMeasureAdapter} from './flat-measure.mjs';
import {paintFlatHeading} from './flat-location.mjs';
import {flatDrawingAdapter, drawingLines} from './flat-drawing.mjs';

const tileLayer = layer => layer.type === 'raster' || flatReliefPaint(layer) || flatTextLabel(layer) ||
  (['fill','line','circle'].includes(layer.type) && layer['source-layer'] != null &&
    layer.paint?.['fill-pattern'] == null && layer.paint?.['line-pattern'] == null);

export function mountFlatMap({mount, style, styleURL, protocols, requestedView, initialDetail=0, onNavigate, onStatus, interactiveLayer, onInspect, onDrawingProfile, onReadout, onCamera, onCredits, imageryCredit, curatedStationData, onCuratedOverview, stationPaint, railTrackLayer, legendLayers, onLegendFrame, onPlatformFrame, getMongolianFont, getCjkFont, readDem, pointSources={}, shapeSources=[]}) {
  const document = mount.ownerDocument, window = document.defaultView;
  const canvas = document.createElement('canvas');
  canvas.className = 'atlas-flat-preview';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label','Canvas map preview. Drag or use the arrow keys to move. Pinch or press plus and minus to zoom. Shift-drag to zoom to an area. Right-drag, Control-drag, or press Shift with Left or Right to rotate.');
  Object.assign(canvas.style,{display:'block',width:'100%',height:'100%',touchAction:'none'});
  const boxOverlay=document.createElement('div');
  boxOverlay.className='atlas-flat-box-zoom';
  boxOverlay.hidden=true;
  boxOverlay.setAttribute('aria-hidden','true');
  Object.assign(boxOverlay.style,{position:'absolute',pointerEvents:'none',boxSizing:'border-box',
    background:'#3399ff33',border:'2px solid #1773bd',boxShadow:'0 0 0 1px white'});
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not start Canvas 2D.');
  const localData=new Map([...Object.entries(pointSources),...shapeSources.map(id=>[id,null])].map(([id,zoom])=>{
    const entry={shapes:zoom==null};
    entry.source={
      setData(collection){
        entry.draw=entry.shapes?compileFlatLocalGeometry(collection,id):compileFlatPointCollection(collection,id,zoom);
        entry.failed=false;schedule();
      },
      setError(){entry.failed=true;schedule();},
    };
    return [id,entry];
  }));
  const frameLayers=style=>style.layers.map(layer=>layer.source==='stationMajor'
    ?{...layer,...(layer.id==='station-curated-fallback-dots'?{maxzoom:8}:{}),'source-layer':'curated-stations'}
    :style.sources[layer.source]?.type==='geojson'&&localData.has(layer.source)&&
       (layer.type==='circle'||localData.get(layer.source).shapes&&['fill','line','symbol'].includes(layer.type))
      ?{...layer,'source-layer':layer.source}:layer);
  const reliefFor=layers=>new Map(layers.flatMap(layer=>{
    const paint=flatReliefPaint(layer);return paint?[[layer.source,paint]]:[];
  }));
  let compiledLayers=frameLayers(style), reliefBySource=reliefFor(compiledLayers);
  let draw=compileFlatFrame(compiledLayers);
  const platformLayersFor=layers=>new Map(layers.filter(l=>['platform-edges','platform-areas','platform-outlines','platform-points'].includes(l.id))
    .map(l=>[l.id,{type:l.type,...compileFlatGeometryStyle(l)}]));
  let platformLayers=platformLayersFor(compiledLayers);
  const includeFill=layer=>layer.id==='platform-areas'||localData.get(layer.source)?.shapes===true;
  let query=compileFlatVectorQuery(compiledLayers,{include:interactiveLayer,includeFill});
  const curatedFallback=compileFlatCuratedStations(curatedStationData);
  let curatedOverview=compileFlatPointCollection(curatedStationData,'curated-stations',3);
  const setCuratedOverview=collection=>{
    curatedOverview=compileFlatPointCollection(collection,'curated-stations',3);
    schedule();
  };
  let visibleFrame=new Map();
  const loader = createFlatSourceLoader({protocols}), metadata = new Map();
  const lifetime = new AbortController(), signal = lifetime.signal;
  const pixelRatio = Math.max(1,Math.min(3,window.devicePixelRatio||1));
  let wakeTimer=null, wakeDue=Infinity, recoveryWake=null;
  let tileDetail=initialDetail;
  let camera, frame = 0, disposed = false, navigated = false, readoutPoint = null, locationFix = null;
  let sourceFrame=new Map(), paintedSymbols=[], measure=null, drawing=null, toolDrag=null, boxZoom=null;
  let mouseRotation=null, rightContext=false;
  let stationFallbackMask=()=>false;
  const allowFeature=(id,feature,tile)=>!flatStationFallbackLayer(id)||stationFallbackMask(feature,tile);
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
    async load({source,revision,canonical,controller}) {
      if (revision.type!=='raster-dem') return loader.load(revision,canonical,{pixelRatio,controller,rasterCredit:imageryCredit});
      const paint=reliefBySource.get(source);
      if (!paint || !readDem) throw new Error('Canvas elevation reader is not available');
      const heights=await readDem(canonical,controller);
      controller.signal.throwIfAborted();
      const {width,height,pixels}=flatReliefPixels(heights,canonical,paint);
      const image=document.createElement('canvas');image.width=width;image.height=height;
      image.getContext('2d').putImageData(new window.ImageData(pixels,width,height),0,0);
      return {image};
    },
    dispose:tile=>tile.image?.close?.(),
    changed:schedule,
  });

  function schedule() {
    if (!disposed && !frame) frame=window.requestAnimationFrame(render);
  }
  function updateReadout() {
    if (camera && onReadout) onReadout(readoutPoint ? camera.unproject(readoutPoint) : camera.center, camera.zoom);
  }
  function setCamera(next, navigate=false, reason='manual') {
    camera=next;
    measureOverlay.setCamera(next);drawingOverlay.setCamera(next);
    mount.dataset.flatCenter=camera.center.join(',');
    onCamera?.(camera);
    updateReadout();
    if (navigate) {
      navigated=true;
      onNavigate({c:camera.center,z:camera.zoom,b:camera.bearing,p:0,g:false,t:false},reason);
    }
    schedule();
  }
  function resize() {
    const width=Math.max(1,mount.clientWidth),height=Math.max(1,mount.clientHeight);
    if (camera?.width===width && camera.height===height) return;
    gesture.cancel();
    cancelBoxZoom();
    cancelMouseRotation();
    canvas.width=Math.round(width*pixelRatio); canvas.height=Math.round(height*pixelRatio);
    context.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
    setCamera(flatCamera({center:camera?.center??requestedView.center,zoom:camera?.zoom??requestedView.zoom,
      bearing:camera?.bearing??requestedView.bearing,width,height}));
  }
  const canRetry=()=>!disposed&&document.visibilityState!=='hidden'&&window.navigator.onLine!==false;
  function clearWake() {
    if(wakeTimer!==null)window.clearTimeout(wakeTimer);
    wakeTimer=null;wakeDue=Infinity;
  }
  function armRecovery() {
    if(!canRetry()){clearWake();return;}
    let due=queue.nextRetry();
    for(const entry of metadata.values())if(!entry.pending&&entry.failure)due=Math.min(due,entry.failure.due);
    if(due===wakeDue)return;
    clearWake();
    if(!Number.isFinite(due))return;
    wakeDue=due;
    wakeTimer=window.setTimeout(()=>{clearWake();recover(false);},Math.min(2147483647,Math.max(0,due-Date.now())));
  }
  function startSource(id,previous) {
    const controller=new AbortController(), retries=previous?previous.retries+1:0;
    const entry={controller,retries,pending:true,failure:previous?.failure,error:previous?.failure?.error};
    metadata.set(id,entry);
    loader.resolve(style.sources[id]??{},{baseURL:styleURL,controller}).then(value=>{
      entry.value=value;delete entry.error;delete entry.failure;
    },error=>{
      if(!controller.signal.aborted){
        entry.failure=flatFailure(error,retries,Date.now());entry.error=error;
      }
    }).finally(()=>{entry.pending=false;if(!controller.signal.aborted)schedule();});
    return entry;
  }
  function recover(reconnect) {
    if(!canRetry()){clearWake();return;}
    recoveryWake=Boolean(recoveryWake||reconnect);
    schedule();
  }
  function render() {
    frame=0;
    // Reconcile the current camera/settings before dispatching a recovery
    // wake, so a concurrent pan or disabled layer cannot retry an old tile.
    const retry=canRetry()?recoveryWake:null;
    recoveryWake=null;
    const layers=compiledLayers.filter(layer=>layer.layout?.visibility!=='none'&&
      camera.zoom>=(layer.minzoom??-Infinity)&&camera.zoom<(layer.maxzoom??Infinity)&&tileLayer(layer));
    const stationSource=camera.zoom>=8?'stations':camera.zoom>=7?'stationMed':null;
    const fallbackLayers=layers.some(layer=>flatStationFallbackLayer(layer.id));
    const checkStations=stationSource&&fallbackLayers&&layers.some(layer=>layer.source===stationSource);
    const metadataFailed=checkStations&&Boolean(metadata.get(stationSource)?.error);
    const fallbackLikely=checkStations&&(metadataFailed||queue.hasFailure(stationSource));
    const railLayer=railTrackLayer?.(camera.zoom);
    const railSource=layers.find(layer=>layer.id===railLayer)?.source;
    const railError=railSource&&Boolean(metadata.get(railSource)?.error);
    const railReferenceLikely=railSource&&(railError||queue.hasFailure(railSource));
    const active=new Set(layers.filter(layer=>layer.source!=='stationMajor'&&
      (!flatStationFallbackLayer(layer.id)||fallbackLikely)&&
      (!isNeutralRailReference(layer)||railReferenceLikely)).map(layer=>layer.source));
    for (const [id,entry] of metadata) {
      if (!active.has(id)) {entry.controller.abort(); metadata.delete(id);}
    }
    const plans=new Map(),errors=new Set();
    let resolvedTilesExpected=false;
    for (const id of active) {
      if(localData.has(id)){if(localData.get(id).failed)errors.add(id);continue;}
      let entry=metadata.get(id)??startSource(id);
      if(retry!==null&&!entry.pending&&flatRetryDue(entry.failure,Date.now(),retry))entry=startSource(id,entry);
      if (entry.error) {errors.add(id);continue;}
      if (!entry.value) continue;
      try {
        const tiles=planFlatSourceTiles(camera,entry.value,512,tileDetail);
        if (tiles.length) resolvedTilesExpected=true;
        plans.set(id,{revision:entry.value,tiles});
      } catch {errors.add(id);}
    }
    queue.update(plans);
    if(retry!==null)queue.retryFailed(retry);
    const tiles=queue.snapshot(),failedTiles=checkStations?tiles.errors.get(stationSource):null;
    stationFallbackMask=flatStationFallbackMask(checkStations?{metadataFailed,tiles:failedTiles??[]}: {});
    const overview=layers.some(layer=>layer.source==='stationMajor'&&!flatStationFallbackLayer(layer.id));
    const curated=overview ? curatedOverview(camera)
      : stationSource==='stationMed'&&checkStations&&(metadataFailed||failedTiles?.length)
        ? curatedFallback(camera):[];
    if(curated.length)tiles.frame.set('stationMajor',curated);
    if(overview && layers.some(layer=>layer.source==='stationMajor'&&layer.type==='symbol'))onCuratedOverview?.(camera);
    visibleFrame=tiles.frame;
    // Compute labels for the current zoom before painting local sources, so a
    // cached length cannot flash in a frame below its display threshold.
    onPlatformFrame?.();
    for(const [id,entry] of localData)if(active.has(id)&&entry.draw)tiles.frame.set(id,entry.draw(camera));
    sourceFrame=new Map([...active].map(id=>{
      const entry=metadata.get(id), count=plans.get(id)?.tiles.length??0;
      const point=localData.get(id);
      if(point)return [id,{tiles:tiles.frame.get(id)??[],state:point.failed?'failed':point.draw?'ready':'loading'}];
      const drawn=tiles.frame.get(id)??[];
      const seen=new Set(drawn.map(({tile:{x,y,z}})=>z+'/'+x+'/'+y)).size;
      return [id,{tiles:drawn,state:errors.has(id)||entry?.error?'failed':
        tiles.errors.has(id)?'failed':!entry?.value||seen<count?'loading':'ready'}];
    }));
    if(curated.length)sourceFrame.set('stationMajor',{tiles:curated,state:'ready'});
    for(const id of tiles.errors.keys()) errors.add(id);
    paintedSymbols=[];
    const railClip=flatRailReferenceClip(camera,{metadataFailed:railError,failed:tiles.errors.get(railSource),planned:plans.get(railSource)?.tiles});
    const targets=legendLayers?.(), legendFeatures=[];
    const rendered=draw(context,camera,tiles.frame,{getIcon,getMongolianFont,getCjkFont,legendLayers:targets,stationPaint,
      onLegendFeature:targets?.size?properties=>legendFeatures.push({properties}):undefined,allowFeature:fallbackLayers?allowFeature:undefined,
      layerClip:id=>isNeutralRailReference({id})?railClip:null,onSymbol:({id,source,sourceLayer},label,bounds)=>{
      if(!interactiveLayer?.(id))return;
      const [rawLng,lat]=camera.unproject([label.px,label.py]);
      const lng=((rawLng+180)%360+360)%360-180;
      const feature=label.feature;
      paintedSymbols.push({bounds,px:label.px,py:label.py,hit:{
        type:'Feature',id:feature.id,properties:feature.properties,source,sourceLayer,
        layer:{id,type:'symbol',source},geometry:{type:'Point',coordinates:[lng,lat]},
      }});
    }});
    onLegendFrame?.(legendFeatures);
    drawingOverlay.draw(context);
    measureOverlay.draw(context,camera);
    if(locationFix){
      const [x,y]=camera.project(locationFix.coordinates);
      const latitude=Math.min(85,Math.abs(locationFix.coordinates[1]));
      const radius=locationFix.accuracy*512*2**camera.zoom/(40075017*Math.cos(latitude*Math.PI/180));
      context.save();
      if(Number.isFinite(radius)&&radius>7){
        context.fillStyle='#1576e522';
        context.strokeStyle='#1576e577';
        context.beginPath();context.arc(x,y,Math.min(radius,1e7),0,2*Math.PI);
        context.fill();context.stroke();
      }
      context.fillStyle='#1576e5';context.strokeStyle='#fff';context.lineWidth=2;
      paintFlatHeading(context,x,y,locationFix.heading,camera.bearing);
      context.beginPath();context.arc(x,y,6,0,2*Math.PI);context.fill();context.stroke();
      context.restore();
    }
    if(onCredits){
      const credits=[];
      for(const [id,items] of tiles.frame){
        if(!items.length)continue;
        if(id==='satellite'){
          const delivered=items.map(item=>item.credit);
          if(delivered.every(Boolean)){credits.push(...delivered);continue;}
        }
        credits.push(metadata.get(id)?.value?.attribution||style.sources[id]?.attribution);
      }
      onCredits(credits);
    }
    const painting=[...tiles.frame.values()].some(items=>items.length);
    const loading=[...metadata.values()].some(entry=>!entry.value&&!entry.error) ||
      [...localData].some(([id,entry])=>active.has(id)&&!entry.draw&&!entry.failed) ||
      resolvedTilesExpected&&!painting&&!errors.size;
    const railFallback=layers.some(layer=>isNeutralRailReference(layer)&&(rendered.layerDraws.get(layer.id)??0)>0);
    armRecovery();
    onStatus({errors:[...errors],painting,loading,railFallback,clamped:Math.abs(requestedView.center[1])>85.05112878 && !navigated});
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
  const inspectionHits=point=>{
    const [x,y]=point;
    if(x<0||x>camera.width||y<0||y>camera.height)return [];
    const hits=query(camera,point,visibleFrame,allowFeature);
    for(const symbol of paintedSymbols){
      if(symbol.bounds.some(b=>x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom))
        hits.push({...symbol.hit,distance:Math.hypot(x-symbol.px,y-symbol.py)});
    }
    return hits;
  };
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
      const hits=inspectionHits(point);
      if(hits.length)onInspect(hits,camera.unproject(point));
    },
  });
  const toolEvent=(tool,e,mouse,touch)=>overlayFor(tool).emit(e.pointerType==='touch'?touch:mouse,localPoint(e),e);
  function cancelBoxZoom() {
    if(!boxZoom)return;
    const {id}=boxZoom;
    boxZoom=null;
    boxOverlay.hidden=true;
    if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
  }
  function cancelMouseRotation() {
    if(!mouseRotation)return;
    const {id,initial,turned}=mouseRotation;
    mouseRotation=null;
    if(turned)setCamera(initial);
    if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
  }
  function turnMouse(e) {
    const rotation=mouseRotation;
    const dx=localPoint(e)[0]-rotation.x;
    if(!rotation.turned&&Math.abs(dx)<4)return;
    rotation.turned=true;
    const angle=rotation.initial.bearing-dx*.8;
    const bearing=((angle+180)%360+360)%360-180;
    setCamera(flatCamera({...rotation.initial,bearing}));
  }
  // Some platforms emit the native menu on button-down, others on button-up.
  // Suppress it for this right gesture only; replay a stationary click below.
  listen('contextmenu',e=>{
    if(e.isTrusted&&e.button===2&&rightContext){e.preventDefault();e.stopPropagation();}
  });
  listen('pointerdown',e=>{
    if(toolDrag||boxZoom||mouseRotation)return;
    rightContext=false;
    const tool=activeTool();
    if(!tool&&!gesture.active&&e.pointerType==='mouse'&&!e.altKey&&!e.shiftKey&&!e.metaKey&&
        (e.button===2||e.button===0&&e.ctrlKey)){
      mouseRotation={id:e.pointerId,x:localPoint(e)[0],y:localPoint(e)[1],initial:camera,
        right:e.button===2,turned:false,moved:false};
      rightContext=mouseRotation.right;
      e.preventDefault();
      e.stopPropagation();
      canvas.focus({preventScroll:true});
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if(e.button!==0)return;
    if(!tool&&!gesture.active&&e.pointerType==='mouse'&&e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey){
      boxZoom={id:e.pointerId,start:localPoint(e),camera};
      canvas.focus({preventScroll:true});
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if(tool&&tool.mode!=='erase'&&!gesture.active&&toolEvent(tool,e,'mousedown','touchstart')){
      toolDrag={id:e.pointerId,tool};
      canvas.setPointerCapture(e.pointerId);return;
    }
    if(gesture.start(e.pointerId,e.pointerType,localPoint(e),camera))canvas.setPointerCapture(e.pointerId);
  });
  listen('pointerleave',()=>{readoutPoint=null;updateReadout();});
  listen('pointermove',e=>{
    if(e.pointerType==='mouse'){readoutPoint=localPoint(e);updateReadout();}
    if(mouseRotation){
      if(e.pointerId!==mouseRotation.id)return;
      const [x,y]=localPoint(e);
      if(Math.hypot(x-mouseRotation.x,y-mouseRotation.y)>=4)mouseRotation.moved=true;
      turnMouse(e);
      return;
    }
    if(boxZoom){
      if(e.pointerId!==boxZoom.id)return;
      const rect=flatBoxRect(boxZoom.camera,boxZoom.start,localPoint(e));
      boxOverlay.hidden=!rect;
      if(rect)for(const [name,value] of Object.entries(rect))boxOverlay.style[name]=value+'px';
      return;
    }
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
    if(mouseRotation){
      if(e.pointerId!==mouseRotation.id)return;
      if(cancel){cancelMouseRotation();return;}
      const [x,y]=localPoint(e);
      const {id,right,moved,x:startX,y:startY}=mouseRotation;
      turnMouse(e);
      const {turned}=mouseRotation;
      mouseRotation=null;
      if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
      if(turned)setCamera(camera,true);
      else if(right&&!moved&&Math.hypot(x-startX,y-startY)<4)
        canvas.dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,
          button:2,clientX:e.clientX,clientY:e.clientY}));
      return;
    }
    if(boxZoom){
      if(e.pointerId!==boxZoom.id)return;
      const {start,camera:initial}=boxZoom;
      const next=!cancel&&initial===camera
        ?fitFlatScreenBox(initial,flatBoxRect(initial,start,localPoint(e))):null;
      cancelBoxZoom();
      if(next)setCamera(next,true);
      return;
    }
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
    else if(tool===drawing&&tool?.multiPoint){e.preventDefault();tool.finish();}
    else if(!tool&&e.button===0&&!e.ctrlKey){
      e.preventDefault();
      zoomBy(e.shiftKey?-1:1,localPoint(e));
    }
  });
  function zoomBy(delta, anchor) {
    if (disposed || gesture.active || toolDrag || boxZoom || mouseRotation || !delta) return;
    const zoom=Math.max(FLAT_MIN_ZOOM,Math.min(FLAT_MAX_ZOOM,camera.zoom+delta));
    if (zoom===camera.zoom) return;
    setCamera(camera.zoomAt(zoom,anchor??[camera.width/2,camera.height/2]),true);
  }
  listen('wheel',e=>{
    e.preventDefault();
    const rect=canvas.getBoundingClientRect();
    zoomBy(-Math.sign(e.deltaY)*0.25,[e.clientX-rect.left,e.clientY-rect.top]);
  },{passive:false});
  listen('keydown',e=>{
    if(mouseRotation){
      if(e.key==='Escape'){e.preventDefault();cancelMouseRotation();}
      return;
    }
    if(boxZoom){
      if(e.key==='Escape'){e.preventDefault();cancelBoxZoom();}
      return;
    }
    if (gesture.active || toolDrag || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    // Plus commonly requires Shift, whereas arrow panning remains unmodified.
    const delta=e.key==='+' || (e.key==='=' && !e.shiftKey) ? 1 : e.key==='-' && !e.shiftKey ? -1 : 0;
    if (delta) {
      e.preventDefault();
      zoomBy(delta);
      return;
    }
    const pan={ArrowLeft:[-60,0],ArrowRight:[60,0],ArrowUp:[0,-60],ArrowDown:[0,60]}[e.key];
    if (e.shiftKey && pan?.[0]) {
      // Match the WebGL keyboard's 15° bearing step, without changing pitch.
      e.preventDefault();
      const angle=camera.bearing+15*Math.sign(pan[0]);
      const bearing=((angle+180)%360+360)%360-180;
      setCamera(flatCamera({...camera,bearing}),true);
      return;
    }
    if (!pan || e.shiftKey) return;
    e.preventDefault();
    setCamera(camera.panBy(pan),true);
  });
  mount.replaceChildren(canvas,boxOverlay);
  resize();
  const observer=new window.ResizeObserver(resize);
  observer.observe(mount);
  const close=()=>{
    if(disposed) return;
    cancelBoxZoom();
    cancelMouseRotation();
    disposed=true;
    if(measure?.active)measure.setMode(measure.mode);
    lifetime.abort(); observer.disconnect();clearWake();
    if(frame) window.cancelAnimationFrame(frame);
    for(const entry of metadata.values()) entry.controller.abort();
    queue.close();canvas.remove();boxOverlay.remove();
  };
  window.addEventListener('blur',()=>{cancelBoxZoom();cancelMouseRotation();},{signal});
  window.addEventListener('online',()=>recover(true),{signal});
  window.addEventListener('offline',clearWake,{signal});
  document.addEventListener('visibilitychange',()=>recover(false),{signal});
  window.addEventListener('pageshow',event=>{if(event.persisted)recover(false);},{signal});
  window.addEventListener('pagehide',event=>{if(!event.persisted) close();},{signal});
  const moveTo=({center,zoom,bounds,bearing=camera.bearing,reason='manual'})=>{
    if(disposed) return;
    gesture.cancel();
    cancelBoxZoom();
    cancelMouseRotation();
    const next=bounds?fitFlatBounds(camera,bounds):null;
    setCamera(next??flatCamera({center,zoom,width:camera.width,height:camera.height,bearing}),true,reason);
  };
  const setStyle=next=>{
    if(disposed) return;
    const nextLayers=frameLayers(next);
    const nextDraw=compileFlatFrame(nextLayers), nextRelief=reliefFor(nextLayers);
    const nextQuery=compileFlatVectorQuery(nextLayers,{include:interactiveLayer,includeFill});
    for(const [id,entry] of metadata) {
      if(JSON.stringify(style.sources[id])!==JSON.stringify(next.sources[id])||
         JSON.stringify(reliefBySource.get(id))!==JSON.stringify(nextRelief.get(id))){
        entry.controller.abort();
        metadata.delete(id);
      }
    }
    style=next;compiledLayers=nextLayers;reliefBySource=nextRelief;draw=nextDraw;query=nextQuery;platformLayers=platformLayersFor(nextLayers);
    // Install the new plan before a tap can inspect old pixels/data.
    if(frame)window.cancelAnimationFrame(frame);
    render();
  };
  const platformCandidates=ids=>{
    const result=[],decoded=new WeakMap();
    let count=0,vertices=0,work=0;
    for(const id of ids){
      const layer=platformLayers.get(id);
      if(!layer?.visibleAt(camera.zoom))continue;
      for(const {tile,vector} of visibleFrame.get(layer.source)??[]){
        if(!vector)continue;
        if(!decoded.has(vector))decoded.set(vector,new Map());
        const layers=decoded.get(vector);
        if(!layers.has(layer.sourceLayer))layers.set(layer.sourceLayer,vector.layer(layer.sourceLayer));
        const type={circle:1,line:2,fill:3}[layer.type];
        for(const f of layers.get(layer.sourceLayer)){
          if(f.type!==type)continue;
          if(++count>PLATFORM_UPDATE_LIMITS.candidates)return result;
          if(!layer.resolve({zoom:camera.zoom},f,{},tile))continue;
          const paths=f.paths.filter(path=>path.length>=(f.type===3?4:f.type===2?2:1));
          const size=paths.reduce((sum,path)=>sum+path.length,0);
          const cost=f.type===3?3*size*size:size;
          if(!size||size>PLATFORM_GEOMETRY_LIMITS.vertices||vertices+size>PLATFORM_UPDATE_LIMITS.vertices||
            work+cost>PLATFORM_UPDATE_LIMITS.work||!flatPlatformIntersectsViewport(camera,tile,f))continue;
          vertices+=size;work+=cost;
          const geo=paths.map(path=>path.map(({x,y})=>tileToLngLat(tile.z,tile.x,tile.y,f.extent,[x,y])));
          const geometry=f.type===3?flatPolygonGeometry(geo):f.type===1
            ?{type:'Point',coordinates:geo[0][0]}
            :geo.length===1?{type:'LineString',coordinates:geo[0]}:{type:'MultiLineString',coordinates:geo};
          if(geometry.coordinates.length)result.push({id:f.id,properties:f.properties,geometry});
        }
      }
    }
    return result;
  };
  const readSourcePoints=(source,sourceLayers,filter)=>{
    const entry=sourceFrame.get(source);
    return {state:entry?.state??'inactive',features:flatSourcePoints(entry?.tiles??[],sourceLayers,{filter,zoom:camera.zoom})};
  };
  const resetNorth=()=>{
    if (disposed || gesture.active || toolDrag || camera.bearing===0) return;
    setCamera(flatCamera({...camera,bearing:0}),true,'rotation');
  };
  const showLocation=fix=>{locationFix=fix;schedule();};
  const followLocation=({coordinates})=>{
    if(disposed || gesture.active || toolDrag) return;
    const zoom=Math.max(15,camera.zoom);
    const next=flatCamera({...camera,center:coordinates,zoom});
    if(next.zoom===camera.zoom && next.center.every((n,i)=>n===camera.center[i])) return;
    setCamera(next,true,'location');
  };
  const setDetail=level=>{
    if(disposed||level===tileDetail)return;
    tileDetail=level;
    if(frame)window.cancelAnimationFrame(frame);
    render();
  };
  return {close,invalidateLabels:schedule,moveTo,zoomBy,setDetail,resetNorth,showLocation,followLocation,setStyle,readSourcePoints,platformCandidates,
    inspectionAt:location=>inspectionHits(camera.project(location)),
    getPlatformLayer:id=>platformLayers.has(id),
    platformProjection:{getContainer:()=>mount,project:lngLat=>{const [x,y]=camera.project(lngLat);return {x,y};},
      unproject:point=>{const [lng,lat]=camera.unproject(point);return {lng,lat};}},
    // Use the same planner and request budget as render(), even when the
    // requested source is not active (for example during a coverage fallback).
    getPlannedTileZoom:source=>planFlatSourceTiles(camera,source,512,tileDetail)[0]?.canonical.z,
    getTileTemplate:id=>metadata.get(id)?.value?.tiles?.[0],
    getSource:id=>style.sources[id]?.type==='geojson'?localData.get(id)?.source:undefined,measurementMap:measureOverlay.map,drawingMap:drawingOverlay.map,
    connectDrawing:tool=>{drawing=tool;schedule();},
    connectMeasure:tool=>{measure=tool;schedule();},setCuratedOverview,setProfileMarker:measureOverlay.marker,getZoom:()=>camera.zoom,
    getCenter:()=>camera.center, scaleBar:units=>flatScaleBar(camera,units),getLayers:()=>compiledLayers};
}
