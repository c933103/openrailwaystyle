import geojsonvt from 'geojson-vt';

// Tile prepared map snapshots only when the view has requested them.
// Keep indexed coordinates clipped and source properties intact so drawing,
// filtering, and selection all consume the same Canonical tile geometry.
export function compileFlatLocalGeometry(collection, layer) {
  const extent=4096,maxZoom=19;
  const index=geojsonvt(collection,{extent,maxZoom});
  const cache=new Map();
  function at(z,x,y) {
    const key=z+'/'+x+'/'+y;
    if(cache.has(key))return cache.get(key);
    const tile=index.getTile(z,x,y), transformed=tile?.features.map(({id,type,tags,geometry})=>{
      const all=type===1?geometry.map(point=>[point]):geometry;
      return {id,type,properties:tags??{},extent,paths:all.map(path=>path.map(([x,y])=>({x,y})))};
    })??[];
    const vector=transformed.length?{layer:name=>name===layer?transformed:[]}:null;
    if(cache.size>=96)cache.delete(cache.keys().next().value);
    cache.set(key,vector);
    return vector;
  }
  return camera=>camera.visibleTiles(Math.min(maxZoom,Math.floor(camera.zoom))).flatMap(tile=>{
    const vector=at(tile.z,tile.x,tile.y);
    return vector?[{tile,vector}]:[];
  });
}
