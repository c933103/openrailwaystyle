// Observe the existing map surface without capturing or preventing gestures.
// Pointer lifetime is independent of the hold: a pan is still an active finger.
export function installWatchGesture(surface,{active,open,delay=700}) {
  let timer,held;const pointers=new Set(),view=surface.ownerDocument.defaultView;
  const cancelHold=()=>{clearTimeout(timer);timer=undefined;held=undefined;};
  const cancel=()=>{cancelHold();pointers.clear();};
  const down=e=>{
    if(!active()||e.button>0)return;
    const duplicate=pointers.has(e.pointerId);pointers.add(e.pointerId);
    if(duplicate||pointers.size!==1){cancelHold();return;}
    held={id:e.pointerId,x:e.clientX,y:e.clientY};
    timer=setTimeout(()=>{cancelHold();if(active()&&pointers.size===1)open();},delay);
  };
  const move=e=>{if(held&&held.id===e.pointerId&&Math.hypot(e.clientX-held.x,e.clientY-held.y)>8)cancelHold();};
  const release=e=>{pointers.delete(e.pointerId);if(held?.id===e.pointerId)cancelHold();};
  const leave=release;
  const context=e=>{if(active()){e.preventDefault();cancel();open();}};
  const key=e=>{if(active()&&(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey)){e.preventDefault();cancel();open();}};
  surface.addEventListener('pointerdown',down,{passive:true});
  surface.addEventListener('pointermove',move,{passive:true});
  surface.addEventListener('pointerleave',leave,{passive:true});
  for(const name of ['pointerup','pointercancel'])view.addEventListener(name,release,{passive:true});
  surface.addEventListener('contextmenu',context);
  surface.addEventListener('keydown',key);view.addEventListener('blur',cancel);
  return {cancel,destroy(){cancel();surface.removeEventListener('pointerdown',down);surface.removeEventListener('pointermove',move);surface.removeEventListener('pointerleave',leave);for(const name of ['pointerup','pointercancel'])view.removeEventListener(name,release);surface.removeEventListener('contextmenu',context);surface.removeEventListener('keydown',key);view.removeEventListener('blur',cancel);}};
}
