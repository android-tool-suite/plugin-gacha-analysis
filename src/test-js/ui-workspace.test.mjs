import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {appFixture,tick} from './helpers/app-fixture.mjs';

const context=vm.createContext({console});context.window=context;
for(const file of ['model','presentation','version-calendar','distribution','views'])vm.runInContext(readFileSync(new URL(`../web/${file}.js`,import.meta.url),'utf8'),context);
const {gachaModel:model,gachaPresentation:presentation,gachaViews:views}=context;
const plain=value=>JSON.parse(JSON.stringify(value));
const records=[
  {uid:'8',id:'1',gacha_type:'11',rank_type:'5',name:'<角色>',time:'2025-09-20 12:00:00',is_up:'true'},
  {uid:'8',id:'2',gacha_type:'11',rank_type:'5',name:'角色乙',time:'2026-09-20 12:00:00',is_up:'false'},
  {uid:'8',id:'3',gacha_type:'11',rank_type:'5',name:'角色丙',time:'2026-09-21 12:00:00'},
  {uid:'8',id:'1',gacha_type:'1',rank_type:'3',name:'光锥',time:'2026-09-21 12:00:00'},
];

test('monthly drill-down preserves year boundaries and uses real record counts',()=>{
  assert.deepEqual(plain(presentation.recordMonths([...records,{time:'invalid'}])),[{month:'2025-09',count:1},{month:'2026-09',count:3}]);
  const snapshot=model.snapshot('hkrpg',records,[],['record-field']);
  const result=presentation.records(snapshot,'hkrpg','2025-09','all',0);
  assert.equal(result.length,1);assert.equal(result[0].name,'<角色>');
  const state={snapshot,selected:{game:'hkrpg',uid:'8'}};
  const html=views.overview(state);
  assert.match(html,/data-month="2025-09"/);assert.match(html,/data-month="2026-09"/);
  assert.match(html,/data-open-pool="11"/);assert.match(html,/data-open-pool="1"/);
  assert.match(html,/data-records-rarity="5"/);assert.match(html,/&lt;角色&gt;/);assert.doesNotMatch(html,/<角色>/);
});

test('record detail identifies same IDs by account and normalized pool',()=>{
  const snapshot=model.snapshot('hkrpg',records,[],['record-field']);
  const limited=presentation.recordDetail(snapshot,'hkrpg',model.recordKey('hkrpg',records[0]));
  const permanent=presentation.recordDetail(snapshot,'hkrpg',model.recordKey('hkrpg',records[3]));
  assert.equal(limited.pool.type,'11');assert.equal(limited.pull.isLoss,false);
  assert.equal(permanent.pool.type,'1');assert.equal(permanent.record.rank_type,'3');assert.equal(permanent.pull,undefined);
  assert.equal(presentation.recordDetail(snapshot,'hkrpg','missing'),null);
  const grouped=presentation.dateGroups(presentation.records(snapshot,'hkrpg','','all',0));
  assert.deepEqual(plain(grouped.map(group=>[group.date,group.records.length])),[['2026-09-21',2],['2026-09-20',1],['2025-09-20',1]]);
});

