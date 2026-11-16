// Validate an optional published snapshot before adding it to the site.
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {ENERGY_TIERS} from '../styles/energy-network.mjs';
import {decodeBundle,BUNDLE_FORMAT} from '../styles/tile-bundles.mjs';
export async function validateEnergyNetwork(root) {
 const manifest=JSON.parse(await readFile(join(root,'manifest.json')));
 if(manifest.schema!==2||manifest.dataset!=='energy-network'||manifest.complete!==true||manifest.format!==BUNDLE_FORMAT||manifest.minzoom!==5||manifest.maxzoom!==14||!manifest.selectionFilters?.region||!manifest.selectionFilters?.gap)throw new Error('Incomplete energy network manifest');
 let count=0,bytes=0;
 for(const [tier,{bundleZoom:zoom,minzoom,maxzoom}] of Object.entries(ENERGY_TIERS)){
  const index=JSON.parse(await readFile(join(root,tier,'index.json')));
  if(index.format!==BUNDLE_FORMAT||index.zoom!==zoom||!Array.isArray(index.bundles)||new Set(index.bundles).size!==index.bundles.length)throw new Error('Invalid energy bundle index');
  for(const key of index.bundles){
   if(!/^\d+\/\d+$/.test(key)||key.split('/').some(n=>Number(n)>=2**zoom))throw new Error('Invalid energy bundle path');
   const file=join(root,tier,String(zoom),key+'.bundle.gz'),size=(await stat(file)).size;
   if(size>=350000)throw new Error('Energy bundle exceeds 350 KB');
   const tiles=decodeBundle(gunzipSync(await readFile(file)));
   if(!tiles.size)throw new Error('Empty energy bundle');
   for(const coordinate of tiles.keys()){
    const [z,x,y]=coordinate.split('/').map(Number),[bx,by]=key.split('/').map(Number);
    if((z<minzoom||z>maxzoom)||(x>>(z-zoom))!==bx||(y>>(z-zoom))!==by)throw new Error('Energy tile outside bundle');
   }
   count++;bytes+=size;
  }
 }
 if(count!==manifest.bundles||bytes!==manifest.bytes||!count)throw new Error('Energy bundle count or size mismatch');
 return manifest;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await validateEnergyNetwork(process.argv[2]);
