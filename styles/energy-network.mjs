import {createBundleReader} from './tile-bundles.mjs?v=20261120-admin-tile-preview-1';
import {ENERGY_TIERS} from './energy-network-schema.mjs?v=20261120-admin-tile-preview-1';
export {ENERGY_TIERS};
export const ENERGY_DOMAINS=Object.freeze({electricity:{color:'#99000d',mark:'E',label:'Civil electricity'},fuel:{color:'#b35806',mark:'F',label:'Fuel supply chain'},coal:{color:'#8c510a',mark:'C',label:'Coal supply chain'},water:{color:'#41b6c4',mark:'W',label:'Water and steam supply'},battery:{color:'#008a83',mark:'B',label:'Battery storage'},hydrogen:{color:'#00acc1',mark:'H',label:'Hydrogen supply'},servicing:{color:'#6f7b82',mark:'S',label:'Rail servicing'}});
export const ENERGY_NETWORK_LINES=Object.freeze([
 {id:'grid',label:'Civil electricity line',color:'#99000d'},
 {id:'cable',label:'Electricity cable',color:'#67000d',dash:[.5,2]},
 {id:'traction',label:'Explicit traction supply circuit',color:'#ff7f00',dash:[4,1,1,1]},
 {id:'fuel',label:'Fuel or gas pipeline',color:'#b35806',dash:[5,2]},
 {id:'hydrogen',label:'Hydrogen pipeline',color:'#00acc1',dash:[4,1,1,1]},
 {id:'water',label:'Water or steam pipeline',color:'#41b6c4',dash:[2,2]},
 {id:'coal',label:'Coal conveyor',color:'#8c510a',dash:[.5,2]},
 {id:'other',label:'Other supply connection',color:'#6f7b82'},
].map(Object.freeze));
export const ENERGY_DOMAIN_PAINT=['match',['get','energy_domain'],...Object.entries(ENERGY_DOMAINS).flatMap(([key,{color}])=>[key,color]),'#6f7b82'];
export const ENERGY_DOMAIN_BADGE=['match',['get','energy_domain'],...Object.entries(ENERGY_DOMAINS).flatMap(([key,{mark}])=>[key,mark]),'?'];
// The manifest is optional until the first complete extract publication. Even
// its metadata costs zero requests outside Power; inactive tiles never fan out.
export function createEnergyNetworkProtocol({root,active,fetcher=fetch}) {
  let manifest;
  const guardedFetch=(url,options)=>{if(!active())throw new DOMException('Power view inactive','AbortError');return fetcher(url,options);};
  const readers=Object.fromEntries(Object.keys(ENERGY_TIERS).map(tier=>[tier,createBundleReader({root:new URL(tier+'/',root),fetcher:guardedFetch})]));
  const available=()=>manifest||=guardedFetch(new URL('manifest.json',root)).then(async response=>{
    if(response.status===404)return false;
    if(!response.ok)throw new Error(`Energy manifest returned ${response.status}`);
    const data=await response.json();
    return data.schema===2&&data.dataset==='energy-network'&&data.complete===true&&data.format==='atlas-tile-bundle-1'&&data.minzoom===5&&data.maxzoom===14;
  }).catch(error=>{manifest=undefined;throw error;});
  return async(params,controller)=>{
    if(!active())return {data:new ArrayBuffer(0)};
    const match=/^energynetwork:\/\/(overview|context|detail)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
    if(!match)throw new Error('Invalid energy tile');
    const [,tier,zs,xs,ys]=match,z=Number(zs),x=Number(xs),y=Number(ys);
    if(z<ENERGY_TIERS[tier].minzoom||z>ENERGY_TIERS[tier].maxzoom||x>=2**z||y>=2**z)throw new Error('Invalid energy tile coordinate');
    controller.signal.throwIfAborted();
    if(!await available()||!active())return {data:new ArrayBuffer(0)};
    controller.signal.throwIfAborted();
    const data=await readers[tier].tile(z,x,y,controller.signal);
    return {data:data||new ArrayBuffer(0)};
  };
}
