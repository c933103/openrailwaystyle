// Return a CSS-pixel clip for only the failed primary tiles, in every visible
// world copy. null = use the whole viewport (metadata failed); false = hide.
export function flatRailReferenceClip(camera, {metadataFailed=false, failed=[], planned=[]}={}) {
  if (metadataFailed) return null;
  if (!failed.length) return false;
  const keys=new Set(failed.map(({tile:{z,x,y}})=>`${z}/${x}/${y}`));
  const copies=planned.filter(({key})=>keys.has(key)).flatMap(({copies})=>copies);
  if (!copies.length) return false;
  const polygons=copies.map(tile=>{
    const [a,b,c,d,x,y]=camera.tileTransform(tile);
    return [[x,y],[x+a,y+b],[x+a+c,y+b+d],[x+c,y+d]];
  });
  return context=>{
    context.beginPath();
    for(const [first,...corners] of polygons){
      context.moveTo(...first);
      for(const corner of corners)context.lineTo(...corner);
      context.closePath();
    }
    context.clip();
  };
}
