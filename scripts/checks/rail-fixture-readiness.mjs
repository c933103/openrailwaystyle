// Independent browser-fixture contract for the current user-visible warning.
// Keep this explicit: generic errors or a warning without retry must not pass.
export const RAIL_OUTAGE_STATUS='OpenRailwayMap railway data unavailable. Retrying failed tiles. Independent map references remain where available; detail may be missing.';

// Playwright serializes this function into the page, so it has no module closure.
export function railOutageReady(expectedStatus) {
  const status=document.getElementById('map-status');
  if(!status?.classList.contains('error')||status.textContent!==expectedStatus)return false;
  const failed=new Set();
  for(const event of window.recoveryEvents||[]) {
    const tile=event.coordinate;
    if(event.type==='error'&&event.sourceId==='railway'&&tile&&
      [tile.z,tile.x,tile.y].every(Number.isInteger))failed.add(`${tile.z}/${tile.x}/${tile.y}`);
  }
  return failed.size>=2;
}

// setStyle({diff:false}) temporarily has no serialized style. Poll through that
// interval, but never accept the previous language or an unready target style.
export function stationLanguageStyleReady(language) {
  const map=window.stationMap,style=map?.getStyle();
  const url=style?.sources?.openmaptiles?.url;
  return typeof url==='string'&&url.startsWith(`atlasbase://${language}/`)&&map.isStyleLoaded();
}
