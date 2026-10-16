import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

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
