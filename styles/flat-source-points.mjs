// Read the already-loaded canonical vector tiles. Inspecting context never
// requests extra provider tiles, and wrapped display copies count only once.
export function flatSourcePoints(tiles,sourceLayers) {
  const canonical=new Set(), output=[];
  for(const {tile,vector} of tiles){
    if(!vector)continue;
    const {z,x,y}=tile,key=z+'/'+x+'/'+y;
    if(canonical.has(key))continue;
    canonical.add(key);
    const n=2**z;
    for(const sourceLayer of sourceLayers)for(const feature of vector.layer(sourceLayer)){
      if(feature.type!==1)continue;
      for(const path of feature.paths)for(const point of path){
        const u=point.x/feature.extent,v=point.y/feature.extent;
        if(u<0||u>=1||v<0||v>=1)continue;
        const lng=(x+u)/n*360-180, lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+v)/n)))*180/Math.PI;
        output.push({id:feature.id,properties:feature.properties,sourceLayer,
          geometry:{type:'Point',coordinates:[lng,lat]}});
      }
    }
  }
  return output;
}
