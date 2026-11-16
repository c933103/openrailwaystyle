// Optional, immutable NASA Blue Marble polar composite. One bounded request per
// missing cap; cached dimension-checked bytes are reused indefinitely. No tile probes.
export const POLAR_SATELLITE = Object.freeze({format:'gibs-blue-marble-polar-v1', size:1024, extent:1048576,
  source:'NASA EOSDIS GIBS / NASA Earth Observatory', product:'BlueMarble_NextGeneration', observation:'2004 composite'});
export function polarSatelliteURL(cap) {
  if (!['north','south'].includes(cap)) throw new Error('Invalid polar cap');
  const epsg=cap==='north'?3413:3031, e=POLAR_SATELLITE.extent;
  const url=new URL(`https://gibs.earthdata.nasa.gov/wms/epsg${epsg}/best/wms.cgi`);
  url.search=new URLSearchParams({SERVICE:'WMS',REQUEST:'GetMap',VERSION:'1.1.1',LAYERS:POLAR_SATELLITE.product,
    STYLES:'',FORMAT:'image/jpeg',SRS:`EPSG:${epsg}`,BBOX:`${-e},${-e},${e},${e}`,WIDTH:'1024',HEIGHT:'1024'});
  return url.href;
}
// Check envelope markers and declared dimensions before publishing. The
// browser decoder separately rejects corrupt compressed image scans.
export function validatePolarSatellite(bytes) {
  if (bytes.length>8*1024*1024 || bytes.length<10 || bytes[0]!==255 || bytes[1]!==216 || bytes.at(-2)!==255 || bytes.at(-1)!==217)
    throw new Error('Invalid polar satellite JPEG');
  let offset=2;
  while(offset+4<=bytes.length) {
    if(bytes[offset++]!==255)throw new Error('Invalid JPEG marker');
    while(bytes[offset]===255)offset++;
    const marker=bytes[offset++];
    if(marker===218 || marker===217)break;
    const size=bytes[offset]*256+bytes[offset+1];
    if(size<2 || offset+size>bytes.length)throw new Error('Truncated JPEG segment');
    if([192,193,194].includes(marker)) {
      const h=bytes[offset+3]*256+bytes[offset+4],w=bytes[offset+5]*256+bytes[offset+6];
      if(size<8 || w!==1024 || h!==1024)throw new Error('Polar satellite dimensions must be 1024 square');
      return bytes;
    }
    offset+=size;
  }
  throw new Error('Missing JPEG dimensions');
}
export async function fetchPolarSatellite(cap,{fetcher=fetch,signal=AbortSignal.timeout(60000)}={}) {
  const response=await fetcher(polarSatelliteURL(cap),{signal,redirect:'error',headers:{'User-Agent':'RailwayAtlas-polar/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
  if(!response.ok || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type')||''))throw new Error(`Polar imagery HTTP ${response.status}`);
  const reader=response.body.getReader(),chunks=[];let length=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8*1024*1024)throw new Error('Polar imagery exceeds 8 MiB');chunks.push(value);}
  }catch(error){Promise.resolve(reader.cancel()).catch(()=>{});throw error;}finally{reader.releaseLock();}
  return validatePolarSatellite(Buffer.concat(chunks));
}
