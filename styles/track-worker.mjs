import {countTile} from './track-tiles.mjs';
self.onmessage = ({data: {id, tiles, areas, stations, y}}) => {
  try {
    self.postMessage({id, result: countTile({tiles, areas, stations}, y)});
  } catch (error) {
    self.postMessage({id, error: error?.message || String(error)});
  }
};
