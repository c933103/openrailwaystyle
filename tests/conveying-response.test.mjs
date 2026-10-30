import test from 'node:test';
import assert from 'node:assert/strict';
import {CONVEYING_QUERY, CONVEYING_ERROR_BYTES, conveyingFailureKind, conveyingHttpError, conveyingGeoJSON} from '../scripts/conveying-data.mjs';

test('gateway and admission responses are not proof of executed-query limits', () => {
  for (const status of [502,504]) assert.equal(conveyingFailureKind(status,'Gateway Timeout'),'gateway-or-server');
  assert.equal(conveyingFailureKind(504,'Dispatcher timed out: request queue full'),'admission');
  assert.equal(conveyingFailureKind(429,'rate limited'),'admission');
  for (const status of [200,500,504]) {
    assert.equal(conveyingFailureKind(status,'runtime error: Query timed out in "query" at line 1 after 900 seconds.'),'execution-limit');
    assert.equal(conveyingFailureKind(status,'runtime error: Query ran out of memory.'),'execution-limit');
  }
  assert.equal(conveyingFailureKind(502,'runtime error: open64: file unavailable'),'gateway-or-server');
  assert.equal(conveyingFailureKind(504,'runtime error: Query timed out',true),'incomplete-diagnostic');
});

test('HTTP diagnostics include status/time, strip HTML and control characters, and keep logs compact', async () => {
  const error = await conveyingHttpError(new Response('<p>runtime error: Query timed out</p>\n\u001b[31mwait\u0000', {status:504}),Date.now()-50);
  assert.equal(error.kind,'execution-limit');
  assert.equal(error.status,504);
  assert.ok(error.elapsedMs>=50);
  assert.equal(error.diagnostic,'runtime error: Query timed out wait');
  assert.equal(error.truncated,false);
  assert.ok(!Object.keys(error).includes('diagnostic'));
  assert.match(error.message,/Overpass HTTP 504 after \d+ms \[execution-limit\]/);
});

test('oversized diagnostic chunks are bounded and the remaining stream is canceled', async () => {
  let canceled=false, reads=0;
  const stream=new ReadableStream({
    pull(controller) {reads++;controller.enqueue(new Uint8Array(CONVEYING_ERROR_BYTES+100).fill(65));},
    cancel(){canceled=true;},
  });
  const error=await conveyingHttpError(new Response(stream,{status:502}),Date.now());
  assert.equal(canceled,true);
  assert.equal(reads,1);
  assert.equal(error.diagnosticBytes,CONVEYING_ERROR_BYTES);
  assert.equal(Buffer.byteLength(error.diagnostic),CONVEYING_ERROR_BYTES);
  assert.equal(error.truncated,true);
  assert.equal(error.kind,'incomplete-diagnostic');
  assert.ok(error.message.length<400);
});

test('partial and empty diagnostics remain failures without execution-limit claims', async () => {
  const stream=new ReadableStream({start(c){c.error(new Error('connection interrupted'));}});
  const partial=await conveyingHttpError(new Response(stream,{status:504}),Date.now());
  assert.equal(partial.kind,'incomplete-diagnostic');
  const empty=await conveyingHttpError(new Response(null,{status:502}),Date.now());
  assert.equal(empty.kind,'gateway-or-server');
  assert.match(empty.message,/empty diagnostic/);
});

test('qt changes only output ordering and preserves normalized complete ways', () => {
  assert.equal(CONVEYING_QUERY,'[out:json][timeout:900][maxsize:1073741824];(way[conveying][conveying!=no];way[highway=elevator];);out tags geom qt;');
  const elements=[
    {type:'way',id:2,tags:{conveying:'backward',highway:'steps'},geometry:[{lon:1,lat:2},{lon:1.000001,lat:2}]},
    {type:'way',id:1,tags:{highway:'elevator'},geometry:[{lon:0,lat:0},{lon:0.000001,lat:0}]},
  ];
  assert.deepEqual(conveyingGeoJSON({elements}),conveyingGeoJSON({elements:[...elements].reverse()}));
  assert.equal(conveyingGeoJSON({elements}).features.length,2);
  assert.throws(()=>conveyingGeoJSON({remark:'runtime error: Query timed out',elements}),/timed out/);
  assert.throws(()=>conveyingGeoJSON({elements:[{...elements[0],geometry:[{lon:0,lat:0}]}]}),/Incomplete geometry/);
});
