import http from 'node:http';
import {stat,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,extname} from 'node:path';
const root=resolve('styles');
http.createServer(async(req,res)=>{
  try {
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
    if(!path.startsWith(root+'/')) {res.writeHead(403).end();return;}
    const info=await stat(path);
    const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.pmtiles':'application/octet-stream'}[extname(path)]||'application/octet-stream';
    const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if(range){const start=+range[1],end=Math.min(range[2]?+range[2]:info.size-1,info.size-1);if(start> end){res.writeHead(416).end();return;}res.writeHead(206,{'Content-Type':mime,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});createReadStream(path,{start,end}).pipe(res);}
    else {res.writeHead(200,{'Content-Type':mime,'Content-Length':info.size,'Accept-Ranges':'bytes'});createReadStream(path).pipe(res);}
  } catch {res.writeHead(404).end();}
}).listen(4173,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:4173'));
