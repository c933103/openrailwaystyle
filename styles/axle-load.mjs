// EN 15528 reference categories, not the US/Canadian speed classes.
// Finnish superstructure codes require an explicit geographic/system marker.
export const AXLE_CATEGORIES = {
  A:[16,5],B1:[18,5],B2:[18,6.4],C2:[20,6.4],C3:[20,7.2],C4:[20,8],
  D2:[22.5,6.4],D3:[22.5,7.2],D4:[22.5,8],D5:[22.5,8.8],D4xL:[22.5,8],
  E4:[25,8],E5:[25,8.8],E6:[25,10],F:[27.5,null],G:[30,null],
  CE:[20,8],CM2:[21,6.4],CM3:[21,7.2],CM:[21,8],
};
export const AXLE_STOPS = [[10,'#526da8'],[16,'#218aab'],[18,'#278454'],[20,'#9a8500'],[22.5,'#d98213'],[25,'#d24c35'],[30,'#742da0'],[40,'#ad2463']];
export const SHORT_TON = 0.90718474;
const rounded = value => Number(value.toFixed(2));
export function axleColour(tonnes) {
  let i=AXLE_STOPS.findIndex(([value])=>value>=tonnes);
  if(i===0) return AXLE_STOPS[0][1];
  if(i<0) return AXLE_STOPS.at(-1)[1];
  const [a,ca]=AXLE_STOPS[i-1],[b,cb]=AXLE_STOPS[i],t=(tonnes-a)/(b-a);
  return '#'+[1,3,5].map(k=>Math.round(parseInt(ca.slice(k,k+2),16)*(1-t)+parseInt(cb.slice(k,k+2),16)*t).toString(16).padStart(2,'0')).join('');
}
export function explicitAxleLoad(value) {
  const match=/^([0-9]+(?:\.[0-9]+)?)\s*(t|tonnes?|st|short tons?|lbs?|pounds?|kg)?$/i.exec(String(value??'').trim());
  if(!match) return null;
  const unit=(match[2]||'t').toLowerCase(),multiplier=/^(st|short)/.test(unit)?SHORT_TON:/^(lb|pound)/.test(unit)?0.00045359237:unit==='kg'?0.001:1;
  const tonnes=Number(match[1])*multiplier;
  return tonnes>0&&Number.isFinite(tonnes)?tonnes:null;
}
export function axleLoad(props={}) {
  const physical=explicitAxleLoad(props.axle_load),legal=explicitAxleLoad(props.maxaxleload);
  const direct=physical===null?legal:legal===null?physical:Math.min(physical,legal), tagged=String(props['railway:track_class']??props.track_class??'').trim();
  const finnish=props.axle_system==='fi'||String(props.country??props['addr:country']??'').toUpperCase()==='FI';
  const code=tagged.replace(/L$/,'');
  const category=!finnish&&props.axle_system!=='unknown'&&(AXLE_CATEGORIES[tagged]||AXLE_CATEGORIES[code]);
  const tonnes=direct??(category?.[0]??null);
  if(tonnes===null) return null;
  return {tonnes,perMetre:category?.[1]??null,label:`${rounded(tonnes)} t`,colour:axleColour(tonnes),taggedClass:tagged,
    physical,legal,source:direct!==null?(physical!==null&&legal!==null?'axle_load + maxaxleload':physical!==null?'axle_load':'maxaxleload'):'railway:track_class',restricted:/L$/.test(tagged)&&!!category};
}
export function formatAxleLoad(value, units='metric') {
  if(!value) return '';
  const load=units==='imperial'?`${rounded(value.tonnes/SHORT_TON)} short tons`:`${rounded(value.tonnes)} t`;
  const per=value.perMetre===null?'':units==='imperial'?` · ${rounded(value.perMetre/SHORT_TON*0.3048)} short tons/ft`:` · ${value.perMetre} t/m`;
  return load+per+(value.restricted?' · additional operating restrictions':'');
}
export function axlePaint() {
  const tonnes=['to-number',['coalesce',['get','axle_tonnes'],0],0];
  return ['case',['>',tonnes,0],['interpolate',['linear'],tonnes,...AXLE_STOPS.flat()],'#899197'];
}
export function axleLabel(units='metric') {
  const value=['get','axle_tonnes'];
  return ['case',['>', ['to-number',value,0],0],['concat',['to-string',['/', ['round',['*',value,units==='imperial'?100/SHORT_TON:100]],100]],units==='imperial'?' short tons':' t'],''];
}
