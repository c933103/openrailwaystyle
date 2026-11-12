import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import * as elevation from '../../styles/elevation.mjs';
import {lengthKm, formatLength, climb, formatClimb} from '../../styles/draw.mjs';

const app = await readFile(new URL('../../styles/app.mjs', import.meta.url), 'utf8');
const begin = app.indexOf('const elevation = createElevation(DEM_URL);');
const end = app.indexOf("\n$('details-close').addEventListener", begin);
assert.ok(begin >= 0 && end > begin, 'actual profile block delimiters exist');
// Execute the production profile controller and SVG renderer with real DOM
// nodes. Only terrain responses and the map marker are fixtures; no network.
export function profileHarness({heights = points => points.map((_, i) => i), units = 'metric'} = {}) {
  const dom = new JSDOM('<section id="details" hidden><div id="detail-content"></div></section>');
  const document = dom.window.document, $ = id => document.getElementById(id), markers = [];
  const textNode = (tag, text, className) => {
    const node = document.createElement(tag); node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const context = vm.createContext({...elevation, document, $, AbortController, frequencyExpiry: null, settings: {units}, currentFeature: null,
    lengthKm, formatLength, climb, formatClimb, textNode, map: {}, DEM_URL: 'fixture-only',
    createElevation: () => ({heights}),
    row: (dl, label, value) => dl.append(textNode('dt', label), textNode('dd', value)),
    maplibregl: {Marker: class {
      constructor() { markers.push(this); }
      setLngLat(point) { this.point = point; return this; }
      addTo() { this.visible = true; return this; }
      remove() { this.visible = false; }
    }},
  });
  vm.runInContext(app.slice(begin, end), context);
  return {dom, markers, context,
    show: (name = 'Synthetic line', coordinates = [[0, 0], [.002, 0]]) => context.showProfile({properties: {name}, geometry: {type: 'LineString', coordinates}}),
    content: () => $('detail-content'),
    summary: () => Object.fromEntries([...$('detail-content').querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent])),
    dismiss: () => context.closeDetails(),
    close: () => { context.cancelProfile(); dom.window.close(); },
  };
}
