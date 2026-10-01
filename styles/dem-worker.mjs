// The contour worker (maplibre-contour's own, built from its source) with
// the terrain tiles repaired as they arrive (dem-repair.mjs), for both the
// contours and the relief shading, which reads its tiles through this
// worker. A tile that needs no repair is passed on as it came.
import Actor from '../node_modules/maplibre-contour/src/actor.ts';
import WorkerDispatch from '../node_modules/maplibre-contour/src/worker-dispatch.ts';
import {LocalDemManager} from '../node_modules/maplibre-contour/src/local-dem-manager.ts';
import {REPAIR_FROM, referenceTile, repairPixels} from './dem-repair.mjs';

const TILE = /\/(\d+)\/(\d+)\/(\d+)\.png(?=\?|$)/, KEEP = 32;
const decode = async blob => {
  const image = await createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
  const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d', {willReadFrequently: true});
  context.drawImage(image, 0, 0); image.close?.();
  return {canvas, context, pixels: context.getImageData(0, 0, canvas.width, canvas.height)};
};
// The coarser tiles, shared by the sixteen tiles each covers.
const references = new Map();
function reference(url) {
  if (references.has(url)) { const kept = references.get(url); references.delete(url); references.set(url, kept); return kept; }
  const loading = fetch(url).then(async response => response.ok ? (await decode(await response.blob())).pixels : null).catch(() => null);
  references.set(url, loading);
  while (references.size > KEEP) references.delete(references.keys().next().value);
  return loading;
}
async function getTile(url, abortController) {
  const response = await fetch(url, {signal: abortController.signal});
  if (!response.ok) throw new Error(`Bad response: ${response.status} for ${url}`);
  const blob = await response.blob(), tile = {data: blob, expires: response.headers.get('expires') || undefined, cacheControl: response.headers.get('cache-control') || undefined};
  const match = url.match(TILE), [z, x, y] = match ? match.slice(1).map(Number) : [];
  if (!match || z < REPAIR_FROM || typeof OffscreenCanvas === 'undefined') return tile;
  try {
    const coarser = referenceTile(z, x, y);
    const [{canvas, context, pixels}, ref] = await Promise.all([decode(blob), reference(url.replace(TILE, `/${coarser.z}/${coarser.x}/${coarser.y}.png`))]);
    if (!repairPixels(pixels.data, pixels.width, z, x, y, ref?.data, ref?.width)) return tile;
    context.putImageData(pixels, 0, 0);
    return {...tile, data: await canvas.convertToBlob({type: 'image/png'})};
  } catch {
    return tile;
  }
}
class RepairingDispatch extends WorkerDispatch {
  init = message => { this.managers[message.managerId] = new LocalDemManager({...message, getTile}); return Promise.resolve(); };
}
self.actor = new Actor(self, new RepairingDispatch());
