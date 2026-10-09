// Match the released library distributions byte-for-byte. npm's lockfile
// verifies package archives; these pins also protect immutable browser URLs
// from accidentally receiving a different distribution during a later build.
export const BROWSER_LIBRARIES = [
  {package: 'maplibre-gl', version: '5.24.0', source: 'dist/maplibre-gl.js', target: 'vendor/maplibre-gl-5.24.0.js',
    sha256: '45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb'},
  {package: 'maplibre-gl', version: '5.24.0', source: 'dist/maplibre-gl.css', target: 'vendor/maplibre-gl-5.24.0.css',
    sha256: 'ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732'},
  {package: 'pmtiles', version: '4.2.1', source: 'dist/pmtiles.js', target: 'vendor/pmtiles-4.2.1.js',
    sha256: 'afc49d216fd24c0a3c0ff3cd2e0c62d6cdaf062854c3dced778dcab168824f79'},
];
