import {annotateTracks} from './track-tiles.mjs';
self.onmessage = ({data: {id, data, z, y, stations}}) => {
  try {
    const result = annotateTracks(data, z, y, stations);
    self.postMessage({id, data: result}, [result]);
  } catch (error) {
    self.postMessage({id, error: error?.message || String(error)});
  }
};
