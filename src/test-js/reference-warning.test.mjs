import assert from 'node:assert/strict';
import test from 'node:test';
import {appFixture} from './helpers/app-fixture.mjs';
const account={uid:'1',game:'hk4e',region:'cn_gf01',timezone:8};
const row=(extra={})=>({uid:'1',id:'1',name:'钟离',item_id:'10000030',gacha_type:'301',uigf_gacha_type:'301',rank_type:'5',count:'1',time:'2022-09-02 12:00:00',...extra});
async function setup(records){const f=appFixture({withReference:true});f.values['gacha-settings'].preferences['selected-account'].value='hk4e:1';f.values['genshin-records']={accounts:[account],records};await f.app.load();return f;}

test('mismatched independent banners, summaries, gold rows and record dialogs remain visible with a warning',async()=>{
 const f=await setup([row(),row({id:'2',name:'冷刃',item_id:'11301',rank_type:'3'})]),state=f.app.state,before=JSON.stringify(state.datasets),views=f.context.gachaViews;
 state.distributionFilter={mode:'banner'};const result=f.context.gachaDistribution.compute(state,state.distributionFilter),group=result.groups[0];
 assert.equal(result.total,2);assert.match(group.label,/巡御蘙荟/);assert.equal(group.warningCount,2);assert.match(views.months(state),/巡御蘙荟[\s\S]*badge warning[^>]*[\s\S]*可能错误/);
 state.view={filter:{mode:'banner'},key:group.key,label:group.label};assert.match(views.distributionSummary(state),/本范围 2 条记录的卡池归属需核对/);
 assert.match(views.recordRow(state,state.snapshot.records[0],true),/钟离[\s\S]*可能错误/);assert.equal(state.snapshot.stats[0].lossCount,0);assert.equal(state.snapshot.stats[0].unknownCount,1);
 f.app.showRecord(f.context.gachaModel.recordKey('hk4e',state.snapshot.records[0]));assert.match(f.get('record-detail').innerHTML,/可能错误/);assert.match(f.get('record-detail').innerHTML,/独立卡池[\s\S]*巡御蘙荟/);assert.equal(JSON.stringify(state.datasets),before);
});

test('ordinary non-UP gold and corrected original subtypes remain unflagged',async()=>{
 for(const record of [row({name:'七七',item_id:'10000035'}),row({gacha_type:'400'}),row({name:'提纳里',item_id:'10000069'})]){
   const f=await setup([record]);const result=f.context.gachaReference.resolve(record,'hk4e',account);assert.equal(result.possibleError,null);assert.doesNotMatch(f.context.gachaViews.recordRow(f.app.state,record),/可能错误/);
 }
});

test('official mismatches also flag contradictions, and recollection sources remain distinguishable',async()=>{
 const f=await setup([row({fieldSources:{gacha_type:'official-record-api'}})]);const ref=f.context.gachaReference;
 assert.ok(ref.resolve(f.app.state.snapshot.records[0],'hk4e',account).possibleError);assert.equal(f.app.state.snapshot.stats[0].lossCount,0);
 const recalled=row({gacha_type:'400',fieldSources:{gacha_type:'user-recollection:2026-10-16'}}),resolved=ref.resolve(recalled,'hk4e',account);assert.equal(resolved.possibleError,null);assert.match(resolved.identityBasis,/用户确认或回忆补全/);
 const missing=ref.resolve(row({gachaTypeAssumed:true}),'hk4e',account);assert.equal(missing.banner,null);assert.equal(missing.possibleError,null);
});

test('a known star rail ID outside its verified opening interval stays grouped with a time warning',async()=>{
 const f=await setup([]),record=row({gacha_type:'21',uigf_gacha_type:'21',gacha_id:'5001',time:'2024-01-01 12:00:00'}),selected={...account,game:'hkrpg',region:'prod_gf_cn'},ref=f.context.gachaReference;
 const result=ref.resolve(record,'hkrpg',selected);assert.ok(result.banner);assert.equal(result.certainty,'identity');assert.match(result.possibleError,/开放区间/);record.item_id=result.banner.featured5[0];assert.equal(ref.upEvidence(record,'hkrpg',selected,['star-rail-station']).value,true,'verified native identity still establishes the UP list independently of the time warning');
 const state={selected,snapshot:f.context.gachaModel.snapshot('hkrpg',[record],[],['star-rail-station'],8,selected)},group=f.context.gachaDistribution.compute(state,{mode:'banner'}).groups[0];assert.equal(group.total,1);assert.equal(group.warningCount,1);
});
