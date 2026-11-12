// Reviewed source assertions, never guessed translations or corporate suffixes.
// These establish agency/operator context only; route/mode/path checks still run.
import {createHash} from 'node:crypto';

const fields=['id','feed','source_sha256','agency_id','agency_name','agency_url','osm_operators','checked','expires','evidence'];
const record=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const string=(v,empty=false)=>typeof v==='string'&&v.length<=512&&!/[\p{Cc}]/u.test(v)&&(empty||v.trim().length>0);
const url=v=>{try{const u=new URL(v);return string(v)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.href===v;}catch{return false;}};
const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return NaN;const n=Date.parse(v+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===v?n:NaN;};
const dense=(v,max,min=1)=>Array.isArray(v)&&v.length>=min&&v.length<=max&&Array.from({length:v.length},(_,i)=>Object.hasOwn(v,i)).every(Boolean);
const scope=(feed,sha,agency,name,url)=>JSON.stringify([feed,sha,agency,name,url]);

export function operatorBindingIndex(data={schema:1,bindings:[]}){
  const fail=()=>{throw new Error('Invalid reviewed timetable operator bindings');};
  if(!record(data)||!['schema','bindings'].every(k=>Object.prototype.propertyIsEnumerable.call(data,k))||Object.keys(data).some(k=>!['schema','bindings'].includes(k))||data.schema!==1||!dense(data.bindings,1000,0))fail();
  const index=new Map(),ids=new Set();
  for(const b of data.bindings){
    if(!record(b)||Object.keys(b).some(k=>!fields.includes(k))||fields.some(k=>!Object.prototype.propertyIsEnumerable.call(b,k))||
      !string(b.id)||!/^[A-Za-z0-9_.-]{1,128}$/.test(b.id)||ids.has(b.id)||
      !string(b.feed)||!/^[A-Za-z0-9_.-]{1,128}$/.test(b.feed)||! /^[a-f0-9]{64}$/.test(b.source_sha256)||
      !string(b.agency_id,true)||!string(b.agency_name)||!url(b.agency_url)||
      !dense(b.osm_operators,16)||b.osm_operators.some(n=>!string(n))||
      new Set(b.osm_operators).size!==b.osm_operators.length||
      !dense(b.evidence,8)||b.evidence.some(v=>!url(v)))fail();
    const checked=date(b.checked),until=date(b.expires);
    if(!Number.isFinite(checked)||!Number.isFinite(until)||until<=checked||until-checked>366*86400000)fail();
    const key=scope(b.feed,b.source_sha256,b.agency_id,b.agency_name,b.agency_url);
    if(index.has(key))fail();
    ids.add(b.id);index.set(key,{...b,osm_operators:[...b.osm_operators],evidence:[...b.evidence],checkedMillis:checked,untilMillis:until});
  }
  return index;
}

export function operatorBindingForAgency(index,source,agency,now){
  const b=index.get(scope(source.id,source.sha256,agency.agency_id||'',agency.agency_name,agency.agency_url));
  if(!b||!Number.isFinite(now)||now<b.checkedMillis||now>=b.untilMillis)return null;
  // Published feeds preserve the original URL fingerprint. It must agree too;
  // a display URL/hash conflict cannot establish an operator assertion.
  if(agency.agency_url_sha256!==undefined&&agency.agency_url_sha256!==createHash('sha256').update(b.agency_url).digest('hex'))return null;
  return b;
}
