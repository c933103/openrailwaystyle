// Conservative cold-cache, north-up flat viewport accounting for the optional overlay.
// This is separate from the per-file limit. Pitched/globe renderer requests
// still need a browser measurement before worldwide publication.
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ENERGY_TIERS} from '../styles/energy-network.mjs';
export function largestWindow(weights,zoom,columns,rows){
 const n=2**zoom,cols=Math.min(n,columns),height=Math.min(n,rows),wrap=x=>(x%n+n)%n;
 const candidates=new Set();
 for(const key of weights.keys()){
  const [x,y]=key.split('/').map(Number);
  for(let dx=0;dx<cols;dx++)for(let dy=0;dy<height;dy++)candidates.add(`${wrap(x-dx)}/${Math.max(0,Math.min(n-height,y-dy))}`);
 }
 let largest={bytes:0,bundles:0,origin:null};
 for(const key of candidates){const [x,y]=key.split('/').map(Number);let bytes=0,bundles=0;
  for(let dx=0;dx<cols;dx++)for(let dy=0;dy<height;dy++){const size=weights.get(`${wrap(x+dx)}/${y+dy}`);if(size!==undefined){bytes+=size;bundles++;}}
  if(bytes>largest.bytes)largest={bytes,bundles,origin:key};
 }
 return largest;
}
export async function measureEnergyNetwork(root,{width=1365,height=900,budget=350000}={}){
 const manifestBytes=(await stat(join(root,'manifest.json'))).size,tiers=[];
 for(const [name,{minzoom,maxzoom,bundleZoom}] of Object.entries(ENERGY_TIERS)){
  const file=join(root,name,'index.json'),raw=await readFile(file),index=JSON.parse(raw),weights=new Map();
  for(const key of index.bundles)weights.set(key,(await stat(join(root,name,String(bundleZoom),key+'.bundle.gz'))).size);
  for(let zoom=minzoom;zoom<=maxzoom;zoom++){
   // 256 CSS pixels allows a factor-two zoom transition for 512-pixel
   // vector tiles. One extra tile in each direction covers edge alignment.
   const scale=2**(zoom-bundleZoom),columns=Math.ceil((Math.ceil(width/256)+1)/scale)+1,rows=Math.ceil((Math.ceil(height/256)+1)/scale)+1;
   const largest=largestWindow(weights,bundleZoom,columns,rows),bytes=largest.bytes+raw.length+manifestBytes;
   tiers.push({tier:name,zoom,...largest,bytes,metadataBytes:raw.length+manifestBytes,withinBudget:bytes<budget});
  }
 }
 return {schema:1,viewport:{width,height,pitch:0,bearing:0},budget,kind:'conservative cold north-up flat-viewport bound',rotatedViewsVerified:false,pitchedAndGlobeVerified:false,withinBudget:tiers.every(t=>t.withinBudget),tiers};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)console.log(JSON.stringify(await measureEnergyNetwork(process.argv[2]),null,2));
