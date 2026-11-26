import test from 'node:test';
import assert from 'node:assert/strict';
import {warmInitialBasemapArchive} from '../styles/basemap-range-source.mjs';

const key='https://maps.example/atlas.pmtiles';
for(const background of ['map','hybrid']){
  test(`initial ${background} background warms one shared header, then preserves retry replacement`,async()=>{
    const archives=[];
    const factory=url=>{
      const archive={url,reads:0,getHeader(){this.reads++;return Promise.reject(new Error('fixture timeout'));}};
      archives.push(archive);return archive;
    };
    const use=warmInitialBasemapArchive(factory,{sourceURL:'pmtiles://'+key,background});
    assert.equal(archives.length,1);
    assert.equal(archives[0].reads,1);
    assert.equal(use('https://maps.example/independent.pmtiles'),archives[1]);
    assert.equal(archives[1].reads,0);
    assert.equal(use(key),archives[0],'first consumer inherits the same archive and promise cache');
    assert.equal(use(key),archives[2],'retry inherits the ordinary fresh-archive path');
    assert.equal(archives[2].reads,0);
    await new Promise(r=>setImmediate(r));
  });
}
test('no speculative archive for a different background or non-archive URL',()=>{
  for(const [background,sourceURL] of [['satellite','pmtiles://'+key],['carto','pmtiles://'+key],['soviet','pmtiles://'+key],['map',key],['map',undefined]]){
    let created=0;
    const use=warmInitialBasemapArchive(url=>{created++;return {url};},{sourceURL,background});
    assert.equal(created,0);
    assert.equal(use(key).url,key);
    assert.equal(created,1);
  }
});
