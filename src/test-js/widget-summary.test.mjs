import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
globalThis.window=globalThis;
(0,eval)(readFileSync(new URL('../web/model.js',import.meta.url),'utf8'));
(0,eval)(readFileSync(new URL('../workers/summary.js',import.meta.url),'utf8'));
const run=ats=>atsWorkerMain({kind:'capability',method:'gacha.summary.get'},ats);
test('independent instance bindings do not follow browsing preferences and missing accounts stay unknown',async()=>{
  const records=[{uid:'1',id:'3',time:'2026-01-03',gacha_type:'301',rank_type:'3'},{uid:'1',id:'2',time:'2026-01-02',gacha_type:'301',rank_type:'5'},{uid:'2',id:'1',time:'2026-01-01',gacha_type:'301',rank_type:'3'}];
  const f=fixture(records,{'selected-account':{value:'hk4e:2'}});
  const call=(account,pool='301')=>atsWorkerMain({kind:'capability',method:'gacha.summary.get',payload:{widgetId:'summary',configuration:{account,pool}}},f.ats);
  const a=await call('hk4e:1'),b=await call('hk4e:2');assert.equal(a.value,1);assert.equal(b.value,1);assert.match(a.detail,/^1 ·/);assert.match(b.detail,/^2 ·/);
  assert.equal((await call('hk4e:missing')).state,'empty');assert.equal((await call('hk4e:1','missing')).state,'empty');
});
test('multiple pools and record overview use the actual configured scope',async()=>{
  const f=fixture([{uid:'1',id:'2',time:'2026-01-02',gacha_type:'301',rank_type:'3'},{uid:'1',id:'1',time:'2026-01-01',gacha_type:'302',rank_type:'5'}]);
  const call=(widgetId,configuration)=>atsWorkerMain({kind:'capability',method:'gacha.summary.get',payload:{widgetId,configuration}},f.ats);
  const pools=await call('pools',{account:'hk4e:1',pools:['301','302']});assert.equal(pools.rows[0].value,'1/90 抽');assert.equal(pools.rows[1].value,'0/80 抽');
  const overview=await call('records',{game:'hk4e'});assert.equal(overview.rows[0].value,2);assert.equal(overview.rows[1].value,2);assert.match(overview.detail,/2026-01-02/);
  assert.equal((await call('records',{game:'hkrpg'})).rows[1].value,0);
});
test('widget configuration uses dynamic account pools without writing browsing preferences',async()=>{
  const f=fixture([]);const result=await atsWorkerMain({kind:'capability',method:'gacha.summary.configure',payload:{widgetId:'pools',configuration:{account:'hk4e:1',pools:['301','302']}}},f.ats);
  assert.deepEqual(result.configuration,{account_hk4e:'hk4e:1',account_hkrpg:'',pools:['hk4e:301','hk4e:302']});assert.equal(result.fields[0].options.length,2);assert.equal(result.fields.at(-1).maxItems,4);
});
test('one overview binds independent accounts and pools in both games',async()=>{
  const f=fixture([{uid:'1',id:'1',time:'2026-01-01',gacha_type:'301',rank_type:'3'}]);
  f.values['starrail-records']={accounts:[{uid:'3'}],records:[{uid:'3',id:'1',time:'2026-01-01',gacha_type:'11',rank_type:'3'},{uid:'9',id:'2',time:'2026-01-02',gacha_type:'11',rank_type:'5'}]};
  const configuration={account_hk4e:'hk4e:1',account_hkrpg:'hkrpg:3',pools:['hk4e:301','hkrpg:11']};
  const result=await atsWorkerMain({kind:'capability',method:'gacha.summary.get',payload:{widgetId:'pools',configuration}},f.ats);
  assert.equal(result.rows.length,2);assert.equal(result.rows[0].value,'1/90 抽');assert.equal(result.rows[1].value,'1/90 抽');
  assert.match(result.rows[0].label,/原神/);assert.match(result.rows[1].label,/星铁/);assert.equal(result.title,'原神 · 星穹铁道');
  const schema=await atsWorkerMain({kind:'capability',method:'gacha.summary.configure',payload:{widgetId:'pools',configuration}},f.ats);
  assert.deepEqual(schema.configuration,configuration);assert.equal(schema.fields.length,3);
});
function fixture(records,preferences={'selected-account':{value:'hk4e:1'}}){
  const values={'gacha-settings':{preferences},'genshin-records':{accounts:[{uid:'1'},{uid:'2'}],records},'starrail-records':{accounts:[],records:[]}},cache=new Map(),reads=[],closed=[];
  const ats={decodeUtf8:bytes=>new TextDecoder().decode(bytes),decodeBase64:value=>new Uint8Array(Buffer.from(value,'base64')),call:async(method,payload)=>{
    if(method==='storage.kv.get')return{found:cache.has(payload.key),value:cache.get(payload.key)};
    if(method==='storage.kv.set'){cache.set(payload.key,payload.value);return{};}
    if(method==='storage.dataset.openRead'){const value=values[payload.datasetId];if(value===undefined)return{found:false};const bytes=Buffer.from(JSON.stringify(value));return{found:true,handle:payload.datasetId,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
    if(method==='storage.dataset.read'){reads.push(payload.handle);const bytes=Buffer.from(JSON.stringify(values[payload.handle])),part=bytes.subarray(payload.offset,payload.offset+payload.maxBytes);return{bytes:part.toString('base64'),offset:payload.offset,eof:payload.offset+part.length===bytes.length};}
    if(method==='storage.dataset.abort'){closed.push(payload.handle);return{};}throw Error(method);
  }};return{ats,values,cache,reads,closed};
}
const record=(id,pool='301',rarity=3,uid='1')=>({id:String(id),uid,gacha_type:pool,rank_type:String(rarity),name:'曲线并非样例 } " 中文',time:`2026-09-20 00:${String(id).padStart(2,'0')}:00`,extra:{nested:['records',{value:'escaped \\ "'}]}});
test('a known account with no records in a selected pool is not reported as an unavailable account',async()=>{
  const f=fixture([record(1)]);
  const result=await atsWorkerMain({kind:'capability',method:'gacha.summary.get',payload:{widgetId:'pools',configuration:{account:'hk4e:1',pools:['301','302']}}},f.ats);
  assert.equal(result.rows[1].value,'暂无记录');assert.doesNotMatch(result.detail,/账号不可用/);
  assert.match(result.detail,/暂无本地记录/);
});

test('home uses the selected account character pool and the same continuous count as the real model',async()=>{
  const records=[record(7),record(6),record(5,'400',5),record(4),record(3,'302',5),record(8,'301',5,'2')],f=fixture(records);
  const result=await run(f.ats),actual=gachaModel.snapshot('hk4e',records.filter(r=>r.uid==='1')).stats.find(p=>p.type==='301');
  assert.equal(result.value,actual.currentPity);assert.equal(result.progress,2);assert.equal(result.max,90);assert.match(result.title,/角色活动/);assert.match(result.detail,/^1 · 2\/90/);
  f.reads.length=0;assert.deepEqual(await run(f.ats),result);assert.deepEqual(f.reads,['gacha-settings'],'unchanged record archive reuses digest-bound result');
  f.values['genshin-records'].records.unshift(record(9));assert.equal((await run(f.ats)).value,3);
});
test('unordered restored records, same IDs in other pools, and account selection stay isolated',async()=>{
  const records=[record(2),record(6),record(3,'301',5),record(4),record(7,'302',5),record(9,'301',5,'2')],f=fixture(records);
  assert.equal((await run(f.ats)).value,2);
  f.values['gacha-settings'].preferences['selected-account'].value='hk4e:2';assert.equal((await run(f.ats)).value,0,'known last target produces a real zero');
  f.values['gacha-settings'].preferences['selected-account'].value='hkrpg:2';assert.equal((await run(f.ats)).value,'—','unknown record range does not produce zero');
});
test('only a dedicated widget pool setting overrides role activity, with real target-rarity rules',async()=>{
  const f=fixture([record(1,'1000',4),record(2,'1000',5),record(3,'1000',3),record(4)]);
  f.values['gacha-settings'].preferences.selected_pool_type={value:'1000'};
  assert.match((await run(f.ats)).title,/角色活动/,'historical page tab does not become widget state');
  f.values['gacha-settings'].preferences['widget-pool:hk4e:1']={value:'1000'};
  const result=await run(f.ats);assert.equal(result.value,2);assert.equal(result.max,70);assert.match(result.title,/常驻颂愿/);
});
test('streaming record parsing handles byte boundaries and does not collect nested arrays as records',()=>{
  const records=[record(1),record(2)],encoded=new TextEncoder().encode(JSON.stringify({extra:{records:[record(99)]},records})),found=[];
  const reader=createWidgetRecordReader({decodeUtf8:bytes=>new TextDecoder().decode(bytes)},r=>found.push(r));
  for(let i=0;i<encoded.length;i+=7)reader.accept(encoded.subarray(i,i+7));reader.finish();assert.deepEqual(found,records);
});
test('missing selection and record-read failures do not publish a zero or leave an open handle',async()=>{
  const f=fixture([record(1)],{});assert.equal((await run(f.ats)).value,'—');
  f.values['gacha-settings'].preferences['selected-account']={value:'hk4e:1'};
  const call=f.ats.call;f.ats.call=async(method,payload)=>{if(method==='storage.dataset.read'&&payload.handle==='genshin-records')throw Error('disk read failed');return call(method,payload);};
  await assert.rejects(run(f.ats),/disk read failed/);assert.ok(f.closed.includes('genshin-records'));
});
