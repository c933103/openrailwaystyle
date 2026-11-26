import test from 'node:test';
import assert from 'node:assert/strict';
import {flatCamera} from '../styles/flat-camera.mjs';
import {createFlatGesture} from '../styles/flat-gesture.mjs';

const camera=flatCamera({center:[114,22],width:600,height:400,zoom:8,bearing:36});
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,[a,b]));
const fixture=()=>{
  const previews=[],commits=[],inspections=[];
  const gesture=createFlatGesture({preview:x=>previews.push(x),commit:x=>commits.push(x),inspect:x=>inspections.push(x)});
  return {gesture,previews,commits,inspections};
};

test('two fingers translate and scale around the geographic point initially between them',()=>{
  const {gesture,previews,commits,inspections}=fixture();
  gesture.start(1,'touch',[200,200],camera);
  gesture.start(2,'touch',[300,200],camera);
  gesture.move(1,[180,220]);gesture.move(2,[380,220]);
  const pinch=previews.at(-1);
  assert.equal(pinch.zoom,9);
  near(pinch.project(camera.unproject([250,200])),[280,220]);
  gesture.end(2,[380,220]);
  assert.equal(commits.length,0);
  gesture.move(1,[200,230]);
  near(previews.at(-1).project(camera.unproject([250,200])),[300,230]);
  gesture.end(1,[200,230]);
  assert.equal(commits.length,1);
  assert.equal(commits[0],previews.at(-1));
  assert.deepEqual(inspections,[]);
});

test('lost capture rolls back after a pan transitions into a pinch',()=>{
  const {gesture,previews,commits,inspections}=fixture();
  gesture.start(1,'touch',[230,100],camera);gesture.move(1,[250,100]);
  gesture.start(2,'touch',[350,100],previews.at(-1));gesture.move(2,[450,100]);
  gesture.cancel(2);gesture.end(1,[250,100]);
  assert.equal(previews.at(-1),camera);
  assert.equal(gesture.active,false);
  assert.deepEqual(commits,[]);
  assert.deepEqual(inspections,[]);
});

test('stationary two-finger touch never inspects; isolated tap still inspects',()=>{
  const {gesture,previews,commits,inspections}=fixture();
  gesture.start(1,'touch',[200,200],camera);gesture.start(2,'touch',[300,200],camera);
  gesture.end(1,[200,200]);gesture.end(2,[300,200]);
  gesture.start(3,'mouse',[200,200],camera);
  assert.equal(gesture.start(4,'touch',[300,200],camera),false);
  gesture.move(3,[201,201]);gesture.end(3,[201,201]);
  assert.deepEqual(inspections,[[201,201]]);
  assert.deepEqual(previews,[]);
  assert.deepEqual(commits,[]);
});

test('nearly coincident touch does not jump; further motion respects zoom bounds',()=>{
  const {gesture,previews}=fixture();
  const high=camera.zoomAt(21.5,[200,200]);
  gesture.start(1,'touch',[200,200],high);gesture.start(2,'touch',[201,200],high);
  gesture.move(2,[225,200]);assert.equal(previews.length,0);
  gesture.move(2,[300,200]);assert.equal(previews.at(-1).zoom,22);
});

test('twisting plus translation keeps the initial geographic midpoint under the fingers',()=>{
  const {gesture,previews,commits}=fixture();
  gesture.start(1,'touch',[160,170],camera);gesture.start(2,'touch',[280,170],camera);
  gesture.move(1,[240,120]);gesture.move(2,[240,360]);
  const view=previews.at(-1);
  assert.equal(view.bearing,-54);
  assert.equal(view.zoom,9);
  near(view.project(camera.unproject([220,170])),[240,240]);
  gesture.end(1,[240,120]);gesture.end(2,[240,360]);
  assert.equal(commits.at(-1),view);
});

test('pinch jitter leaves bearing alone; cancelling a deliberate twist restores the original view',()=>{
  const {gesture,previews,commits}=fixture();
  gesture.start(1,'touch',[160,170],camera);gesture.start(2,'touch',[280,170],camera);
  gesture.move(1,[150,169]);gesture.move(2,[290,174]);
  assert.equal(previews.at(-1).bearing,camera.bearing);
  gesture.move(1,[220,90]);gesture.move(2,[220,250]);
  assert.notEqual(previews.at(-1).bearing,camera.bearing);
  gesture.cancel(1);gesture.end(2,[220,250]);
  assert.equal(previews.at(-1),camera);
  assert.deepEqual(commits,[]);
});
