const test=require('node:test'), assert=require('node:assert/strict');
const {createScanRecovery,requestDisposition}=require('../scanRecovery');
const {isWorkerReady}=require('../workerHealth');
function fixture(overrides={}) {
 let next=0, durable=0, clock=0, head=1200000-1; const calls=[];
 const opts={getHead:async()=>head,getNext:()=>next,readRange:async(a,b)=>{calls.push([a,b]);clock+=100;return [];},processEvent:async()=>true,persist:async n=>{durable=n;clock+=10;},advance:n=>{next=n;},now:()=>clock,yieldWork:async()=>{},...overrides};
 return {opts,calls,run:createScanRecovery(opts),get next(){return next;},get durable(){return durable;},get clock(){return clock;},set head(n){head=n;}};
}
for(const identity of ['1','2']) {
 test(`Oracle ${identity}: bounded backlog, consecutive ranges, near-head polling and new blocks`,async()=>{
  const f=fixture(); let cycles=0,delay;
  while(f.next<1200000){const r=await f.run();assert.ok(r.ranges<=10);assert.equal(r.error,undefined);delay=r.delayMs;cycles++;}
  assert.equal(cycles,60);assert.equal(f.calls.length,600);assert.equal(f.durable,1200000);assert.equal(delay,15000);
  assert.deepEqual(f.calls[0],[0,1999]);assert.deepEqual(f.calls.at(-1),[1198000,1199999]);
  f.head=1200010;await f.run();assert.equal(f.next,1200011);
 });
}
test('time budget yields after slow range, without abandoning it',async()=>{
 let t=0;const f=fixture({now:()=>t,readRange:async()=>{t+=6000;return [];}});const r=await f.run();assert.equal(r.ranges,1);assert.equal(r.delayMs,250);assert.equal(f.next,2000);
});
for(const label of ['429','timeout','range rejected']) test(`${label}: bounded failure, no checkpoint advance, then recovery`,async()=>{
 let fail=true;const f=fixture({readRange:async()=>{if(fail)throw Object.assign(new Error(label),{code:label});return [];}});
 for(let i=0;i<5;i++){const r=await f.run();assert.ok(r.error);assert.equal(r.delayMs,Math.min(120000,15000*2**i));assert.equal(f.next,0);}
 fail=false;const r=await f.run();assert.equal(r.error,undefined);assert.equal(f.next,20000);
});
test('persistence failure replays range and already-completed events stay idempotent',async()=>{
 let attempt=0,actions=0,completed=false;const ranges=[];
 const f=fixture({readRange:async(a)=>{ranges.push(a);return [1];},processEvent:async()=>{if(!completed){actions++;completed=true;}return true;},persist:async()=>{if(attempt++===0)throw Error('lost acknowledgment');},maxRanges:1});
 assert.ok((await f.run()).error);assert.equal(f.next,0);
 await f.run();assert.deepEqual(ranges,[0,0]);assert.equal(actions,1);assert.equal(f.next,2000);
});
test('actionable failed event holds cursor; later retry preserves it',async()=>{
 let fail=true;const f=fixture({readRange:async()=>[1,2],processEvent:async()=>{if(fail)throw Error('backend unavailable');return true;},maxRanges:1});
 assert.ok((await f.run()).error);assert.equal(f.next,0);fail=false;await f.run();assert.equal(f.next,2000);
});
test('explicit unhandled result cannot advance cursor',async()=>{
 const f=fixture({readRange:async()=>[1],processEvent:async()=>false});assert.ok((await f.run()).error);assert.equal(f.next,0);
});
test('slow scan cannot overlap; yield allows health work and shutdown stops later ranges',async()=>{
 let release,stop=false,ticks=0;const gate=new Promise(r=>release=r);
 const f=fixture({getHead:async()=>{await gate;return 9999;},stopped:()=>stop,yieldWork:async()=>{await new Promise(r=>setImmediate(r));ticks++;stop=true;}});
 const pending=f.run();assert.equal((await f.run()).overlap,true);release();await pending;assert.equal(ticks,1);assert.equal(f.next,2000);await f.run();assert.equal(f.next,2000);
});
test('expired event is accounted for without fulfillment; following valid event executes',async()=>{
 const outcomes=[];const requests=[{commitDeadlineBlock:10,revealDeadlineBlock:20},{commitDeadlineBlock:100,revealDeadlineBlock:200}];
 const f=fixture({maxRanges:1,readRange:async()=>requests,processEvent:async request=>{outcomes.push(requestDisposition({request,block:30,eligible:true,committed:false,revealed:false}));return true;}});
 await f.run();assert.deepEqual(outcomes,['expired-reveal','commit']);assert.equal(f.next,2000);assert.equal(requests[0].isFulfilled,undefined);
});
test('inclusive commit/reveal deadlines and prior commitment recovery',()=>{
 const request={commitDeadlineBlock:10,revealDeadlineBlock:20};const classify=x=>requestDisposition({request,block:10,eligible:true,committed:false,revealed:false,...x});
 assert.equal(classify({}),'commit');assert.equal(classify({block:11}),'expired-commit');
 assert.equal(classify({block:11,committed:true}),'reveal');assert.equal(classify({block:20,committed:true}),'reveal');
 assert.equal(classify({block:21,committed:true}),'expired-reveal');assert.equal(classify({revealed:true}),'complete');
 assert.equal(classify({request:{...request,isFulfilled:true}}),'complete');assert.equal(classify({eligible:false}),'ineligible');
});
test('readiness requires restored, fresh head and cursor, low lag, and healthy polling',()=>{
 const now=Date.now();const state={initialized:true,lastError:'',scanHead:10000,nextScanBlock:10001,headObservedAt:new Date(now).toISOString(),lastSuccessfulPollAt:new Date(now).toISOString()};
 const ready=x=>isWorkerReady({enabled:true,pollIntervalMs:15000,state:{...state,...x},now});
 assert.equal(ready({}),true);for(const x of [{initialized:false},{nextScanBlock:1},{scanHead:undefined},{headObservedAt:new Date(now-60000).toISOString()},{lastError:'failure'},{lastSuccessfulPollAt:null}])assert.equal(ready(x),false);
});
test('waiting for other commitments defers at normal interval without exponential backoff',async()=>{
 const f=fixture({readRange:async()=>[1],processEvent:async()=>{throw Object.assign(Error('pending'),{deferred:true});}});
 for(let i=0;i<5;i++){const r=await f.run();assert.equal(r.delayMs,15000);assert.equal(f.next,0);}
});
