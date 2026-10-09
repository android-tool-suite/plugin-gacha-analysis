import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {appFixture} from './helpers/app-fixture.mjs';

const context=vm.createContext({console});context.window=context;
for(const file of ['model','presentation','version-calendar','distribution','views'])vm.runInContext(readFileSync(new URL(`../web/${file}.js`,import.meta.url),'utf8'),context);
const {gachaModel:model,gachaViews:views}=context;

for(const [game,type] of [['hk4e','301'],['hkrpg','11']])test(`${game} averages completed UP intervals and excludes the unfinished tail`,()=>{
  const hits=new Map([[4,'true'],[6,'false'],[10,'true'],[13,'false'],[15,null]]);
  const records=Array.from({length:16},(_,index)=>({uid:'8',id:String(index+1),gacha_type:type,rank_type:hits.has(index+1)?'5':'3',name:'测试物品',time:`2026-09-20 12:00:${String(index+1).padStart(2,'0')}`,...(hits.get(index+1)!=null?{is_up:hits.get(index+1)}:{})}));
  const before=JSON.stringify(records),snapshot=model.snapshot(game,records,[],['record-field']),pool=snapshot.stats[0];
  assert.equal(pool.upCount,2);assert.equal(pool.lossCount,2);assert.equal(pool.currentPity,1);
  assert.equal(pool.averageUpPity,5,'4 pulls to the first UP and 6 to the second; later pulls remain unfinished');
  assert.equal(pool.targetCount-pool.upCount-pool.lossCount,1);
  const state={snapshot,selected:{game,uid:'8'},view:{key:type},detailFilter:'all'};
  assert.match(views.pool(state),/<strong>5\.0<\/strong><span>平均 UP 抽数<\/span>/);
  assert.match(views.overview(state),/平均 UP 5\.0 抽/);
  assert.doesNotMatch(views.overview(state),/统计与评价说明|wish-stat-explanation/);
  assert.equal(JSON.stringify(records),before);
});

test('a tracked pool without an identified UP shows an empty average, and permanent pools omit the UP statistic',()=>{
  const record={uid:'8',id:'1',gacha_type:'11',rank_type:'5',name:'测试物品',time:'2026-09-20 12:00:00',is_up:'false'};
  const state={snapshot:model.snapshot('hkrpg',[record],[],['record-field']),selected:{game:'hkrpg',uid:'8'},view:{key:'11'},detailFilter:'all'};
  assert.match(views.pool(state),/<strong>—<\/strong><span>平均 UP 抽数<\/span>/);
  state.snapshot=model.snapshot('hkrpg',[{...record,gacha_type:'1'}]);state.view.key='1';
  assert.doesNotMatch(views.pool(state),/平均 UP 抽数|UP \/ 非 UP|未知归属/);
});

test('all months cover multiple years and return from month records to the distribution',async()=>{
  const records=Array.from({length:9},(_,index)=>({uid:'8',id:String(index),gacha_type:'11',rank_type:'3',time:`${index<3?'2025':'2026'}-${String(index%3+1).padStart(2,'0')}-20 12:00:00`}));
  // Add enough distinct months to exceed the overview's six-column summary.
  for(let month=4;month<=9;month++)records.push({...records[0],id:'extra-'+month,time:`2026-${String(month).padStart(2,'0')}-20 12:00:00`});
  const state={snapshot:model.snapshot('hkrpg',records),selected:{game:'hkrpg',uid:'8'}};
  const html=views.months(state),overview=views.overview(state);
  assert.match(overview,/data-view="months"/);assert.doesNotMatch(overview,/data-month="2025-01"/);
  assert.match(html,/aria-label="2025-01，1 抽，查看简要分析"/);assert.match(html,/aria-label="2026-09，1 抽，查看简要分析"/);
  assert.ok(html.indexOf('2026-09')<html.indexOf('2025-01'));
  assert.ok(html.indexOf('2026-09')<html.indexOf('2026-01'));
  const f=appFixture();await f.app.load();f.app.openView('months');f.get('view-scroll').scrollTop=140;
  f.app.showRecords('all',0,'2025-01');assert.equal(f.app.state.view.kind,'records');assert.equal(f.app.state.query,'2025-01');
  f.app.backView();assert.equal(f.app.state.view.kind,'months');assert.equal(f.get('view-scroll').scrollTop,140);
});
