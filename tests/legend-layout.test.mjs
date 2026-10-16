import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {assertLegendFits,assertLegacyLegendOverflows} from '../scripts/legend-layout.mjs';

const css=readFileSync(new URL('../styles/app.css',import.meta.url),'utf8');

// This checks the CSS contract, not pixel layout. The fixture-safe signal/power
// browser check measures the actual desktop/mobile grid, text and scroll boxes.
test('long lifecycle samples get a whole legend row without shrinking their pattern',()=>{
  const dom=new JSDOM(`<style>${css}</style><aside class="panel"><div id="controls"><div id="legend"><div class="legend-grid">
    <div class="legend-item"><span class="swatch"></span><span>Not electrified</span></div>
    <div class="legend-item"><span class="point-swatch paired"></span><span>Electricity supply</span></div>
    <div class="legend-item"><span class="swatch pattern-swatch"><svg></svg></span><span>Construction</span></div>
  </div></div></div></aside>`);
  try {
    const {document,getComputedStyle}=dom.window;
    const rows=[...document.querySelectorAll('.legend-item')];
    assert.equal(getComputedStyle(rows[2]).gridColumn,'1 / -1');
    for(const row of rows.slice(0,2))assert.equal(getComputedStyle(row).gridColumn,'','ordinary entries retain the two-column layout');
    assert.equal(getComputedStyle(document.querySelector('.legend-grid')).gridTemplateColumns,'1fr 1fr');
    assert.equal(getComputedStyle(document.querySelector('.pattern-swatch')).width,'62px');
    assert.equal(getComputedStyle(document.querySelector('.pattern-swatch svg')).width,'62px');
    assert.equal(getComputedStyle(document.querySelector('.point-swatch.paired')).width,'36px');
    assert.equal(getComputedStyle(document.querySelector('.panel')).overflow,'auto','vertical scrolling remains available');
  } finally {dom.window.close();}
});

const measuredLayout=()=>({
  panel:{scrollLeft:0,clientWidth:308,scrollWidth:308},
  grid:{left:39,right:296,width:257,clientWidth:257,scrollWidth:257},
  rows:[{label:'Construction',row:{left:39,right:296,width:257},
    text:{left:109,right:176,width:67},lines:[{left:109,right:176,width:67,height:15}]}],
});

test('old-layout control accepts the exact grid assertion and rejects unrelated failures',()=>{
  const fixed=measuredLayout();assert.doesNotThrow(()=>assertLegendFits(fixed));
  const broken=structuredClone(fixed);broken.grid.scrollWidth=279;
  assert.throws(()=>assertLegendFits(broken),{code:'ERR_ASSERTION',message:'legend content stays inside its grid'});
  assert.doesNotThrow(()=>assertLegacyLegendOverflows(broken));
  assert.throws(()=>assertLegacyLegendOverflows(fixed),'a control that still fits must fail');
  const panned=structuredClone(broken);panned.panel.scrollLeft=4;
  assert.throws(()=>assertLegacyLegendOverflows(panned),'an unrelated earlier failure cannot satisfy the grid-overflow control');
});

test('geometry assertions retain panel, row, visible-text and text-range failure paths',()=>{
  for(const [name,mutate] of [
    ['panel overflow',x=>{x.panel.scrollWidth=312;}],
    ['empty rows',x=>{x.rows=[];}],
    ['hidden row',x=>{x.rows[0].row.width=0;}],
    ['row outside grid',x=>{x.rows[0].row.right=300;}],
    ['text outside row',x=>{x.rows[0].text.right=300;}],
    ['missing text',x=>{x.rows[0].lines=[];}],
    ['clipped text',x=>{x.rows[0].lines[0].right=180;}],
  ]){
    const layout=measuredLayout();mutate(layout);
    assert.throws(()=>assertLegendFits(layout),{code:'ERR_ASSERTION'},name);
  }
});
