import {hanRegion,chineseArea} from '../styles/han-region.mjs';
const rad=Math.PI/180;
// Preserve globe coverage, then admit closer regional hubs as the view closes.
// These are density controls; minZoom remains the manually reviewed role.
export const MAJOR_STATION_DENSITY=Object.freeze([
 Object.freeze({zoom:3,spacing:null,padding:14}),
 Object.freeze({zoom:4,spacing:78,padding:14}),
 Object.freeze({zoom:5,spacing:68,padding:12}),
 Object.freeze({zoom:6,spacing:56,padding:10}),
]);
export function distanceKm(a,b){const p=(b.lat-a.lat)*rad,l=(b.lon-a.lon)*rad,h=Math.sin(p/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(l/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));}
const mercator=p=>[(p.lon+180)/360, .5-Math.log(Math.tan(Math.PI/4+Math.max(-85.051129,Math.min(85.051129,p.lat))*rad/2))/(2*Math.PI)];
export function separationPixels(a,b,z){const [x,y]=mercator(a),[u,v]=mercator(b),dx=Math.abs(x-u);return Math.hypot(Math.min(dx,1-dx),y-v)*512*2**z;}
// Curated network roles first, then regional round-robin coverage. Adding
// candidates never promotes them by guessing importance from their names.
export function stationOrder(entries){
 const grouped=new Map();
 for(const e of [...entries].sort((a,b)=>a.minZoom-b.minZoom||a.rank-b.rank||a.wikidata.localeCompare(b.wikidata))){if(!grouped.has(e.region))grouped.set(e.region,[]);grouped.get(e.region).push(e);}
 const ordered=[];while([...grouped.values()].some(g=>g.length))for(const group of grouped.values())if(group.length)ordered.push(group.shift());return ordered;
}
export function selectMajorStations(entries){
 const ordered=stationOrder(entries),selected=[],tiers=new Map();
 for(const {zoom:z,spacing} of MAJOR_STATION_DENSITY)for(const e of ordered){
  if(tiers.has(e.wikidata)||e.minZoom>z)continue;
  if(z<=4&&selected.some(p=>p.metro===e.metro&&p.country===e.country))continue;
  if(selected.some(p=>z===3?distanceKm(e,p)<550:separationPixels(e,p,z)<spacing))continue;
  tiers.set(e.wikidata,z);selected.push(e);
 }
 return entries.map(e=>({...e,tier:tiers.get(e.wikidata)??7}));
}
export function validateStationCountries(entries){
 for(const e of entries)if(!e.countryEvidence?.includes(e.country)&&!(e.country==='HK'&&e.countryEvidence?.includes('CN')))throw new Error(`Station country conflicts with recorded evidence: ${e.name}`);
}
export function majorStationsGeoJSON(entries){
 const seen=new Set();for(const e of entries){
  if(seen.has(e.wikidata)||!/^Q\d+$/.test(e.wikidata)||!/^(node|way|relation)\/[1-9]\d*$/.test(e.osm)||!e.name||!e.basis||!Number.isFinite(e.lon)||!Number.isFinite(e.lat)||Math.abs(e.lon)>180||Math.abs(e.lat)>90||![3,4,5,6].includes(e.minZoom))throw new Error(`Invalid major station: ${e.name}`);seen.add(e.wikidata);
 }
 return {type:'FeatureCollection',features:selectMajorStations(entries).filter(e=>e.tier<=6).map(e=>{
  const [osm_type,osm_id]=e.osm.split('/'),atlas_han=hanRegion(e.lon,e.lat);
  return {type:'Feature',id:e.wikidata,geometry:{type:'Point',coordinates:[e.lon,e.lat]},properties:{...Object.fromEntries(Object.entries(e).filter(([k])=>k==='name'||k.startsWith('name:'))),osm_type,osm_id,id:`${osm_type}-${osm_id}`,wikidata:e.wikidata,feature:'station',state:'present',station:e.station||'train',station_size:e.minZoom===3?'large':'normal',curated:true,mapped_feature:e.mappedFeature||'railway=station',tier:e.tier,rank:e.rank,basis:e.basis,atlas_han,atlas_zh:atlas_han==='cjkv'?chineseArea(e.lon,e.lat):''}};
 })};
}
export function stationAliases(entries){return [...new Set(entries.flatMap(e=>[e.osm,...(e.osmAliases||[])]).flatMap(id=>[id,id.replace('/','-')]))];}
// Current provider cluster IDs append the mode and feature, for example
// node-2149761647-train-station. Strip that suffix before matching identities.
export function curatedStationFilter(entries){
 const identity=['let','raw',['to-string',['coalesce',['get','id'],['get','osm_id'],'']],['let','end',['index-of','-',['var','raw'],['+',['index-of','-',['var','raw']],1]],['case',['>=',['var','end'],0],['slice',['var','raw'],0,['var','end']],['var','raw']]]];
 const aliases=new Map(),wikidata=new Map();
 for(const e of entries){const tier=e.tier??e.minZoom??3;for(const id of stationAliases([e]))aliases.set(id,Math.min(tier,aliases.get(id)??7));wikidata.set(e.wikidata,Math.min(tier,wikidata.get(e.wikidata)??7));}
 const firstZoom=(value,index)=>['match',value,...[3,4,5,6].flatMap(tier=>{const keys=[...index].filter(([,z])=>z===tier).map(([id])=>id);return keys.length?[keys,tier]:[];}),7];
 return ['any',['>=',['zoom'],7],['all',['<',['zoom'],firstZoom(identity,aliases)],['<',['zoom'],firstZoom(['coalesce',['get','wikidata'],''],wikidata)]]];
}
export function duplicatesMajorStation(p,entries){const raw=p.osm_type&&p.osm_id?`${p.osm_type}/${p.osm_id}`:String(p.id??p.osm_id??''),id=/^(node|way|relation)[/-](\d+)/.exec(raw);return stationAliases(entries).includes(id?`${id[1]}/${id[2]}`:raw)||entries.some(e=>e.wikidata===p.wikidata);}
