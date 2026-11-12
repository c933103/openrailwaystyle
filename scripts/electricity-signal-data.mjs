// Maintenance-only selection of electrification signals: every railway signal
// node recording railway:signal:electricity, whatever its national value.
// The provider's signal tiles mark such signals only when their value matches
// its per-country catalogue (French, Portuguese, Spanish and Austrian tram
// values were missing in October 2026), so the Power view uses this
// tag-based snapshot to treat every country alike.
import {hanRegion,chineseArea} from '../styles/han-region.mjs';

const KEEP=['ref','name','railway:signal:direction','railway:signal:position'];
export function electricitySignalQuery(box) {
  if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[0]<-90||box[2]>90||box[1]<-180||box[3]>180||box[0]>=box[2]||box[1]>=box[3])throw new Error('Invalid electricity-signal bbox');
  return `[out:json][timeout:240][maxsize:134217728];node(${box.join(',')})["railway"="signal"]["railway:signal:electricity"]["railway:signal:electricity"!="no"];out body qt;`;
}

export function electricitySignalsGeoJSON(json) {
  if(json?.remark||!Array.isArray(json?.elements))throw new Error(json?.remark||'Incomplete electricity-signal response');
  const features=new Map();
  for(const element of json.elements) {
    const tags=element?.tags||{};
    if(element?.type!=='node'||tags.railway!=='signal'||!tags['railway:signal:electricity']||tags['railway:signal:electricity']==='no')continue;
    if(!Number.isSafeInteger(element.id)||!Number.isFinite(element.lon)||!Number.isFinite(element.lat)||Math.abs(element.lon)>180||Math.abs(element.lat)>90)throw new Error(`Incomplete electricity signal node-${element.id}`);
    const properties={osm_type:'node',osm_id:String(element.id)};
    // Keep the electricity attributes and identification, not unrelated
    // signal components of a combined signal.
    for(const [key,value] of Object.entries(tags))if(key.startsWith('railway:signal:electricity')||KEEP.includes(key))properties[key]=value;
    const atlas_han=hanRegion(element.lon,element.lat);
    // The recorded function (type) when given, otherwise the national value.
    const label=String(tags['railway:signal:electricity:type']||tags['railway:signal:electricity']).replaceAll('_',' ');
    Object.assign(properties,{atlas_han,atlas_zh:atlas_han==='cjkv'?chineseArea(element.lon,element.lat):'',electricity_label:label,
      power_state:tags['railway:signal:electricity:deactivated']==='yes'?'deactivated':'present'});
    const id=`node-${element.id}`;
    features.set(id,{type:'Feature',id,geometry:{type:'Point',coordinates:[element.lon,element.lat]},properties});
  }
  return {type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}
