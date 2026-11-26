export function paintFlatHeading(context,x,y,heading,bearing) {
  if(!Number.isFinite(heading))return;
  // Geolocation heading is clockwise from north; project it onto the rotated map.
  context.save();context.translate(x,y);
  context.rotate((heading-bearing)*Math.PI/180);
  context.beginPath();context.moveTo(0,-21);context.lineTo(6,-10);
  context.lineTo(-6,-10);context.closePath();context.fill();context.stroke();
  context.restore();
}

// Location is requested only on a user action. The application stores no
// location history; the renderer uses the positions only for the live marker/view.
export function connectFlatLocation({button,status,geolocation,window,showFix,followFix}) {
  let watch=null, generation=0, state='off', fix=null;
  function showState(next,message='') {
    state=next;
    button.dataset.locationState=state;
    button.setAttribute('aria-pressed',String(state==='waiting'||state==='following'));
    button.title={off:'Follow my location',waiting:'Cancel finding my location',
      following:'Stop following my location',paused:'Recenter and follow my location'}[state];
    status.textContent=message;
  }
  function stop(message='') {
    generation++;
    if(watch!==null) geolocation.clearWatch(watch);
    watch=null;
    fix=null;
    showFix(null);
    showState('off',message);
  }
  function resume() {
    showState(fix?'following':'waiting',fix?'Following your location.':'Finding your location…');
    if(fix) followFix(fix);
  }
  function toggle() {
    if(state==='paused'){resume();return;}
    if(state!=='off'){stop('Location follow stopped.');return;}
    if(!geolocation?.watchPosition){showState('off','Location is unavailable in this browser.');return;}
    resume();
    const current=++generation;
    try {
      watch=geolocation.watchPosition(({coords})=>{
        if(current!==generation)return;
        const {longitude,latitude,accuracy,heading}=coords;
        if(!Number.isFinite(longitude)||Math.abs(longitude)>180||
           !Number.isFinite(latitude)||Math.abs(latitude)>90)return;
        fix={coordinates:[longitude,latitude],accuracy,
          heading:Number.isFinite(heading)&&heading>=0&&heading<360?heading:null};
        showFix(fix);
        if(state==='waiting')showState('following','Following your location.');
        if(state==='following')followFix(fix);
      },error=>{
        if(current!==generation)return;
        stop(error.code===1?'Location permission was denied.':'Could not find your location. Try again.');
      },{enableHighAccuracy:true,maximumAge:10000,timeout:15000});
    } catch {stop('Location is unavailable in this browser.');}
  }
  button.addEventListener('click',toggle);
  window.addEventListener('pagehide',()=>{if(watch!==null)stop();});
  showState('off');
  return {pause(){
    if(state==='waiting'||state==='following')showState('paused','Location follow paused.');
  },stop};
}
