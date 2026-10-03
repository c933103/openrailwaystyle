// Listeners observe the existing map surface; they never capture pointers or
// prevent a drag/pinch. A moving or second pointer cancels the long press.
export function installWatchGesture(surface,{active,open,delay=700}) {
  let timer,held;
  const cancel=()=>{clearTimeout(timer);timer=undefined;held=undefined;};
  const down=e=>{
    if(!active()||e.button>0)return;
    if(held){cancel();return;}
    held={id:e.pointerId,x:e.clientX,y:e.clientY};
    timer=setTimeout(()=>{cancel();if(active())open();},delay);
  };
  const move=e=>{if(held&&held.id===e.pointerId&&Math.hypot(e.clientX-held.x,e.clientY-held.y)>8)cancel();};
  const release=e=>{if(held?.id===e.pointerId)cancel();};
  const context=e=>{if(active()){e.preventDefault();cancel();open();}};
  const key=e=>{if(active()&&(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey)){e.preventDefault();cancel();open();}};
  surface.addEventListener('pointerdown',down,{passive:true});
  surface.addEventListener('pointermove',move,{passive:true});
  for(const name of ['pointerup','pointercancel','pointerleave'])surface.addEventListener(name,release,{passive:true});
  surface.addEventListener('contextmenu',context);
  surface.addEventListener('keydown',key);
  const blur=()=>cancel();surface.ownerDocument.defaultView.addEventListener('blur',blur);
  return {cancel,destroy(){cancel();surface.removeEventListener('pointerdown',down);surface.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','pointerleave'])surface.removeEventListener(name,release);surface.removeEventListener('contextmenu',context);surface.removeEventListener('keydown',key);surface.ownerDocument.defaultView.removeEventListener('blur',blur);}};
}
