import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appFixture,tick} from './helpers/app-fixture.mjs';

test('management always lists all accounts and transfer scope does not inherit the active record account',async()=>{
  const f=appFixture();await f.app.load();await f.app.loadDataPage();
  f.app.openView('data');const html=f.get('view-content').innerHTML;
  assert.match(html,/UID 1/);assert.match(html,/UID 2/);assert.match(html,/data-account-actions="hk4e:1"/);
  assert.doesNotMatch(html,/data-select-account|aria-pressed|account-selected|>当前</);
  assert.doesNotMatch(html,/首页小部件|data-view="analysis"|delete-game/);
  assert.equal(f.get('view-subtitle').textContent,'');
  f.app.openView('export');assert.deepEqual(Array.from(f.app.state.exportKeys).sort(),['hk4e:1','hkrpg:2']);
  assert.equal(f.get('view-subtitle').textContent,'');
  f.app.openView('delete');assert.equal(f.app.state.deleteKeys.length,0);
});

test('the chooser selects within the visible game while management never switches the record account',async()=>{
  const f=appFixture();await f.app.load();await f.app.loadDataPage();
  const before=JSON.stringify(f.app.state.selected);
  f.app.showAccounts();
  assert.equal(f.get('accounts-title').textContent,'星穹铁道 · 选择账号');
  const choices=f.get('account-choices').innerHTML;
  assert.match(choices,/data-choose-account="hkrpg:2" aria-pressed="true" disabled/);
  assert.match(choices,/✓ 已选择/);assert.doesNotMatch(choices,/data-choose-account="hk4e:1"|当前/);
  f.app.openView('account','hk4e:1');
  assert.equal(JSON.stringify(f.app.state.selected),before);
  assert.match(f.get('view-content').innerHTML,/UID 1/);
  assert.doesNotMatch(f.get('view-content').innerHTML,/>当前</);
  assert.equal(f.writes.length,0);
});

test('selected deletion never publishes an uncommitted candidate or deletes an unselected account',async()=>{
  const f=appFixture();await f.app.load();await f.app.loadDataPage();
  const previous=JSON.stringify(f.app.state.datasets),deletion=f.app.deleteSelectedAccounts(['hk4e:1']);await tick();
  assert.equal(JSON.stringify(f.app.state.datasets),previous);assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].id,'genshin-records');assert.equal(f.writes[0].value.records.length,0);
  f.writes[0].reject(Error('disk full'));await deletion;assert.equal(JSON.stringify(f.app.state.datasets),previous);
  assert.ok(f.notices.some(message=>message.includes('disk full')));
  const retry=f.app.deleteSelectedAccounts(['hk4e:1']);await tick();f.writes[1].resolve();await retry;
  assert.equal(f.app.state.datasets.hk4e.records.length,0);assert.equal(f.app.state.datasets.hkrpg.records.length,1);
});

test('unsaved local account remarks survive failed writes and protect the Back action',async()=>{
  const f=appFixture();await f.app.load();f.app.openView('account','hkrpg:2');
  f.app.state.accountDraft.value='新的备注';f.get('account-note').value='新的备注';
  f.app.backNavigation.request();assert.equal(f.get('confirm-dialog').open,true);assert.equal(f.app.state.view.kind,'account');
  const before=JSON.stringify(f.app.state.settings),saving=f.app.saveAccountNote();await tick();
  assert.equal(JSON.stringify(f.app.state.settings),before);f.writes[0].reject(Error('disk full'));await saving;
  assert.equal(JSON.stringify(f.app.state.settings),before);assert.equal(f.app.state.accountDraft.value,'新的备注');
  f.get('confirm-dialog').close();f.app.backNavigation.request();assert.equal(f.get('confirm-dialog').open,true);
});
