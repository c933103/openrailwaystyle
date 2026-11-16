// Executed in the browser only after an actual-Atlas assertion fails. Keep
// evidence bounded and serializable; diagnostic failure must not mask it.
export function mainlineAtlasDiagnostics() {
 const map=globalThis.atlasMap;
 if(!map)return {mapAvailable:false};
 const style=map.getStyle(),zoom=map.getZoom();
 const mode=document.querySelector('[data-mode][aria-pressed="true"]')?.dataset.mode;
 const selected=style.layers.find(layer=>layer.id===`${mode}-${zoom<7?'overview':'tracks'}`);
 const sourceIds=[...new Set(['railReference',selected?.source].filter(Boolean))];
 return {mapAvailable:true,mode,zoom,status:document.getElementById('status')?.textContent,
  layers:style.layers.filter(layer=>layer.source==='railReference'||layer.id===selected?.id)
   .map(layer=>({id:layer.id,source:layer.source,visibility:map.getLayoutProperty(layer.id,'visibility'),
    renderedIds:map.queryRenderedFeatures({layers:[layer.id]}).slice(0,20).map(f=>f.properties?.id)})),
  sources:sourceIds.map(id=>{const source=map.getSource(id),manager=map.style?.tileManagers?.[id];
   return {id,url:source?.url,loaded:map.isSourceLoaded(id),
    tiles:manager?.getIds?.().slice(0,20).map(key=>{const tile=manager.getTileByID(key);
     return {key,state:tile?.state,aborted:tile?.aborted,coordinate:tile?.tileID?.canonical};})};})};
}
