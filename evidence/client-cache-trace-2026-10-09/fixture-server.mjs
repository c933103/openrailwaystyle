// Cache-enabled, route-free fixture transport. Never forwards a request.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import geojsonvt from 'geojson-vt';
import {ormVectorFixture} from './source/scripts/orm-vector-fixture.mjs';
import {pmtilesFixtureResponse} from './source/scripts/pmtiles-browser-fixture.mjs';
import {RAIL_TILE_RANGES} from './source/styles/rail-source-catalog.mjs';
export const sha256=b=>createHash('sha256').update(b).digest('hex');
export const fixtureLine={type:'Feature',properties:{id:'fixture-wuhan-mainline',feature:'rail',railway:'rail',state:'present',usage:'main',service:'',maxspeed:250,gaugeint0:1435},geometry:{type:'LineString',coordinates:[[113.8,30.42],[114.35,30.58],[114.92,30.65]]}};
const indexes=Object.fromEntries(['speed_railway_line_low','standard_railway_line_low','railway_line_high'].map(layer=>[layer,geojsonvt({type:'FeatureCollection',features:[fixtureLine]},{maxZoom:16,indexMaxZoom:7,extent:4096,buffer:64})]));
const known=new Set([...Object.keys(RAIL_TILE_RANGES),'standard_railway_grouped_station_areas']);
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
export async function serveFixture({root=resolve('source/styles')}={}){
 const state={sample:'setup',phase:'setup',epoch:0};
 const requests=[],denied=[],unknown=[],origins={},relocations=new Map(),served=new Map(),servers=[];
 async function listen(handler){const s=createServer(handler);await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});s.origin=`http://127.0.0.1:${s.address().port}`;servers.push(s);return s;}
 function relocate(bytes){let s=bytes.toString();for(const[from,to]of Object.entries(origins))if(from!=='first-party')s=s.replaceAll(from,to);return Buffer.from(s);}
 const csp=()=>"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; connect-src 'self' "+Object.values(origins).join(' ')+" data: blob:; img-src 'self' data: blob: "+Object.values(origins).join(' ')+"; style-src 'self' 'unsafe-inline'; font-src 'self' data: "+Object.values(origins).join(' ')+"; worker-src 'self' blob:; object-src 'none'; base-uri 'self'";
 async function handle(kind,req,res){
  const url=new URL(req.url,'http://fixture'),path=decodeURIComponent(url.pathname).replace(/^\/atlas-project\//,'/');
  const row={id:requests.length+1,...state,origin:kind,path:url.pathname+url.search,method:req.method,range:req.headers.range||null,ifNoneMatch:req.headers['if-none-match']||null,startMs:performance.now()};requests.push(row);
  res.on('finish',()=>{row.finishMs=performance.now();row.elapsedMs=row.finishMs-row.startMs;row.finished=true;});res.on('close',()=>{row.closeMs=performance.now();row.prematureClose=!res.writableFinished;});
  let status=200,body=Buffer.alloc(0),headers={},cache='public, max-age=3600';
  try{
   assert.ok(['GET','HEAD'].includes(req.method),'Unsupported fixture method');
   if(path.startsWith('/__controls/')){body=Buffer.from('cache-transport-proof-v1');headers['content-type']='text/plain';if(path.endsWith('/revalidate'))cache='public, max-age=0, must-revalidate';}
   else if(kind==='https://openrailwaymap.app'){
    assert.ok(known.has(path.split('/')[1]),'Unknown ORM endpoint');const tile=ormVectorFixture(path,indexes);assert.ok(tile,'Known catalogue sources must use direct XYZ, not metadata');body=tile.body;headers['content-type']=tile.contentType;
   }else if(kind==='https://tuiles.enliberte.fr'){
    if(path==='/planet.pmtiles')({status,body,headers}=pmtilesFixtureResponse(req.headers.range));
    else if(/^\/fonts\/[^/]+\/0-255\.pbf$/.test(path)){body=await readFile('source/tests/fixtures/browser-glyphs/0-255.pbf');headers['content-type']='application/x-protobuf';}
    else throw Error('Unexpected basemap request');
   }else if(path.startsWith('/data/')){body=Buffer.from(JSON.stringify({tiles:[],features:[],countries:{}}));headers['content-type']='application/json';}
   else if(path==='/major-stations.geojson'){body=Buffer.from('{"type":"FeatureCollection","features":[]}');headers['content-type']='application/geo+json';}
   else{
    const file=resolve(root,'.'+path.replace(/\/$/,'/index.html'));assert.ok(file.startsWith(root+'/'),'Path outside fixture root');
    const original=await readFile(file);body=original;headers['content-type']=types[extname(file)]||'application/octet-stream';
    if(/\.(?:mjs|js|json|html|css)$/.test(file))body=relocate(original);
    if(file.endsWith('/index.html'))cache='no-store';
    if(!body.equals(original))relocations.set(relative(root,file),{path:relative(root,file),originalSha256:sha256(original),servedSha256:sha256(body),originalBytes:original.length,servedBytes:body.length});
   }
   body=Buffer.from(body);headers.etag ||= '"'+sha256(body)+'"';
   if(req.headers['if-none-match']===headers.etag){status=304;body=Buffer.alloc(0);}
   Object.assign(headers,{'cache-control':cache,'access-control-allow-origin':'*','access-control-expose-headers':'*','timing-allow-origin':'*','content-length':String(body.length),'content-security-policy':csp()});
   Object.assign(row,{status,bodyBytes:req.method==='HEAD'?0:body.length,entityBytes:body.length,bodySha256:sha256(body),cacheControl:cache,etag:headers.etag});
   if(status!==304)served.set(kind+path,{origin:kind,path,bytes:body.length,sha256:sha256(body),status});
   res.writeHead(status,headers).end(req.method==='HEAD'?undefined:body);
  }catch(error){Object.assign(row,{status:500,error:error.message});unknown.push(row);res.writeHead(500,{'cache-control':'no-store'}).end('Fixture contract violation');}
 }
 for(const kind of['https://openrailwaymap.app','https://tuiles.enliberte.fr','first-party'])origins[kind]=(await listen((q,s)=>handle(kind,q,s))).origin;
 const proxy=await listen((q,s)=>{denied.push({...state,method:q.method,url:q.url,at:performance.now()});s.writeHead(403).end('No external transport allowed');});
 proxy.on('connect',(q,s)=>{denied.push({...state,method:'CONNECT',url:q.url,at:performance.now()});s.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');});
 return {state,requests,denied,unknown,origins,relocations,served,proxy:proxy.origin,app:origins['first-party'],relocate,
  normalizeUrl(url){for(const[key,value]of Object.entries(origins))if(url.startsWith(value))return(key==='first-party'?'http://atlas.fixture':key)+url.slice(value.length);return url;},
  async close(){for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}}
 };
}
