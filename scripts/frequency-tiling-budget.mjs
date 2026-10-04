// Bound the work before geojson-vt eagerly subdivides a feed. Geometry is
// projected exactly as the tiler projects it; the 3x3 neighbourhood covers
// its 64/4096 tile buffer, including lines on tile boundaries.
export class FrequencyTilingBudgetError extends Error {}
export const TILING_LIMITS = {features:200000,vertices:2000000,copies:250000,bytes:768*1024*1024};
const point=([lon,lat])=>{
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon < -180||lon > 180||lat < -90||lat > 90)throw new FrequencyTilingBudgetError('Invalid frequency geometry coordinates');
  const sin=Math.sin(lat*Math.PI/180);
  return [(lon+180)/360,Math.max(0,Math.min(1,.5-.25*Math.log((1+sin)/(1-sin))/Math.PI))];
};
export function assertFrequencyTilingBudget(features,{minZoom=0,maxZoom=12,limits=TILING_LIMITS}={}){
  let count=0,vertices=0,copies=0,bytes=0;
  for(const feature of features){
    if(++count>limits.features)throw new FrequencyTilingBudgetError('Frequency tiling feature budget exceeded');
    const g=feature.geometry,lines=g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:null;
    if(!lines)throw new FrequencyTilingBudgetError('Invalid frequency tiling geometry');
    const propertyBytes=2*Buffer.byteLength(JSON.stringify(feature.properties||{}))+512;
    for(const line of lines){
      vertices+=line.length;if(vertices>limits.vertices)throw new FrequencyTilingBudgetError('Frequency tiling vertex budget exceeded');
      const projected=line.map(point);
      for(let z=minZoom;z<=maxZoom;z++){
        const n=2**z;let traversals=0,xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
        for(let i=0;i<projected.length;i++){
          const [x,y]=projected[i].map(v=>Math.floor(v*n));
          xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);
          if(i){const [a,b]=projected[i-1].map(v=>Math.floor(v*n));traversals+=Math.abs(x-a)+Math.abs(y-b)+1;}
        }
        // Either bound alone covers every touched tile; taking their minimum
        // avoids counting thousands of vertices repeatedly within one tile.
        const upper=Math.min((xmax-xmin+3)*(ymax-ymin+3),9*traversals);
        copies+=upper;bytes+=upper*propertyBytes;
        if(copies>limits.copies||bytes>limits.bytes)throw new FrequencyTilingBudgetError('Frequency tiling fan-out/byte budget exceeded');
      }
    }
  }
  return {features:count,vertices,copies,bytes};
}
