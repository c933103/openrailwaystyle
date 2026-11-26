import test from 'node:test';
import assert from 'node:assert/strict';
import {flatFailure,flatRetryDue,flatHttpError,canvasMapStatus} from '../styles/flat-recovery.mjs';
test('Canvas recovery honors provider dates, avoids unexpected probing and stops after three retries',()=>{
 for (const status of [429,503]) {
  const now=1000;
  const error=flatHttpError(new Response('',{status,headers:{'retry-after':'60'}}),'json');
  const failure=flatFailure(error,0,now);
  assert.equal(failure.due,61000);
  assert.equal(flatRetryDue(failure,now,true),false);
  assert.equal(flatRetryDue(failure,60999),false);
  assert.equal(flatRetryDue(failure,61000),true);
 }
 for (const err of [new DOMException('Request cancelled','AbortError'),new Error('Tile arrayBuffer returned 404')])
  assert.equal(flatFailure(err,0,0).due,Infinity);
 const invalid=Object.assign(new Error('provider returned an invalid vector tile'),{name:'ProviderDataError'});
 assert.equal(flatRetryDue(flatFailure(invalid,0,0),0,true),false);
 for(const retries of [0,1,2,3])
  assert.equal(flatFailure(new TypeError('Failed to fetch'),retries,200).due,[5200,15200,45200,Infinity][retries]);
});
test('Canvas reports an auxiliary-only bathymetry failure without masking mixed and railway failures',()=>{
 const state={loading:false,clamped:false,railFallback:false};
 assert.match(canvasMapStatus({...state,errors:['bathymetry']}),/Seabed shading may be incomplete/);
 assert.match(canvasMapStatus({...state,errors:['bathymetry','openmaptiles']}),/visible tile data/);
 assert.match(canvasMapStatus({...state,errors:['bathymetry','entryRail'],railFallback:true}),/Neutral reference/);
});
