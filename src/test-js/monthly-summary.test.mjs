import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {appFixture} from './helpers/app-fixture.mjs';
globalThis.window=globalThis;
for(const file of ['model','presentation','version-calendar','distribution','views'])(0,eval)(readFileSync(new URL('../web/'+file+'.js',import.meta.url),'utf8'));
const sample=[
  {id:'a',gacha_type:'301',rank_type:'5',name:'角色甲',time:'2026-01-01 12:00:00'},
  {id:'b',gacha_type:'302',rank_type:'3',name:'武器',time:'2026-01-01 12:01:00'},
  {id:'c',gacha_type:'200',rank_type:'3',name:'常驻',time:'2026-01-05 12:00:00'},
  {id:'d',gacha_type:'1000',rank_type:'4',name:'颂愿',time:'2026-01-07 12:00:00'},
  {id:'e',gacha_type:'2000',rank_type:'5',name:'活动服饰',time:'2026-01-08 12:00:00'},
  {id:'f',gacha_type:'301',rank_type:'3',name:'普通',time:'2026-01-30 12:00:00'},
  {id:'g',gacha_type:'200',rank_type:'3',name:'下月',time:'2026-02-01 12:00:00'}
].map(record=>({...record,uid:'1'}));
const state={selected:{game:'hk4e',uid:'1'},snapshot:gachaModel.snapshot('hk4e',sample)};
const scope={filter:{mode:'month',resources:[],pools:[]},key:'2026-01',label:'2026-01'};
test('a month reconciles totals across resource/pool pies, every day and five-star outcomes',()=>{
  const before=JSON.stringify(sample),s=gachaDistribution.summary(state,scope);
  assert.equal(s.total,6);assert.equal(s.fiveStars.length,2);assert.equal(s.days.length,31);
  assert.equal(s.resources.reduce((sum,entry)=>sum+entry.count,0),s.total);
  assert.equal(s.pools.reduce((sum,entry)=>sum+entry.count,0),s.total);
  assert.equal(s.days.reduce((sum,entry)=>sum+entry.total,0),s.total);
  assert.equal(s.days[1].total,0);assert.equal(s.activeDays,5);assert.equal(s.peak.date,'2026-01-01');assert.equal(s.peak.total,2);
  assert.equal(JSON.stringify(sample),before);
});
test('combined filters carry into all monthly metrics and inner record matches',()=>{
  const filtered={...scope,filter:{mode:'month',resources:['intertwined'],pools:['301']}};
  const s=gachaDistribution.summary(state,filtered);
  assert.equal(s.total,2);assert.equal(s.fiveStars.length,1);assert.equal(s.activeDays,2);
  assert.deepEqual(s.pools.map(item=>item.id),['301']);assert.deepEqual(s.resources.map(item=>item.id),['intertwined']);
  assert.deepEqual(sample.filter(record=>gachaDistribution.matches(state,filtered.filter,filtered.key,record)).map(record=>record.id),['a','f']);
});
test('resource and pool order is stable, permanent first, with Beyond wishes grouped separately',()=>{
  const reversed={...state,snapshot:gachaModel.snapshot('hk4e',[...sample].reverse())};
  for(const s of [state,reversed]){
    const result=gachaDistribution.compute(s);
    assert.deepEqual(result.resources.map(item=>item.id),['acquaint','intertwined','beyond-standard','beyond-event']);
    assert.deepEqual(result.pools.map(item=>item.id),['200','301','302','1000','2000']);
    assert.deepEqual(result.resources.slice(-2).map(item=>item.label),['常驻颂愿','活动颂愿']);
    assert.ok(result.resources.slice(-2).every(item=>item.family==='千星奇域'));
  }
  const rail={selected:{game:'hkrpg'},snapshot:gachaModel.snapshot('hkrpg',['12','11','2','1','21'].map((type,index)=>({...sample[0],id:String(index),gacha_type:type})))};
  const result=gachaDistribution.compute(rail);
  assert.deepEqual(result.resources.map(item=>item.id),['pass','special-pass']);
  assert.deepEqual(result.pools.map(item=>item.id),['1','2','11','12','21']);
});
test('Star Rail versions cover irregular historical releases, UTC boundaries, and keep uncovered dates unknown',()=>{
  const classify=(time,timezone=8)=>gachaDistribution.version({time},'hkrpg',timezone);
  assert.equal(classify('2023-04-26 10:00:00'),'1.0');
  assert.equal(classify('2023-11-15 05:59:59'),'1.4');assert.equal(classify('2023-11-15 06:00:00'),'1.5');
  assert.equal(classify('2024-02-06 12:00:00'),'2.0');assert.equal(classify('2025-01-15 12:00:00'),'3.0');
  assert.equal(classify('2026-10-09 12:00:00'),'4.6');
  assert.equal(classify('2023-11-14 16:59:59',-5),'1.4');assert.equal(classify('2023-11-14 17:00:00',-5),'1.5');
  assert.equal(classify('2023-01-01 12:00:00'),null);assert.equal(classify('2030-01-01 12:00:00'),null);
});
test('leap days are counted and invalid dates stay outside the daily axis',()=>{
  const records=[{...sample[0],time:'2024-02-29 12:00:00'},{...sample[1],time:'2025-02-29 12:00:00'}];
  const s={selected:state.selected,snapshot:gachaModel.snapshot('hk4e',records)};
  const feb=gachaDistribution.summary(s,{filter:{mode:'month'},key:'2024-02'});
  assert.equal(feb.days.length,29);assert.equal(feb.total,1);
  const unknown=gachaDistribution.summary(s,{filter:{mode:'month'},key:'unknown'});
  assert.equal(unknown.total,0);assert.equal(unknown.undated,0);assert.equal(unknown.days.length,0);const distribution=gachaDistribution.compute(s);assert.equal(distribution.total,1);assert.equal(distribution.skipped,1);assert.equal(s.snapshot.records.length,2);
});
test('the distribution opens analysis, details are inside More, and untrusted names are escaped',()=>{
  const html=gachaViews.months(state);
  assert.doesNotMatch(html,/UP 获取|data-distribution-mode="up"/);
  assert.ok(html.indexOf('相遇之缘')<html.indexOf('纠缠之缘'));
  assert.ok(html.indexOf('常驻颂愿')<html.indexOf('活动颂愿'));
  const unsafe={...state,view:{...scope,chart:'resources'},snapshot:gachaModel.snapshot('hk4e',[{...sample[0],name:'<img src=x onerror=alert(1)>'}])};
  const summary=gachaViews.distributionSummary(unsafe);
  assert.match(summary,/distribution-donut/);assert.match(summary,/每日抽数/);assert.match(summary,/获得的五星/);
  assert.match(summary,/<details class="distribution-detail-menu">/);assert.match(summary,/data-summary-records="0"/);
  assert.doesNotMatch(summary,/<img src=x/);assert.match(summary,/&lt;img/);
});
test('inner records return to the same scoped analysis and distribution scroll without writing settings',async()=>{
  const f=appFixture();await f.app.load();const originalWrites=f.writes.length;
  f.app.openView('months');f.get('view-scroll').scrollTop=140;
  const filter={mode:'month',resources:['pass'],pools:['1']};
  f.app.openDistributionSummary(filter,'2026-09','2026-09');
  assert.equal(f.app.state.view.kind,'distribution-detail');f.get('view-scroll').scrollTop=220;
  f.app.showDistributionRecords(5);
  assert.equal(f.app.state.view.kind,'records');assert.equal(f.app.state.rarity,5);
  assert.equal(f.app.state.recordDrill.key,'2026-09');
  f.app.backView();assert.equal(f.app.state.view.kind,'distribution-detail');assert.equal(f.get('view-scroll').scrollTop,220);
  assert.equal(f.app.state.recordDrill,null);
  f.app.backView();assert.equal(f.app.state.view.kind,'months');assert.equal(f.get('view-scroll').scrollTop,140);
  assert.equal(f.writes.length,originalWrites);
});
