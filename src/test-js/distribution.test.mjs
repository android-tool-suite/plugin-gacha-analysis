import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
globalThis.window=globalThis;
for(const file of ['model','version-calendar','distribution'])(0,eval)(readFileSync(new URL('../web/'+file+'.js',import.meta.url),'utf8'));
const records=[
  {uid:'1',id:'1',gacha_type:'301',rank_type:'5',name:'UP甲',is_up:'true',time:'2022-09-01 12:00:00'},
  {uid:'1',id:'2',gacha_type:'302',rank_type:'3',name:'武器',time:'2022-09-01 12:01:00'},
  {uid:'1',id:'3',gacha_type:'200',rank_type:'3',name:'常驻',time:'2022-10-01 12:00:00'},
  {uid:'1',id:'4',gacha_type:'301',rank_type:'5',name:'未知',time:'invalid'}
];
const state={selected:{game:'hk4e',uid:'1'},snapshot:gachaModel.snapshot('hk4e',records,[],['record-field'])};
test('distribution segments each resource by pool and preserves unknown dates',()=>{
  const before=JSON.stringify(records),result=gachaDistribution.compute(state);
  assert.equal(result.total,4);assert.equal(result.groups.find(group=>group.key==='2022-09').segments.length,2);
  assert.equal(result.groups.find(group=>group.key==='unknown').total,1);
  assert.equal(result.resources.length,2);assert.equal(JSON.stringify(records),before);
});
test('resource and pool filters operate together without confusing permanent and activity resources',()=>{
  const result=gachaDistribution.compute(state,{mode:'month',resources:['intertwined'],pools:['302']});
  assert.equal(result.total,1);assert.equal(result.groups[0].segments[0].pool,'302');
});
test('monthly analysis includes the month, its complete daily axis and actual five-star outcomes',()=>{
  const result=gachaDistribution.summary(state,{filter:{mode:'month'},key:'2022-09'});
  assert.equal(result.total,2);assert.equal(result.fiveStars.length,1);assert.equal(result.days.length,30);
  assert.equal(result.days[0].total,2);assert.equal(result.activeDays,1);assert.equal(result.resources[0].count,2);
});
test('version grouping uses public date ranges or explicit metadata and keeps unmatched data unknown',()=>{
  assert.equal(gachaDistribution.version(records[0],'hk4e'),'3.0');
  const result=gachaDistribution.compute(state,{mode:'version'});
  assert.equal(result.total,4);assert.ok(result.groups.some(group=>group.key==='unknown'));
  assert.equal(gachaDistribution.version({time:'invalid'},'hkrpg'),null);
  assert.equal(gachaDistribution.version({game_version:'3.1'},'hkrpg'),'3.1');
  assert.equal(gachaDistribution.version({time:'2025-11-01 12:00:00'},'hk4e'),'6.1');
  assert.equal(gachaDistribution.version({time:'2026-01-01 12:00:00'},'hk4e'),'6.2');
});

test('segments for one resource remain together even when chronological records are interleaved',()=>{
  const sample=[records[0],{...records[2],time:'2022-09-01 12:00:30'},records[1]];
  const result=gachaDistribution.compute({selected:state.selected,snapshot:gachaModel.snapshot('hk4e',sample,[],[])});
  assert.deepEqual(result.groups[0].segments.map(segment=>segment.resource),['acquaint','intertwined','intertwined']);
});
