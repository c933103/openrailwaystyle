import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createInspectorRows, createFeatureInspector} from '../styles/feature-inspector.mjs';
import {renderLegendUI} from '../styles/legend-ui.mjs';

function ui() {
  const dom = new JSDOM('<div id="legend"></div><section id="details"><div id="detail-content"></div></section>');
  const document = dom.window.document, $ = id => document.getElementById(id);
  const textNode = (tag, value, className) => {
    const node = document.createElement(tag); node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  return {dom, document, $, textNode, ...createInspectorRows(textNode)};
}

test('inspector rows retain zero and render recorded markup as text', () => {
  const f = ui();
  try {
    const dl = f.document.createElement('dl');
    for (const value of [undefined, null, '']) f.row(dl, 'Omitted', value);
    f.row(dl, 'Zero', 0); f.row(dl, 'Recorded', '<img src=x onerror=alert(1)>');
    assert.deepEqual([...dl.querySelectorAll('dt')].map(n => n.textContent), ['Zero', 'Recorded']);
    assert.equal(dl.querySelector('dd').textContent, '0'); assert.equal(dl.querySelector('img'), null);
  } finally { f.dom.window.close(); }
});

test('legend redraw preserves displayed disclosures before queued toggle events', () => {
  const f = ui(), legendState = {help:false, service:false};
  try {
    const options = {...f, settings:{mode:'service', units:'metric'}, inView:[], legendState,
      serviceDataStatus:{state:'loading'}, periodCovered:() => false};
    renderLegendUI(options);
    f.$('legend').querySelector('details.legend-help').open = true;
    f.$('service-data-status').open = true;
    renderLegendUI(options);
    assert.equal(f.$('legend').querySelector('details.legend-help').open, true);
    assert.equal(f.$('service-data-status').open, true);
    options.settings.mode = 'infrastructure'; renderLegendUI(options);
    assert.equal(f.$('service-data-status'), null);
    options.settings.mode = 'service'; renderLegendUI(options);
    assert.equal(f.$('service-data-status').open, true);
  } finally { f.dom.window.close(); }
});

test('late crossing lookup cannot replace a different selected feature', async () => {
  const f = ui(); let resolve, selected;
  try {
    const inspector = createFeatureInspector({...f, settings:{language:'en'}, osmLink:() => {},
      signalSources:() => [], getCurrentFeature:() => selected,
      nearestCrossing:() => new Promise(done => {resolve = done;}), crossingDataHasTags:async () => true});
    selected = {sourceLayer:'level_crossings', properties:{}, clickLngLat:[0,0]};
    inspector.showInfrastructureContext(selected);
    selected = {source:'electricSubstations', properties:{ref:'Second selection'}};
    inspector.showPowerFacilityDetails(selected);
    resolve({id:1, properties:{kind:'foot'}});
    await Promise.resolve();
    assert.equal(f.$('detail-content').querySelector('h2').textContent, 'Second selection');
  } finally { f.dom.window.close(); }
});

test('extracted Power UI retains energy context evidence and network legend',()=>{
 const f=ui();try{
  const settings={mode:'electrification',language:'en',units:'metric'};
  renderLegendUI({...f,settings,inView:[],legendState:{help:false,service:false},periodCovered:()=>false});
  assert.match(f.$('legend').textContent,/Fuel or gas pipeline/);
  assert.match(f.$('legend').textContent,/Explicit traction supply circuit/);
  const inspector=createFeatureInspector({...f,settings,osmLink:()=>{},signalSources:()=>[],getCurrentFeature:()=>null});
  inspector.showPowerFacilityDetails({source:'energyNetworkDetail',properties:{energy_kind:'battery_storage',supply_tier:'civil_network',siding_evidence:'Not recorded',power_state:'present',fuel:'hvo;diesel'}});
  const text=f.$('detail-content').textContent;assert.match(text,/battery storage/);assert.match(text,/Civil network/);assert.match(text,/Not recorded/);assert.match(text,/hvo;diesel/);
 }finally{f.dom.window.close();}
});
