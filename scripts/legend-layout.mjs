import assert from 'node:assert/strict';

export const assertLegendFits=layout=>{
    assert.equal(layout.panel.scrollLeft,0,'legend is readable without horizontal panning');
    assert.ok(layout.panel.scrollWidth<=layout.panel.clientWidth,'panel has no horizontal overflow');
    assert.ok(layout.grid.scrollWidth<=layout.grid.clientWidth,'legend content stays inside its grid');
    assert.ok(layout.rows.length>0,'legend measurements are nonempty');
    for(const {label,row,text,lines} of layout.rows){
      assert.ok(row.width>0&&text.width>0,`${label}: row and text are visible`);
      assert.ok(row.left>=layout.grid.left&&row.right<=layout.grid.right,`${label}: row fits the grid`);
      assert.ok(text.left>=row.left&&text.right<=row.right,`${label}: full text box fits its row`);
      assert.ok(lines.length>0&&lines.every(line=>line.width>0&&line.height>0),`${label}: rendered text is nonempty`);
      assert.ok(lines.every(line=>line.left>=text.left&&line.right<=text.right),`${label}: text is not clipped or overflowing`);
    }
  };

export function assertLegacyLegendOverflows(layout) {
  assert.throws(()=>assertLegendFits(layout),{
    code:'ERR_ASSERTION',message:'legend content stays inside its grid',
  },'restoring the preceding lifecycle placement must fail the grid-overflow check');
}
