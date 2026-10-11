// EXPERIMENTAL background adapter. Not part of the published style until the
// raster host's third-party usage terms and attribution are confirmed.
// We request only onscreen tiles on explicit user selection: no prefetch,
// tile mirroring, server proxy or offline tile cache.
export const SOVIET_TILE_URL='https://tiles.nakarte.me/topomapper/{z}/{x}/{y}';
export const SOVIET_TILE_ORIGIN='https://tiles.nakarte.me';
export const SOVIET_SOURCE={
  type:'raster',
  tiles:[SOVIET_TILE_URL],
  tileSize:256,
  minzoom:1,
  maxzoom:13,
  attribution:'<a href="https://nakarte.me/">AtloMaps historical topographic maps via NaKarte</a> · historic cartography, not current conditions',
};
export const SOVIET_LAYER='soviet-topo';

// Render scanned land maps before the existing bathymetry raster, which is
// masked to the sea. Modern railway and station layers are above both.
// On a missing historic tile, the subdued existing base-map fills remain
// underneath instead of leaving a misleading solid colour.
export function installSovietStyle(style){
  if(!style||typeof style!=='object'||!style.sources||
     !Array.isArray(style.layers)||style.sources.sovietTopo||
     style.layers.some(l=>l.id===SOVIET_LAYER))
     throw new Error('Cannot install Soviet topo source into malformed or already extended style');
  const seabed=style.layers.findIndex(l=>l.id==='terrain-bathymetry');
  const water=style.layers.findIndex(l=>l.id==='water');
  if(seabed<0||water<0||seabed<=water)
    throw new Error('Seabed must remain above historical raster but beneath rail overlays');
  style.sources.sovietTopo={...SOVIET_SOURCE,tiles:[...SOVIET_SOURCE.tiles]};
  style.layers.splice(seabed,0,{
    id:SOVIET_LAYER,type:'raster',source:'sovietTopo',
    layout:{visibility:'none'},
    paint:{'raster-fade-duration':150,'raster-resampling':'linear'},
    metadata:{
      'atlas:semantics-version':1,
      'atlas:group':'background',
      'atlas:category':'soviet',
      'atlas:views':[],
      'atlas:settings':[],
      'atlas:initial-hidden':false,
      'atlas:base-map':false,
      'atlas:terrain':false,
      'atlas:runtime':false,
      'atlas:background':'soviet',
      'atlas:hide-backgrounds':[],
      'atlas:localize':false,
    },
  });
  return style;
}
