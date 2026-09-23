import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('styles/vendor',{recursive:true});
await build({entryPoints:['styles/tile-labels.mjs'],outfile:'styles/vendor/tile-labels.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await copyFile('node_modules/maplibre-contour/dist/index.min.js','styles/vendor/maplibre-contour.js');
await copyFile('node_modules/maplibre-contour/LICENSE','styles/vendor/maplibre-contour-LICENSE.txt');
for (const [source,target] of [['vt-pbf/LICENSE','vt-pbf-LICENSE.txt'],['pbf/LICENSE','pbf-LICENSE.txt'],['@mapbox/vector-tile/LICENSE.txt','vector-tile-LICENSE.txt']]) await copyFile(`node_modules/${source}`,`styles/vendor/${target}`);
