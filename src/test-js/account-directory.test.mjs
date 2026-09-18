import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
(0,eval)(readFileSync(new URL('../web/account-directory.js',import.meta.url),'utf8'));

test('account metadata handles chunk boundaries, Unicode, escaped keys and nested records',()=>{
  for(const raw of [
    JSON.stringify({accounts:[{uid:'001',name:'中文💫"[]'}, {uid:2}],records:[{id:'r'}]}),
    '{"records":[{"accounts":[{"uid":"wrong"}],"name":"\\\"accounts\\\": ["}],"\\u0061ccounts":[{"uid":"001"},{"uid":2}]}',
  ])for(const size of [1,7,4096]){
    const reader=gachaAccountDirectory.createReader(),bytes=new TextEncoder().encode(raw);
    for(let i=0;i<bytes.length;i+=size)reader.accept(bytes.subarray(i,i+size));
    assert.deepEqual(reader.finish(),[{uid:'001'},{uid:'2'}]);
  }
  const empty=gachaAccountDirectory.createReader();empty.accept(new TextEncoder().encode('{"records":[]}'));assert.deepEqual(empty.finish(),[]);
  const broken=gachaAccountDirectory.createReader();broken.accept(new TextEncoder().encode('{"accounts":[{"uid":"x"}'));assert.throws(()=>broken.finish(),/不完整/);
});

test('directory reads only prefixes, reuses digest-bound metadata and invalidates on restore or deletion',async()=>{
  const values={
    'genshin-records':Buffer.from(JSON.stringify({accounts:[{uid:'1'}],records:Array.from({length:5000},(_,i)=>({id:String(i)}))})),
    'starrail-records':Buffer.from(JSON.stringify({accounts:[{uid:'2'}],records:Array.from({length:5000},(_,i)=>({id:String(i)}))})),
  },cache=new Map();let readBytes=0,closed=0;
  const ats={fromBase64:s=>new Uint8Array(Buffer.from(s,'base64')),call:async(method,payload)=>{
    const bytes=values[payload.datasetId||payload.handle];
    if(method==='storage.dataset.openRead')return bytes?{found:true,handle:payload.datasetId,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}:{found:false};
    if(method==='storage.dataset.read'){const part=bytes.subarray(payload.offset,payload.offset+payload.maxBytes);readBytes+=part.length;return{offset:payload.offset,bytes:part.toString('base64'),eof:payload.offset+part.length===bytes.length};}
    if(method==='storage.dataset.abort'){closed++;return{};}
    if(method==='storage.kv.get')return{found:cache.has(payload.key),value:cache.get(payload.key)};
    if(method==='storage.kv.set'){cache.set(payload.key,payload.value);return{};}
    throw Error(method);
  }};
  assert.deepEqual((await gachaAccountDirectory.load(ats)).accounts,{hk4e:[{uid:'1'}],hkrpg:[{uid:'2'}]});
  assert.equal(readBytes,8192);assert.equal(closed,2);
  readBytes=0;await gachaAccountDirectory.load(ats);assert.equal(readBytes,0);assert.equal(closed,4);
  values['starrail-records']=Buffer.from(JSON.stringify({accounts:[{uid:'3'}],records:[]}));
  assert.deepEqual((await gachaAccountDirectory.load(ats)).accounts.hkrpg,[{uid:'3'}]);assert.ok(readBytes>0);
  delete values['starrail-records'];assert.deepEqual((await gachaAccountDirectory.load(ats)).accounts.hkrpg,[]);
});

test('known accounts stay visible without loading records; loaded data supersedes directory metadata',()=>{
  const datasets={hk4e:{accounts:[{uid:'1',timezone:8}],records:[{id:'r'}]},hkrpg:{accounts:[],records:[]}},directory={hk4e:[{uid:'stale'}],hkrpg:[{uid:'2'}]};
  assert.deepEqual(gachaAccountDirectory.accounts(datasets,directory,game=>game==='hk4e'),[{uid:'1',timezone:8,game:'hk4e'},{uid:'2',game:'hkrpg'}]);
  assert.deepEqual(gachaAccountDirectory.accounts(datasets,directory,()=>true),[{uid:'1',timezone:8,game:'hk4e'}]);
  assert.equal(datasets.hkrpg.records.length,0);
});

test('a failed directory reports its game without preventing the other game from being browsed',async()=>{
  const bytes=Buffer.from('{"accounts":[{"uid":"2"}],"records":[]}');let closed=0;
  const result=await gachaAccountDirectory.load({fromBase64:value=>new Uint8Array(Buffer.from(value,'base64')),call:async(method,payload)=>{
    if(method==='storage.dataset.openRead'){if(payload.datasetId==='genshin-records')throw Error('corrupt file');return {found:true,handle:'reader',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
    if(method==='storage.dataset.read')return{offset:0,bytes:bytes.toString('base64'),eof:true};
    if(method==='storage.dataset.abort'){closed++;return{};}
    if(method==='storage.kv.get')return{found:false};
    if(method==='storage.kv.set')throw Error('cache full');
    throw Error(method);
  }});
  assert.deepEqual(result.accounts.hkrpg,[{uid:'2'}]);assert.deepEqual(result.errors,['hk4e']);assert.equal(result.cacheError,'cache full');assert.equal(closed,1);
});
