import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
const server=await chromium.launchServer({headless:true,proxy:{server:process.env.HTTPS_PROXY},args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try {
 const child=spawn(process.execPath,['scripts/check-departures-served.tmp.mjs'],{stdio:'inherit',env:{...process.env,MAP_BASE_URL:'https://c933103.github.io/openrailwaystyle/',BROWSER_WS_ENDPOINT:server.wsEndpoint()}});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 process.exitCode=code;
}finally{await server.close();}
