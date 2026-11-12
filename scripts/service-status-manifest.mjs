import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {summarizeServiceAcquisition} from '../styles/service-status.mjs';

export async function serviceAcquisitionForBuild(directory, raw) {
  const snapshotSha256=createHash('sha256').update(raw).digest('hex');
  let manifest;
  try {manifest=JSON.parse(await readFile(`${directory}/manifest.json`,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return {osmSnapshotSha256:snapshotSha256,acquisition:summarizeServiceAcquisition(manifest,snapshotSha256)};
}
