import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const plain=value=>JSON.parse(JSON.stringify(value));
function runtime(request){const context=vm.createContext({URL,URLSearchParams,console,setTimeout:fn=>{queueMicrotask(fn);return 0;},ats:{request}});context.window=context;for(const file of ['model','uigf','network'])vm.runInContext(readFileSync(new URL(`../web/${file}.js`,import.meta.url),'utf8'),context);return context;}
const row=(extra={})=>({uid:'fixture',id:'900719925474100001',gacha_type:'400',uigf_gacha_type:'301',gacha_id:'77',item_id:'10000022',name:'测试角色',item_type:'角色',rank_type:'5',count:'1',time:'2020-09-30 12:00:00',...extra});
const bundle=records=>({account:{game:'hk4e',uid:'fixture',timezone:0,region:'os_asia',lastSyncAt:1},records,completedPoolTypes:[]});
for(const value of [false,0,'false','0'])test(`import retains original false marker ${JSON.stringify(value)}, version and zero offset`,()=>{
  const {uigf:u,gachaModel:m}=runtime(),input={info:{version:'v4.2'},hk4e:[{uid:'fixture',timezone:0,list:[row({is_up:value,game_version:'1.0'})]}]},decoded=u.decode(input),record=decoded[0].records[0];
  assert.equal(record.is_up,value);assert.equal(record.timezone,0);assert.equal(record.game_version,'1.0');assert.equal(record.gacha_type,'400');assert.equal(record.uigf_gacha_type,'301');assert.equal(record.id,'900719925474100001');assert.equal(m.snapshot('hk4e',[record],[],['record-field']).stats[0].lossCount,1);
  const extended=u.decode(u.encode(decoded,'2.2.0',{extensions:true}));assert.equal(extended[0].records[0].is_up,value);assert.equal(extended[0].records[0].timezone,0);
  const standard=JSON.parse(u.encode(decoded,'2.2.0'));assert.equal(Object.hasOwn(standard.hk4e[0].list[0],'is_up'),false);assert.equal(Object.hasOwn(standard.hk4e[0].list[0],'game_version'),false);assert.equal(standard.hk4e[0].timezone,0);
});
test('UIGF beyond records export to the standard UGC section with original schedule identity',()=>{
  const {uigf:u}=runtime(),input={hk4e_ugc:[{uid:'fixture',timezone:0,list:[{id:'1',op_gacha_type:'20011',schedule_id:'900719925474100001',item_id:'17',item_name:'测试奇域物品',item_type:'角色',rank_type:'5',time:'2026-01-01 00:00:00',is_up:false}]}]};
  const decoded=u.decode(input),encoded=JSON.parse(u.encode(decoded,'2.2.0'));assert.equal(encoded.hk4e,undefined);assert.equal(encoded.hk4e_ugc[0].list[0].op_gacha_type,'20011');assert.equal(encoded.hk4e_ugc[0].list[0].schedule_id,'900719925474100001');assert.equal(u.decode(encoded)[0].records[0].gacha_type,'20011');
});
test('missing false fields are enriched once, existing corrections stay intact and conflicts retain both sources',()=>{
  const {gachaModel:m}=runtime(),existing=row({is_up:false,item_id:'',game_version:''}),root=m.normalizeDataset({accounts:[bundle([]).account],records:[existing]},'hk4e'),incoming=m.normalizeRecord(row({is_up:true,game_version:'1.0'}),'hk4e','fixture',{source:'official-record-api'});
  const merged=m.mergeDataset(root,[bundle([incoming])]);assert.equal(root.records.length,1);assert.equal(merged.inserted,0);assert.equal(merged.enriched,1);assert.equal(merged.conflicted,1);assert.equal(root.records[0].is_up,false);assert.equal(root.records[0].item_id,'10000022');assert.equal(root.records[0].game_version,'1.0');assert.equal(root.records[0].fieldConflicts.is_up[0].value,true);assert.equal(root.records[0].fieldConflicts.is_up[0].source,'official-record-api');
  const before=JSON.stringify(root.records);m.mergeDataset(root,[bundle([incoming])]);assert.equal(JSON.stringify(root.records),before);
  assert.equal(m.snapshot('hk4e',root.records,[],['record-field']).stats[0].unknownCount,1);
});
test('mixed account timezone sections preserve per-record time through standard export and repeated import',()=>{
  const {uigf:u}=runtime(),decoded=u.decode({hk4e:[{uid:'fixture',timezone:0,list:[row({id:'1'})]},{uid:'fixture',timezone:8,list:[row({id:'2',time:'2020-09-30 20:00:00'})]}]});
  const exported=JSON.parse(u.encode(decoded,'2.2.0'));assert.equal(exported.hk4e.length,2);const restored=u.decode(exported);assert.deepEqual(plain(restored[0].records.map(item=>[item.id,item.timezone])),[['1',0],['2',8]]);
});
test('merging a different account timezone never reinterprets previously saved wall-clock timestamps',()=>{
  const {gachaModel:m,uigf:u}=runtime(),old=row({id:'1',time:'2020-10-18 17:59:00'}),root=m.normalizeDataset({accounts:[{uid:'fixture',timezone:8,region:'os_asia'}],records:[old]},'hk4e');
  m.mergeDataset(root,[{account:{game:'hk4e',uid:'fixture',timezone:0,timezoneAssumed:false,region:''},records:[m.normalizeRecord(row({id:'2',time:'2020-10-18 09:59:00'}),'hk4e','fixture',{timezone:0})]}]);
  assert.equal(root.accounts[0].timezone,0);assert.equal(root.accounts[0].region,'os_asia');const retained=root.records.find(item=>item.id==='1');assert.equal(retained.time,old.time);assert.equal(retained.timezone,8);assert.equal(retained.region,'os_asia');assert.equal(retained.fieldSources.timezone,'existing-account-metadata');
  const unknown=u.decode({hk4e:[{uid:'fixture',list:[row({id:'3'})]}]});m.mergeDataset(root,unknown);assert.equal(root.accounts[0].timezone,0);assert.equal(root.accounts[0].timezoneAssumed,false);assert.equal(root.records.find(item=>item.id==='3').timezoneAssumed,true);
});
test('full official refresh enriches duplicate IDs without inserting or overwriting local historical fields',async()=>{
  const remote=row({gacha_type:'301',is_up:0,game_version:'1.0',gacha_id:'77'}),context=runtime(async url=>({status:200,text:JSON.stringify({retcode:0,data:{region_time_zone:0,region:'os_asia',list:new URL(url).searchParams.get('gacha_type')==='301'?[remote]:[]}})})),m=context.gachaModel,old=row({gacha_type:'301',item_id:'',gacha_id:'',game_version:'',is_up:''}),root=m.normalizeDataset({records:[old],accounts:[bundle([]).account]},'hk4e'),before=JSON.stringify(root);
  const result=await context.gachaNetwork.fetch({game:'hk4e',parameters:{authkey:'synthetic-fixture',region:'os_asia'},overseas:true},root,()=>{},{mode:'full'});assert.equal(result.records.length,0);assert.equal(result.enrichedRecords.length,1);assert.equal(result.enrichedRecords[0].is_up,0);assert.equal(result.account.timezone,0);assert.equal(JSON.stringify(root),before);
  const merged=m.mergeDataset(root,[result]);assert.equal(merged.inserted,0);assert.equal(merged.enriched,1);assert.equal(root.records.length,1);assert.equal(root.records[0].game_version,'1.0');assert.equal(root.records[0].fieldSources.is_up,'official-record-api');
});
test('unsafe numeric IDs are rejected and credential fields never become raw evidence',()=>{
  const {gachaModel:m,uigf:u}=runtime();assert.throws(()=>u.decode({hk4e:[{uid:'fixture',list:[row({id:900719925474100000})]}]}),/精度/);
  const normalized=m.normalizeRecord(row({authkey:'synthetic-secret',cookie:'synthetic-cookie'}),'hk4e','fixture');assert.equal(normalized.authkey,undefined);assert.equal(normalized.cookie,undefined);
});
test('missing official clock and raw type are marked as assumptions, and later raw identity can enrich them',async()=>{
  const remote={...row(),gacha_type:undefined,uigf_gacha_type:undefined},context=runtime(async url=>({status:200,text:JSON.stringify({retcode:0,data:{list:new URL(url).searchParams.get('gacha_type')==='301'?[remote]:[]}})}));
  const m=context.gachaModel,root=m.normalizeDataset(null,'hk4e'),result=await context.gachaNetwork.fetch({game:'hk4e',parameters:{authkey:'synthetic'},overseas:true},root,()=>{},{mode:'full'});assert.equal(result.account.timezoneAssumed,true);assert.equal(result.records[0].timezoneAssumed,true);assert.equal(result.records[0].gachaTypeAssumed,true);
  const merged=m.mergeRecord(result.records[0],m.normalizeRecord(row(),'hk4e','fixture',{timezone:0}));assert.equal(merged.enriched,true);assert.equal(merged.record.gacha_type,'400');assert.equal(merged.record.gachaTypeAssumed,false);assert.equal(merged.record.timezone,0);assert.equal(merged.record.fieldConflicts?.gacha_type,undefined);
});
