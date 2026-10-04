import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('GTFS importer validates real calendar, segment, midnight and headway semantics',()=>{
 const result=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','gtfs_frequency_test.py'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
