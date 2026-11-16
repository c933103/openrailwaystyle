// The contour worker (maplibre-contour's own, built from its source) with
// the terrain tiles repaired as they arrive (dem-repair.mjs), for both the
// contours and the relief shading, which reads its tiles through this
// worker. A pixel still standing out after that is checked against the next
// finer zoom, fetched only then. A tile that needs no repair is passed on as
// it came.
import Actor from '../node_modules/maplibre-contour/src/actor.ts';
import WorkerDispatch from '../node_modules/maplibre-contour/src/worker-dispatch.ts';
import {LocalDemManager} from '../node_modules/maplibre-contour/src/local-dem-manager.ts';
import {createDemTileLoader} from './dem-loader.mjs';

const movement = new Map();
self.addEventListener('message', ({data}) => {
  if (data?.type === 'atlas-viewport' && movement.has(data.managerId) && typeof data.moving === 'boolean') movement.set(data.managerId, data.moving);
});
class RepairingDispatch extends WorkerDispatch {
  init = message => { movement.set(message.managerId, false); this.managers[message.managerId] = new LocalDemManager({...message, getTile:createDemTileLoader({isMoving:() => movement.get(message.managerId) === true})}); return Promise.resolve(); };
}
self.actor = new Actor(self, new RepairingDispatch());
