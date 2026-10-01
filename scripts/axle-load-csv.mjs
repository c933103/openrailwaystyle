// The trailing count makes a timed-out, partial CSV distinguishable from a
// complete result, including a legitimate empty regional result.
export function axleRows(text, columns) {
  const lines=text.trim().split('\n').filter(Boolean),rows=[],ids=new Set();let expected;
  for(const line of lines) {
    const [type,id,count,...values]=line.split('\t');
    if(type==='count') {if(expected!==undefined)throw new Error('Duplicate count');expected=Number(count);continue;}
    if(type!=='way'||!/^\d+$/.test(id)||Number(id)<=0||values.length!==columns||ids.has(id))throw new Error('Invalid axle-load CSV row');
    if(expected!==undefined)throw new Error('Rows after count');ids.add(id);
    rows.push([Number(id),...values.map(s=>s.replace(/^"(.*)"$/,'$1').replaceAll('""','"').trim())]);
  }
  if(!Number.isSafeInteger(expected)||expected!==rows.length)throw new Error('Incomplete axle-load CSV response');
  return rows;
}
