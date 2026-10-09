import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appFixture,tick} from './helpers/app-fixture.mjs';

async function saved(f,action){const count=f.writes.length;const promise=action();await tick();assert.equal(f.writes.length,count+1);f.writes.at(-1).resolve();await promise;}
test('one-tap game navigation remembers the last account independently for each game',async()=>{
  const f=appFixture();await f.app.load();
  await saved(f,()=>f.app.selectGame('hk4e'));
  f.app.state.datasets.hk4e.accounts.push({uid:'3',game:'hk4e'});
  f.app.state.datasets.hk4e.records.push({...f.app.state.datasets.hk4e.records[0],uid:'3',id:'r3-person'});
  await saved(f,()=>f.app.selectAccount('hk4e:3'));
  await saved(f,()=>f.app.selectGame('hkrpg'));
  assert.equal(f.app.state.selected.uid,'2');assert.equal(f.app.state.selected.game,'hkrpg');
  await saved(f,()=>f.app.selectGame('hk4e'));
  assert.equal(f.app.state.selected.uid,'3');assert.equal(f.app.state.selected.game,'hk4e');
  assert.equal(f.writes.at(-1).value.preferences['last-account:hk4e'].value,'hk4e:3');
  assert.equal(f.writes.at(-1).value.preferences['last-account:hkrpg'].value,'hkrpg:2');
  assert.equal(f.app.state.datasets.hk4e.accounts.length,2);
});
test('a failed game switch preserves the old game, account, statistics and remembered choices',async()=>{
  const f=appFixture();await f.app.load();const before=JSON.stringify(f.app.state.settings),snapshot=f.app.state.snapshot;
  const promise=f.app.selectGame('hk4e');await tick();f.writes.at(-1).reject(Error('Cannot save'));await promise;
  assert.equal(f.app.state.selected.game,'hkrpg');assert.equal(f.app.state.selected.uid,'2');assert.equal(f.app.state.snapshot,snapshot);assert.equal(JSON.stringify(f.app.state.settings),before);
});
test('cold widget entry reads its bound game first and does not write persistent account selection',async()=>{
  const f=appFixture();f.app.queueWidgetEntry({id:'widget-cold',presetId:'pools',configuration:{account:'hk4e:1'}});await f.app.load();await f.app.applyWidgetEntry();
  assert.deepEqual(f.reads,['gacha-settings','genshin-records']);assert.equal(f.app.state.selected.game,'hk4e');assert.equal(f.app.state.selected.uid,'1');assert.equal(f.app.state.snapshot.records.length,2);assert.equal(f.writes.length,0);
});
test('cached widget entry opens the requested account and pool while retaining native back',async()=>{
  const f=appFixture();await f.app.load();f.app.queueWidgetEntry({id:'widget-hot',presetId:'summary',configuration:{account:'hk4e:1',pool:'200'}});await tick();await f.app.applyWidgetEntry();
  assert.equal(f.app.state.selected.game,'hk4e');assert.equal(f.app.state.selected.uid,'1');assert.equal(f.app.state.view.kind,'pool');assert.equal(f.app.state.view.key,'200');assert.equal(f.writes.length,0);
  f.app.backView();assert.equal(f.app.state.view,null);assert.equal(f.app.state.page,'概览');
});
test('a missing widget account reports its stale binding and retains the existing account',async()=>{
  const f=appFixture();await f.app.load();const snapshot=f.app.state.snapshot;
  f.app.queueWidgetEntry({id:'widget-missing',configuration:{account:'hk4e:missing'}});await tick();
  assert.equal(f.app.state.selected.uid,'2');assert.equal(f.app.state.snapshot,snapshot);assert.equal(f.writes.length,0);assert.match(f.notices.at(-1),/账号已不存在/);
});

test('a multi-pool entry uses only a game included in its selected pools',async()=>{
  const f=appFixture();await f.app.load();
  f.app.queueWidgetEntry({id:'widget-qualified',presetId:'pools',configuration:{account_hk4e:'hk4e:1',account_hkrpg:'hkrpg:2',pools:['hk4e:200']}});
  await tick();await f.app.applyWidgetEntry();
  assert.equal(f.app.state.selected.game,'hk4e');assert.equal(f.app.state.selected.uid,'1');
  assert.equal(f.writes.length,0);
});

test('a mixed game entry retains the active game when both games are included',async()=>{
  const f=appFixture();await f.app.load();
  f.app.queueWidgetEntry({id:'widget-both',presetId:'pools',configuration:{account_hk4e:'hk4e:1',account_hkrpg:'hkrpg:2',pools:['hk4e:200','hkrpg:1']}});
  await tick();await f.app.applyWidgetEntry();
  assert.equal(f.app.state.selected.game,'hkrpg');assert.equal(f.app.state.selected.uid,'2');
  assert.equal(f.writes.length,0);
});
test('a consumed widget entry is not replayed after a later manual game choice',async()=>{
  const f=appFixture();const entry={id:'widget-once',presetId:'pools',configuration:{account:'hk4e:1'}};
  f.app.queueWidgetEntry(entry);await f.app.load();await f.app.applyWidgetEntry();
  await saved(f,()=>f.app.selectGame('hkrpg'));f.app.queueWidgetEntry(entry);await tick();
  assert.equal(f.app.state.selected.game,'hkrpg');assert.equal(f.app.state.selected.uid,'2');assert.equal(f.writes.length,1);
});