test('independent pool detail shows the complete target history without fabricating ownership badges',()=>{
  const snapshot=model.snapshot('hkrpg',records,[],['record-field']);
  const state={snapshot,selected:{game:'hkrpg',uid:'8'},view:{key:'11'},detailFilter:'unknown'};
  const html=views.pool(state);
  assert.match(html,/角色丙/);assert.doesNotMatch(html,/角色乙|&lt;角色&gt;/);assert.doesNotMatch(html,/class="badge[^>]*>未知|未知归属/);assert.match(html,/已确认归属/);
  state.detailFilter='other';assert.match(views.pool(state),/角色乙/);assert.doesNotMatch(views.pool(state),/角色丙/);
  state.detailFilter='all';assert.equal((views.pool(state).match(/class="wish-pull-entry /g)||[]).length,3);
  const beyond={...records[0],gacha_type:'1000',rank_type:'4'};
const beyondState={snapshot:model.snapshot('hk4e',[beyond]),selected:{game:'hk4e',uid:'8'},view:{key:'1000'},detailFilter:'all'};
  assert.match(views.pool(beyondState),/4 星轨迹/);assert.match(views.pool(beyondState),/data-records-rarity="4"/);
});

test('native back uses the existing unsaved-analysis guard',async()=>{
  const f=appFixture();await f.app.load();f.app.openView('analysis');
  f.app.state.analysisDraft.sources=['record-field'];
  // Choose a different draft from the persisted options without writing any settings.
  if(!f.app.analysisDirty())f.app.state.analysisDraft.sources=[];
  assert.equal(f.app.analysisDirty(),true);
  f.app.backNavigation.request();
  assert.equal(f.app.state.view.kind,'analysis');assert.equal(f.get('confirm-dialog').open,true);assert.equal(f.writes.length,0);
});

test('export selected accounts never includes another account or game',()=>{
  const accounts=[{game:'hkrpg',uid:'8'},{game:'hkrpg',uid:'9'},{game:'hk4e',uid:'8'}];
  const datasets={hkrpg:{records:[...records,{...records[0],uid:'9'}]},hk4e:{records:[{...records[0],gacha_type:'301'}]}};
  const bundles=presentation.exportBundles(datasets,accounts,['hkrpg:8']);
  assert.equal(bundles.length,1);assert.equal(bundles[0].account.game,'hkrpg');assert.equal(bundles[0].records.length,4);
  assert.deepEqual(plain(presentation.exportBundles(datasets,accounts,[])),[]);
});

test('drilling into pool and records restores the main navigation and exact filter',async()=>{
  const {app,get}=appFixture();await app.load();
  app.openView('pool','1');assert.equal(app.state.view.kind,'pool');assert.match(get('view-content').innerHTML,/当前连续抽数/);
  get('view-scroll').scrollTop=130;app.openView('analysis');assert.equal(app.state.view.kind,'analysis');
  app.backView();assert.equal(app.state.view.kind,'pool');assert.equal(get('view-scroll').scrollTop,130);
  app.showRecords('1',3,'2026-09');assert.equal(app.state.view.kind,'records');assert.equal(app.state.page,'记录');
  assert.equal(app.state.pool,'1');assert.equal(app.state.rarity,3);assert.equal(app.state.query,'2026-09');assert.equal(app.state.recordPage,0);app.backView();assert.equal(app.state.view.kind,'pool');assert.equal(app.state.page,'概览');
});

for(const success of [true,false])test(`analysis changes publish only after settings save ${success?'succeeds':'fails'}`,async()=>{
  const {app,writes,notices}=appFixture();await app.load();app.openView('analysis');
  const before=JSON.stringify(app.state.settings),snapshot=app.state.snapshot;
  app.state.analysisDraft={sources:[],losses:['测试补充角色']};const save=app.saveAnalysis();await tick();
  assert.equal(JSON.stringify(app.state.settings),before);assert.equal(app.state.snapshot,snapshot);
  if(success)writes[0].resolve();else writes[0].reject(Error('write failed'));
  await save;
  if(success){assert.deepEqual(plain(app.state.settings.preferences['banner-history-sources:hkrpg:2'].value),[]);assert.equal(app.analysisDirty(),false);}
  else{assert.equal(JSON.stringify(app.state.settings),before);assert.equal(app.state.snapshot,snapshot);assert.equal(app.analysisDirty(),true);assert.ok(notices.includes('write failed'));}
});

test('account deletion is atomic and preserves other accounts and pool completion state',async()=>{
  const {app,writes}=appFixture();await app.load();
  app.state.datasets.hkrpg.accounts.push({uid:'3'});app.state.datasets.hkrpg.records.push({uid:'3',id:'other',gacha_type:'1',rank_type:'3'});
  app.state.datasets.hkrpg.poolSyncState=[{uid:'2',poolType:'1'},{uid:'3',poolType:'1'}];
  const before=JSON.stringify(app.state.datasets.hkrpg);const deletion=app.deleteAccount('hkrpg:2');await tick();
  assert.equal(JSON.stringify(app.state.datasets.hkrpg),before);
  assert.deepEqual(writes[0].value.accounts.map(item=>item.uid),['3']);assert.deepEqual(writes[0].value.poolSyncState.map(item=>item.uid),['3']);
  writes[0].reject(Error('disk full'));await deletion;assert.equal(JSON.stringify(app.state.datasets.hkrpg),before);
});

test('opening settings during an account switch cannot carry the old account draft into the new account',async()=>{
  const {app,writes}=appFixture();await app.load();
  app.state.settings.preferences['banner-history-sources:hk4e:1']={value:[]};
  const switching=app.selectAccount('hk4e:1');await tick();app.openView('analysis');
  assert.equal(app.state.selected.game,'hkrpg');assert.ok(app.state.analysisDraft.sources.includes('star-rail-station'));
  writes[0].resolve();await switching;
  assert.equal(app.state.selected.game,'hk4e');assert.deepEqual(plain(app.state.analysisDraft.sources),[]);assert.equal(app.analysisDirty(),false);
});
