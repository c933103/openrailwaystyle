import {annotateTracks} from './track-tiles.mjs';
self.onmessage = ({data: {id, data, z, y}}) => {
  try {
    const result = annotateTracks(data, z, y);
    self.postMessage({id, data: result}, [result]);
  } catch (error) {
    self.postMessage({id, error: error?.message || String(error)});
  }
};
