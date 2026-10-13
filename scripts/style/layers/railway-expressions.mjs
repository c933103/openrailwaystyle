// Shared railway filters. Source data and zoom thresholds are unchanged.
export const present = ['==', ['coalesce', ['get', 'state'], 'present'], 'present'];
export const notFerry = ['!=', ['get', 'feature'], 'ferry'];
export const hasService = ['!=',['coalesce',['get','service'],''],''];
// The renderer and reference-only status use identical type/zoom thresholds.
export {byKindZoom} from '../../../styles/railway-visibility.mjs';
