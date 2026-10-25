import assert from 'node:assert/strict';
import test from 'node:test';
import {appFixture,tick} from './helpers/app-fixture.mjs';

test('public references are shared across accounts and next to statistics settings, while cache failures retain local browsing',async()=>{
  const f=appFixture({withReference:true,failReads:new Set(['starrail-reference'])});await f.app.load();assert.ok(f.app.state.snapshot);assert.equal(f.app.state.snapshot.records.length,1);assert.ok(f.app.state.referenceErrors.hkrpg);assert.equal(f.writes.length,0);
  assert.match(f.context.gachaViews.overview(f.app.state),/data-view="analysis"[\s\S]*data-view="reference"/);
  await f.app.loadDataPage();f.app.openView('data');assert.doesNotMatch(f.get('view-content').innerHTML,/data-view="reference"/);f.app.openView('reference');await tick();assert.match(f.get('view-content').innerHTML,/data-update-reference="hk4e"/);assert.match(f.get('view-content').innerHTML,/data-update-reference="hkrpg"/);assert.equal(f.get('view-subtitle').textContent,'');assert.match(f.get('view-content').innerHTML,/可用资料保留/);
});
test('a user UP correction is published only after settings commit and leaves raw records intact',async()=>{
  const f=appFixture({withReference:true});f.values['starrail-records'].records=[{uid:'2',id:'fixture-5',gacha_type:'11',rank_type:'5',time:'2026-09-19 12:00:00',is_up:false}];await f.app.load();const raw=JSON.stringify(f.app.state.datasets),identity=f.context.gachaModel.recordKey('hkrpg',f.app.state.snapshot.records[0]);
  const saving=f.app.setRecordOverride(identity,true);await tick();assert.equal(f.app.state.snapshot.stats[0].lossCount,1);assert.equal(f.writes[0].id,'gacha-settings');f.writes[0].reject(Error('disk full'));await saving;assert.equal(f.app.state.snapshot.stats[0].lossCount,1);assert.equal(JSON.stringify(f.app.state.datasets),raw);
  const retry=f.app.setRecordOverride(identity,true);await tick();f.writes[1].resolve();await retry;assert.equal(f.app.state.snapshot.stats[0].upCount,1);assert.equal(JSON.stringify(f.app.state.datasets),raw);assert.match(f.get('record-detail').innerHTML,/用户修订/);
});
test('quiet automatic checks are opt-in and respect the seven-day window and failed-attempt backoff',async()=>{
  const f=appFixture({withReference:true});await f.app.load();const noticesBefore=[...f.notices];let requested=0;f.context.ats.request=async()=>{requested++;return {status:429,text:'{}'};};await f.app.maybeUpdateReference();assert.equal(requested,0);
  f.app.state.settings.preferences['reference-auto-check']={type:'boolean',value:true};f.app.state.referenceStores.hkrpg={checkedAt:Date.now()};await f.app.maybeUpdateReference();const first=requested;assert.ok(first>0);assert.deepEqual(f.notices,noticesBefore);await f.app.maybeUpdateReference();assert.equal(requested,first);assert.equal(f.app.state.snapshot.records.length,1);
});
