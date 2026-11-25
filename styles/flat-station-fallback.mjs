// The Canvas queue selects one effective canonical zoom for a source, so a
// failed tile needs only its own exact extent, not the WebGL mixed-LOD mask.
export const flatStationFallbackLayer=id=>
  id==='station-basemap-fallback-dots'||id==='station-basemap-fallback-names'||id==='station-curated-fallback-dots';

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

// The z7 curated points are already in the style; no additional provider
// or archive is needed. Adapt only these small Point features so they share
// Canvas tile projection, clipping, filtering and picking.
export const compileFlatCuratedStations=collection=>compileFlatPointCollection(collection,'curated-stations',7);

export function compileFlatPointCollection(collection,layer,z) {
  const n=2**z, extent=4096, buckets=new Map();
  for(const entry of collection?.features??[]){
    const coordinates=entry.geometry?.coordinates;
    if(entry.geometry?.type!=='Point'||!Array.isArray(coordinates)||coordinates.length<2)continue;
    const [lng,lat]=coordinates;
    if(!Number.isFinite(lng)||Math.abs(lng)>180||!Number.isFinite(lat)||Math.abs(lat)>85.05112878)continue;
    const x=((lng+180)/360*n)%n;
    const y=Math.max(0,Math.min(n-n*Number.EPSILON,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n));
    const tx=Math.floor(x),ty=Math.floor(y),key=tx+'/'+ty;
    const feature={id:entry.id,type:1,properties:entry.properties??{},extent,
      paths:[[{x:(x-tx)*extent,y:(y-ty)*extent}]]};
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(feature);
  }
  return camera=>camera.visibleTiles(z).flatMap(tile=>{
    const points=buckets.get(tile.x+'/'+tile.y);
    return points?.length?[{tile,vector:{layer:name=>name===layer?points:[]}}]:[];
  });
}
