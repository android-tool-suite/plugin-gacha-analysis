import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
(0,eval)(readFileSync(new URL('../web/initial-load.js',import.meta.url),'utf8'));

test('saved game is respected, including the legacy selection key',()=>{
  assert.equal(gachaInitialLoad.preferredGame({preferences:{'selected-account':{value:'hkrpg:123'}}}),'hkrpg');
  assert.equal(gachaInitialLoad.preferredGame({preferences:{selected_account_key:{value:'hkrpg:123'}}}),'hkrpg');
  assert.equal(gachaInitialLoad.preferredGame({}),'hk4e');
});
test('current game reads no unrelated records or credentials; export loads both',async()=>{
  const reads=[],applied=[];
  const loader=gachaInitialLoad.createLoader(async id=>{reads.push(id);return id;},(game,value)=>applied.push([game,value]));
  await loader.ensure('hkrpg');assert.deepEqual(reads,['starrail-records']);
  await loader.all();assert.deepEqual(reads,['starrail-records','genshin-records']);
  assert.deepEqual(applied,[['hkrpg','starrail-records'],['hk4e','genshin-records']]);
});
test('concurrent requests coalesce and corrupt data never becomes loaded',async()=>{
  let reads=0,fail=true;
  const loader=gachaInitialLoad.createLoader(async()=>{reads++;return null;},()=>{if(fail)throw Error('corrupt');});
  const results=await Promise.allSettled([loader.ensure('hk4e'),loader.ensure('hk4e')]);
  assert.equal(reads,1);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(loader.has('hk4e'),false);
  fail=false;await loader.ensure('hk4e');assert.equal(reads,2);assert.equal(loader.has('hk4e'),true);
});
test('refresh rereads records, including missing datasets',async()=>{
  let reads=0;
  const create=()=>gachaInitialLoad.createLoader(async()=>{reads++;return null;},(_,bytes)=>assert.equal(bytes,null));
  const first=create();await first.ensure('hk4e');await first.ensure('hk4e');await create().ensure('hk4e');assert.equal(reads,2);
});

test('only a rejected read is a failure; starting a retry clears that state',async()=>{
  let reject,resolve;
  const loader=gachaInitialLoad.createLoader(()=>new Promise((ok,fail)=>{resolve=ok;reject=fail;}),()=>{});
  const first=loader.ensure('hk4e');await Promise.resolve();
  assert.equal(loader.failed('hk4e'),false);assert.equal(loader.has('hk4e'),false);
  reject(Error('read failed'));await assert.rejects(first,/read failed/);
  assert.equal(loader.failed('hk4e'),true);
  const retry=loader.ensure('hk4e');assert.equal(loader.failed('hk4e'),false);
  await Promise.resolve();resolve(null);await retry;
  assert.equal(loader.has('hk4e'),true);assert.equal(loader.failed('hk4e'),false);
});

test('loading both games waits for the healthy game before reporting a failed one',async()=>{
  let finishHealthy,settled=false;
  const loader=gachaInitialLoad.createLoader(id=>id==='genshin-records'?Promise.reject(Error('corrupt')):new Promise(resolve=>{finishHealthy=resolve;}),()=>{});
  const loading=loader.all();loading.then(()=>{settled=true;},()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(loader.failed('hk4e'),true);assert.equal(settled,false);
  finishHealthy(null);await assert.rejects(loading,/corrupt/);
  assert.equal(loader.has('hkrpg'),true);assert.equal(loader.failed('hkrpg'),false);
});
