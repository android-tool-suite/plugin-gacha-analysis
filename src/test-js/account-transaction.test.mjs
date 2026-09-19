import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appFixture,tick} from './helpers/app-fixture.mjs';

for(const saveSucceeds of [true,false])test(`account switch stays consistent across tabs until save ${saveSucceeds?'succeeds':'fails'}`,async()=>{
  const {app,get,node,writes,notices}=appFixture();await app.load();
  const originalSettings=JSON.stringify(app.state.settings),originalSnapshot=app.state.snapshot;
  const switching=app.selectAccount('hk4e:1');await tick();
  assert.equal(writes.length,1);
  assert.equal(app.state.selected.uid,'2');assert.equal(app.state.snapshot,originalSnapshot);
  assert.equal(JSON.stringify(app.state.settings),originalSettings);
  app.drawPage('记录',node());
  assert.match(get('subtitle').textContent,/当前账号 1 条记录/);
  assert.equal(get('record-count').textContent,'1 条匹配记录');
  if(saveSucceeds)writes[0].resolve();else writes[0].reject(Error('Cannot save settings'));
  await switching;
  app.drawPage('记录',node());
  assert.equal(app.state.selected.uid,saveSucceeds?'1':'2');
  assert.equal(get('record-count').textContent,`${saveSucceeds?2:1} 条匹配记录`);
  assert.match(get('subtitle').textContent,saveSucceeds?/当前账号 2 条记录/:/当前账号 1 条记录/);
  if(saveSucceeds){
    assert.equal(writes[0].value.preferences['selected-account'].value,'hk4e:1');
    assert.equal(app.state.settings.preferences.selected_account_key.value,'hk4e:1');
  }else{
    assert.equal(JSON.stringify(app.state.settings),originalSettings);
    assert.ok(notices.includes('Cannot save settings'));
  }
});

test('a failed game does not block a successful account switch or the acquisition page',async()=>{
  const {app,node,writes,get}=appFixture({failReads:new Set(['starrail-records'])});await app.load();
  const failedPage=node();app.drawPage('记录',failedPage);assert.match(failedPage.innerHTML,/记录读取失败/);
  const acquire=node();app.drawPage('获取',acquire);assert.match(acquire.innerHTML,/获取抽卡记录/);
  const switching=app.selectAccount('hk4e:1');await tick();writes[0].resolve();await switching;
  const records=node();app.drawPage('记录',records);
  assert.doesNotMatch(records.innerHTML,/记录读取失败/);assert.equal(get('record-count').textContent,'2 条匹配记录');
  await app.loadDataPage();
  const overview=node();app.drawPage('概览',overview);assert.match(overview.innerHTML,/账号记录/);
  const data=node();app.drawPage('数据',data);assert.match(data.innerHTML,/星穹铁道.*读取失败/);
});

test('retrying the failed current game restores its record page',async()=>{
  const {app,node,get,writes,failReads}=appFixture({failReads:new Set(['starrail-records'])});await app.load();
  const root=node();app.drawPage('记录',root);failReads.clear();
  await get('retry-records').onclick();assert.equal(writes.length,0,'retrying the current selection only needs to read records');
  app.drawPage('记录',root);assert.doesNotMatch(root.innerHTML,/记录读取失败/);
  assert.equal(get('record-count').textContent,'1 条匹配记录');
});

test('a failed target read leaves the current account usable',async()=>{
  const {app,node,get,writes}=appFixture({failReads:new Set(['genshin-records'])});await app.load();
  await app.selectAccount('hk4e:1');assert.equal(writes.length,0);
  app.drawPage('记录',node());assert.equal(app.state.selected.uid,'2');
  assert.equal(get('record-count').textContent,'1 条匹配记录');
});

test('shared settings failures cannot be hidden by switching accounts',async()=>{
  const {app,node,writes}=appFixture({failReads:new Set(['gacha-settings'])});await app.load();
  await app.selectAccount('hk4e:1');assert.equal(writes.length,0);
  const root=node();app.drawPage('记录',root);assert.match(root.innerHTML,/本地记录读取失败/);
});

test('session failure stays in the mihoyo source when refreshing there',async()=>{
  const {app,node}=appFixture({secretError:true});app.state.page='获取';app.state.acquireSource='mihoyo';await app.load();
  const root=node();app.drawPage('记录',root);assert.doesNotMatch(root.innerHTML,/记录读取失败/);
});

test('log acquisition does not offer a browser cloud-game path that cannot return a link',async()=>{
  const {app,node}=appFixture();await app.load();app.state.acquireSource='log';
  const root=node();app.drawPage('获取',root);
  assert.match(root.innerHTML,/不支持.*浏览器.*云游戏/);
  assert.doesNotMatch(root.innerHTML,/data-url=|打开官方云游戏网页/);
});
