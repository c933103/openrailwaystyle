// Shared railway filters. Source data and zoom thresholds are unchanged.
export const present = ['==', ['coalesce', ['get', 'state'], 'present'], 'present'];
export const notFerry = ['!=', ['get', 'feature'], 'ferry'];
export const hasService = ['!=',['coalesce',['get','service'],''],''];
// rack=* on the provider's detailed lines: any rack system (abt, strub, yes…), not no.
export const hasRack = ['!',['in',['downcase',['coalesce',['get','rack'],'no']],['literal',['no','']]]];
// The renderer and reference-only status use identical type/zoom thresholds.
export {byKindZoom} from '../../../styles/railway-visibility.mjs';
