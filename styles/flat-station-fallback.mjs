// The Canvas queue selects one effective canonical zoom for a source, so a
// failed tile needs only its own exact extent, not the WebGL mixed-LOD mask.
export const flatStationFallbackLayer=id=>
  id==='station-basemap-fallback-dots'||id==='station-basemap-fallback-names';

export function flatStationFallbackMask({metadataFailed=false,tiles=[]}={}) {
  if(!metadataFailed&&!tiles.length)return ()=>false;
  const failed=new Set(tiles.map(({tile})=>tile.z+'/'+tile.x+'/'+tile.y));
  const levels=[...new Set(tiles.map(({tile})=>tile.z))];
  return (feature,tile)=>{
    const p=feature.paths?.[0]?.[0];
    if(feature.type!==1||!p||feature.paths.length!==1||feature.paths[0].length!==1)return false;
    const u=p.x/feature.extent,v=p.y/feature.extent;
    if(u<0||u>=1||v<0||v>=1)return false; // no buffered duplicates
    if(metadataFailed)return true;
    return levels.some(z=>{
      const scale=2**(z-tile.z),x=Math.floor((tile.x+u)*scale),y=Math.floor((tile.y+v)*scale);
      return failed.has(z+'/'+x+'/'+y);
    });
  };
}
