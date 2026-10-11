// Serve actual built app files at both root and project URLs. Only map data is
// synthetic; JS/CSS/manifest/icons always come from the built site over HTTP.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function serveAtlasAppFixture() {
  const root=fileURLToPath(new URL('../styles/',import.meta.url));
  const server=createServer(async(req,res)=>{
    try {
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
        .replace(/^\/atlas-project\//,'/');
      const file=resolve(root,'.'+pathname.replace(/\/$/,'/index.html'));
      if(!file.startsWith(root)){res.writeHead(403).end();return;}
      let body,type;
      if(pathname.startsWith('/data/')){
        body=Buffer.from(JSON.stringify({tiles:[],features:[],countries:{}}));type='application/json';
      }else if(pathname==='/major-stations.geojson'){
        body=Buffer.from('{"type":"FeatureCollection","features":[]}');type='application/geo+json';
      }else{
        body=await readFile(file);
        type={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css',
          '.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml',
          '.png':'image/png','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream';
      }
      res.writeHead(200,{'content-type':type,'content-length':body.length,'cache-control':'no-store'});
      res.end(req.method==='HEAD'?undefined:body);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {
    origin:`http://127.0.0.1:${server.address().port}`,
    close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  };
}
