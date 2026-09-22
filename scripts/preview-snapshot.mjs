// CI review fixture only: read completed East Asia extraction without an API call.
// Never publish this partial archive to the site or the rail-data branch.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {gzipSync} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {toGeoJSON} from './lifecycle.mjs';
const data=toGeoJSON(JSON.parse(await readFile('.snapshot-cache/0_90_45_135.json','utf8')));
if(!data.features.some(f=>/남부내륙/.test(f.properties.name))) throw new Error('Named regression line absent');
await mkdir('snapshot',{recursive:true});
await writeFile('snapshot/manifest.json',JSON.stringify({coverage:'EAST ASIA REVIEW FIXTURE ONLY',features:data.features.length}));
await writeFile('snapshot/lifecycle.geojson.gz',gzipSync(JSON.stringify(data)));
const index=geojsonvt(data,{maxZoom:10,indexMaxZoom:4,indexMaxPoints:100000,tolerance:1,extent:4096,buffer:128});
const out=createWriteStream('snapshot/tiles.jsonl');let count=0;
async function visit(z,x,y){
 const tile=index.getTile(z,x,y);if(!tile?.features.length)return;
 if(z>=5){const encoded=gzipSync(vtpbf.fromGeojsonVt({lifecycle:tile})).toString('base64');if(!out.write(JSON.stringify([z,x,y,encoded])+'\n'))await once(out,'drain');count++;}
 if(z<10)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)await visit(z+1,x*2+dx,y*2+dy);
}
await visit(0,0,0);out.end();await once(out,'finish');console.log('Review fixture tiles',count);
