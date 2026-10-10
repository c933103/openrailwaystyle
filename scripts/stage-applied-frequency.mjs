// Validate the exact, owned aggregate copy before an artifact is uploaded.
// Publication metadata must already be safe; verify the input digest before
// producing a canonical gzip and binding the uploaded manifest to its bytes.
import {readFile,stat,writeFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {resolve} from 'node:path';
import {indexTimetableSections} from './timetable-frequency.mjs';
import {publishedMetadata} from './assemble-global-frequency.mjs';
export const MAX_APPLIED_BYTES=512_000_000;
export function validateAppliedFrequency(bytes,manifest){
 const binding=manifest?.applied_profiles;
 if(!binding||binding.schema!==1||binding.file!=='profiles.json.gz'||! /^[a-f0-9]{64}$/.test(binding.sha256)||! /^[a-f0-9]{64}$/.test(binding.osm_sha256)||!Number.isSafeInteger(binding.sections)||binding.sections<0||bytes.length>MAX_APPLIED_BYTES||createHash('sha256').update(bytes).digest('hex')!==binding.sha256)throw new Error('Invalid applied profile binding');
 const artifact=JSON.parse(gunzipSync(bytes,{maxOutputLength:MAX_APPLIED_BYTES}).toString());
 indexTimetableSections(artifact);
 if(artifact.osm_sha256!==binding.osm_sha256||artifact.sections.length!==binding.sections||!Array.isArray(artifact.feeds)||!artifact.matching||artifact.matching.sections!==artifact.sections.length||!isDeepStrictEqual(artifact,publishedMetadata(artifact)))throw new Error('Invalid applied profile publication');
 return artifact;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 try{
  const [manifestPath,profilePath]=process.argv.slice(2),[m,p]=await Promise.all([stat(manifestPath),stat(profilePath)]);
  if(!m.isFile()||!p.isFile()||m.size>64*1024*1024||p.size>MAX_APPLIED_BYTES)throw new Error('Invalid applied profile file');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),artifact=validateAppliedFrequency(await readFile(profilePath),manifest);
  // Own the gzip wrapper too: ignored header/trailing bytes are not uploaded.
  const bytes=gzipSync(JSON.stringify(artifact),{level:9});
  manifest.applied_profiles.sha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(profilePath,bytes);await writeFile(manifestPath,JSON.stringify(manifest)+'\n');
 }catch{process.stderr.write('Invalid applied timetable artifact\n');process.exitCode=1;}
}
