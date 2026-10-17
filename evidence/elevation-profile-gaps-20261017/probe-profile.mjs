// node probe-profile.mjs /path/to/source source-identity
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
const source = pathToFileURL(resolve(process.argv[2]) + '/');
const {JSDOM} = await import(new URL('node_modules/jsdom/lib/api.js', source));
const elevation = await import(new URL('styles/elevation.mjs', source));
const {formatLength} = await import(new URL('styles/draw.mjs', source));
const app = await readFile(new URL('styles/app.mjs', source), 'utf8');
const begin = app.indexOf('function profileChart('), end = app.indexOf('\nfunction closeDetails()', begin);
if (begin < 0 || end <= begin) throw new Error('Missing actual profile renderer');
const dom = new JSDOM('<body></body>');
const context = vm.createContext({document: dom.window.document, formatLength, profileSegments: elevation.profileSegments});
vm.runInContext(app.slice(begin, end), context);
const profile = [{at: 0, height: 0, point: [0, 0]}, {at: .05, height: null, point: [.001, 0]}, {at: .1, height: 100, point: [.002, 0]}];
const chart = context.profileChart(profile, .1, 'metric');
console.log(JSON.stringify({source: process.argv[3], profile, stats: elevation.profileStats(profile), lines: [...chart.querySelectorAll('polyline')].map(el => el.getAttribute('points')), areaCount: chart.querySelectorAll('polygon').length, isolatedPoints: chart.querySelectorAll('circle').length}, null, 2));
dom.window.close();
