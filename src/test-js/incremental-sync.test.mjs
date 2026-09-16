import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=name=>readFileSync(new URL(`../web/${name}.js`,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function record(id,type='11',time='2026-01-03 12:00:00',uid='fixture-a') {
  return {uid,id:String(id),gacha_type:type,op_gacha_type:type,uigf_gacha_type:type,
    item_id:'1',name:'Fixture',item_name:'Fixture',rank_type:'3',count:'1',time};
}
function harness(game,remote,local=[],completed=[],customResponse) {
  const requests=[];
  const context={URL,URLSearchParams,setTimeout:callback=>{queueMicrotask(callback);return 0;},ats:{request:async raw=>{
    const url=new URL(raw),type=url.searchParams.get('gacha_type'),page=Number(url.searchParams.get('page')),size=Number(url.searchParams.get('size'));
    requests.push({type,page,endId:url.searchParams.get('end_id')});
    const list=customResponse?customResponse(type,page,size):((remote[type]||[]).slice((page-1)*size,page*size));
    return {status:200,text:JSON.stringify({retcode:0,data:{list,region_time_zone:8}})};
  }}};
  context.window=context;vm.createContext(context);
  for(const name of ['model','network'])vm.runInContext(source(name),context);
  const dataset=context.gachaModel.normalizeDataset({formatVersion:1,game,
    accounts:[...new Set(local.map(item=>item.uid))].map(uid=>({uid,lastSyncAt:0})),records:plain(local),poolSyncState:plain(completed)},game);
  const before=JSON.stringify(dataset);
  return {context,dataset,requests,before,
    fetch:mode=>context.gachaNetwork.fetch({game,parameters:{authkey:'fixture-only',game_biz:`${game}_cn`},overseas:false},dataset,()=>{},{mode:mode||'incremental'}),
    pages:type=>requests.filter(item=>item.type===type).map(item=>item.page)};
}

test('each pool loads its own known IDs and completed state after UID discovery',async()=>{
  const remote={},pools=[['301',20],['302',20],['500',20],['2000',5],['1000',5],['200',20],['100',20]];
  for(const [type,size] of pools)remote[type]=Array.from({length:size*3},(_,i)=>record(`${type}${10000-i}`,type,`2026-01-0${3-Math.floor(i/size)} 12:00:00`));
  const complete=['2000','1000'].map(poolType=>({uid:'fixture-a',poolType,historyComplete:true}));
  const h=harness('hk4e',remote,Object.values(remote).flat(),complete),result=await h.fetch();
  for(const [type] of pools)assert.deepEqual(h.pages(type),[1,2],`pool ${type} should stop incrementally`);
  assert.equal(result.records.length,0);assert.equal(JSON.stringify(h.dataset),h.before);
});

test('empty first pool does not break later UID discovery or later pool boundaries',async()=>{
  const remote={};for(const type of ['302','200'])remote[type]=Array.from({length:60},(_,i)=>record(`${type}${10000-i}`,type,`2026-01-0${3-Math.floor(i/20)} 12:00:00`));
  const h=harness('hk4e',remote,Object.values(remote).flat());await h.fetch();
  assert.deepEqual(h.pages('301'),[1]);assert.deepEqual(h.pages('302'),[1,2]);assert.deepEqual(h.pages('200'),[1,2]);
});

test('late four entries from a ten-pull survive known entries and newer records',async()=>{
  const ten=Array.from({length:10},(_,i)=>record((9007199254741100n-BigInt(i)).toString()));
  const newer=[record('9007199254741201','11','2026-01-04 12:00:00'),record('9007199254741200','11','2026-01-04 12:00:00')];
  const h=harness('hkrpg',{'11':[...newer,...ten]},ten.slice(0,6)),result=await h.fetch();
  assert.deepEqual(plain(result.records).map(item=>item.id),[...newer,...ten.slice(6)].map(item=>item.id));
  h.context.gachaModel.mergeDataset(h.dataset,[result]);
  assert.equal(h.dataset.records.length,12);assert.equal(new Set(h.dataset.records.map(item=>item.id)).size,12);
});

test('scan past two known pages when the same timestamp batch crosses their boundary',async()=>{
  const rows=Array.from({length:44},(_,i)=>record(1000-i));
  const h=harness('hkrpg',{'11':rows},rows.slice(0,40)),result=await h.fetch();
  assert.deepEqual(h.pages('11'),[1,2,3]);assert.deepEqual(plain(result.records).map(item=>item.id),rows.slice(40).map(item=>item.id));
});

test('a missing entry within a page resets the consecutive-known boundary',async()=>{
  const rows=Array.from({length:100},(_,i)=>record(1000-i,'11',`2026-01-0${5-Math.floor(i/20)} 12:00:00`));
  const local=rows.filter((_,i)=>i!==25),h=harness('hkrpg',{'11':rows},local),result=await h.fetch();
  assert.deepEqual(h.pages('11'),[1,2,3,4]);assert.equal(result.records[0].id,rows[25].id);
});

test('full refresh reads beyond incremental boundaries and preserves local-only history',async()=>{
  const rows=Array.from({length:80},(_,i)=>record(1000-i,'11',`2026-01-0${5-Math.floor(i/20)} 12:00:00`));
  const old=record('old-local-only','11','2024-01-01 00:00:00'),local=[...rows.filter((_,i)=>i!==65),old];
  const incremental=harness('hkrpg',{'11':rows},local);assert.equal((await incremental.fetch()).records.length,0);assert.deepEqual(incremental.pages('11'),[1,2]);
  const full=harness('hkrpg',{'11':rows},local),result=await full.fetch('full');
  assert.deepEqual(full.pages('11'),[1,2,3,4,5]);assert.equal(result.records[0].id,rows[65].id);assert.equal(result.scannedRecords,80);
  const merged=full.context.gachaModel.mergeDataset(full.dataset,[result]);assert.equal(merged.inserted,1);assert.equal(full.dataset.records.length,81);assert.ok(full.dataset.records.some(item=>item.id===old.id));
});

test('beyond pools must reach the end before their first complete marker is used',async()=>{
  const remote={'301':[record('1','301')]};for(const type of ['2000','1000'])remote[type]=Array.from({length:15},(_,i)=>record(`${type}${100-i}`,type,`2026-01-0${3-Math.floor(i/5)} 12:00:00`));
  const h=harness('hk4e',remote,Object.values(remote).flat()),result=await h.fetch();
  assert.deepEqual(h.pages('2000'),[1,2,3,4]);assert.deepEqual(h.pages('1000'),[1,2,3,4]);assert.deepEqual(plain(result.completedPoolTypes),['2000','1000']);
  assert.equal(h.dataset.poolSyncState.length,0);
  h.context.gachaModel.mergeDataset(h.dataset,[result]);h.requests.length=0;await h.fetch();
  assert.deepEqual(h.pages('2000'),[1,2]);assert.deepEqual(h.pages('1000'),[1,2]);
});

test('another account with identical record IDs cannot trigger an early stop',async()=>{
  const rows=Array.from({length:41},(_,i)=>record(1000-i,'11',`2026-01-0${3-Math.floor(i/20)} 12:00:00`));
  const h=harness('hkrpg',{'11':rows},rows.map(item=>({...item,uid:'fixture-b'}))),result=await h.fetch();
  assert.equal(result.records.length,41);assert.deepEqual(h.pages('11'),[1,2,3]);
});

test('bad cursor, malformed lists and UID mismatch fail without modifying the input dataset',async()=>{
  const repeated=Array.from({length:20},(_,i)=>record(100-i));
  const stuck=harness('hkrpg',{},[],[],type=>type==='11'?repeated:[]);
  await assert.rejects(stuck.fetch('full'),/游标没有推进/);assert.equal(JSON.stringify(stuck.dataset),stuck.before);
  const malformed=harness('hkrpg',{},[],[],()=>null);await assert.rejects(malformed.fetch(),/有效记录列表/);
  const mismatch=harness('hkrpg',{'11':[record('1'),record('2','11','2026-01-03 12:00:00','fixture-b')]});await assert.rejects(mismatch.fetch(),/不一致的 UID/);
});

test('page safety cap reports incomplete work instead of a successful full refresh',async()=>{
  const h=harness('hkrpg',{},[],[],(type,page,size)=>type==='11'?Array.from({length:size},(_,i)=>record(100000-page*size-i)):[]);
  await assert.rejects(h.fetch('full'),/1000 页/);assert.equal(h.requests.length,1000);assert.equal(JSON.stringify(h.dataset),h.before);
});
