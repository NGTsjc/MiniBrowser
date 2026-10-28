import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LatestPreview } from '../../.cache/unit/preview.js';

function frames() {
  let id=0;const pending=new Map();
  return {request:fn=>{pending.set(++id,fn);return id},cancel:id=>pending.delete(id),
    tick(){const batch=[...pending.values()];pending.clear();for(const fn of batch)fn()}};
}
test('bursts remain bounded and confirmation flushes the final value',async()=>{
  const clock=frames();let release;const values=[];let active=0,max=0;
  const queue=new LatestPreview(async value=>{active++;max=Math.max(max,active);values.push(value);if(value===99)await new Promise(r=>release=r);active--},assert.fail,clock.request,clock.cancel);
  for(let i=0;i<100;i++)queue.enqueue(i);
  clock.tick();await Promise.resolve();
  for(let i=100;i<200;i++)queue.enqueue(i);
  clock.tick();assert.deepEqual(values,[99]);release();
  await queue.flush();assert.deepEqual(values,[99,199]);assert.equal(max,1);
});
test('cancel drops scheduled values and suppresses errors from an obsolete draft',async()=>{
  const clock=frames();let reject;const errors=[],values=[];
  const queue=new LatestPreview(value=>{values.push(value);return new Promise((_,r)=>reject=r)},e=>errors.push(e),clock.request,clock.cancel);
  queue.enqueue(1);clock.tick();await Promise.resolve();queue.enqueue(2);
  const stopped=queue.cancel();reject(new Error('obsolete'));
  await stopped;clock.tick();assert.deepEqual(values,[1]);assert.deepEqual(errors,[]);
  queue.resume();queue.enqueue(3);clock.tick();await Promise.resolve();reject(new Error('current'));
  await queue.flush();assert.equal(errors.length,1);
});
test('flush works without a visible animation frame and cancel is idempotent',async()=>{
  const clock=frames(),values=[];
  const queue=new LatestPreview(async value=>values.push(value),assert.fail,clock.request,clock.cancel);
  queue.enqueue(1);queue.enqueue(2);await queue.flush();clock.tick();assert.deepEqual(values,[2]);
  queue.enqueue(3);await queue.cancel();await queue.cancel();clock.tick();assert.deepEqual(values,[2]);
});
