import vtpbf from 'vt-pbf';

// MapLibre's terrain manager samples a DEM one zoom below its render tiles.
// Camera zoom 11.3 therefore queries z10, whose synthetic DEM is all seabed.
// Use zoom 12.3 to exercise the intended z11 land/ocean composite, not change
// the signed-height assertions or fabricate land in the coarse sea fixture.
export const TERRAIN_3D_BROWSER_FIXTURE = Object.freeze({
  tileSize: 256, demZoom: 11, tileX: 1024, tileY: 1024,
  cameraZoom: 12.3, pitch: 60, width: 1180, height: 800,
});

export function terrain3DWaterFixture() {
  // geojson-vt geometry is [x,y] arrays, not vector-tile Point objects.
  // vt-pbf omits the duplicate closing point, so the ring must be closed.
  return vtpbf.fromGeojsonVt({water:{extent:4096,features:[{
    type:3,tags:{class:'ocean'},geometry:[[
      [0,0],[2048,0],[2048,4096],[0,4096],[0,0]
    ]]
  }]}});
}

// Serialized by Playwright into the page realm: keep all helpers local.
export function captureTerrain3DFailure() {
  const map=window.fixtureMap;
  const read=fn=>{try{return fn();}catch(error){return {error:error.message};}};
  return {state:read(()=>window.terrainState?.()??null),
    source:read(()=>map?.getTerrain?.()?.source??null),pitch:read(()=>map?.getPitch?.()??null),
    counts:window.terrainCounts??null,requestedDems:window.requestedDems??[],
    workerReplies:window.workerReplies??[],workerErrors:window.workerErrors??[],mapErrors:window.terrainErrors??[],
    styleLoaded:read(()=>map?.isStyleLoaded()??false),
    sourceLoaded:read(()=>map?.getSource('terrain3d')?map.isSourceLoaded('terrain3d'):false)};
}
