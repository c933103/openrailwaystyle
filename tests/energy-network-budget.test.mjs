import test from 'node:test';import assert from 'node:assert/strict';
import {largestWindow} from '../scripts/measure-energy-network.mjs';
test('viewport budget adds independent bundles and wraps at the dateline',()=>{
 const weights=new Map([['0/1',100000],['3/1',200000],['2/3',1000]]);
 const result=largestWindow(weights,2,2,1);assert.equal(result.bytes,300000);assert.equal(result.bundles,2);assert.equal(result.origin,'3/1');
});
test('viewport budget never counts a wrapped bundle twice',()=>{
 assert.equal(largestWindow(new Map([['0/0',7]]),0,10,10).bytes,7);
});
