import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=name=>readFileSync(new URL(`../web/${name}.js`,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function runtime(request) {
  const context={URL,URLSearchParams,setTimeout:fn=>{queueMicrotask(fn);return 0;},ats:{request}};
  context.window=context;vm.createContext(context);for(const name of ['model','uigf','network'])vm.runInContext(source(name),context);return context;
}
const row=(id,pool,time='2026-08-22 17:02:00')=>({uid:'fixture-a',id:String(id),gacha_type:pool,uigf_gacha_type:'',item_id:'1',name:`Pool ${pool}`,item_type:'光锥',rank_type:'3',count:'1',time});
const standard=Array.from({length:10},(_,i)=>row(100+i,'1'));
const linked=Array.from({length:4},(_,i)=>row(100+i,'21','2026-08-22 17:02:30'));
const bundle=records=>({account:{game:'hkrpg',uid:'fixture-a',timezone:8,lastSyncAt:1},records,completedPoolTypes:[]});

test('same UID/ID in permanent and collaboration pools are different records',()=>{
  const {gachaModel:m}=runtime();
  assert.notEqual(m.recordKey('hkrpg',standard[0]),m.recordKey('hkrpg',linked[0]));
  assert.notEqual(m.recordKey('hkrpg',standard[0]),m.recordKey('hkrpg',{...standard[0],uid:'fixture-b'}));
  assert.equal(m.recordKey('hk4e',row('alias','301')),m.recordKey('hk4e',row('alias','400')));
});

test('recover missing first four without replacing the four legitimate linked records',()=>{
  const {gachaModel:m}=runtime(),root=m.normalizeDataset({accounts:[{uid:'fixture-a'}],records:[...standard.slice(4),...linked],poolSyncState:[]},'hkrpg');
  const result=m.mergeDataset(root,[bundle(standard)]);
  assert.equal(result.inserted,4);assert.equal(result.skipped,6);assert.equal(root.records.length,14);
  assert.equal(root.records.filter(r=>r.gacha_type==='1').length,10);assert.equal(root.records.filter(r=>r.gacha_type==='21').length,4);
  assert.deepEqual(plain(root.records.filter(r=>r.gacha_type==='21')).map(r=>r.name),linked.map(r=>r.name));
  assert.equal(m.mergeDataset(root,[bundle(standard),bundle(linked)]).inserted,0);assert.equal(root.records.length,14);
});

test('pity counters are isolated even when two pools reuse the same ID',()=>{
  const {gachaModel:m}=runtime(),a=[row('1','1','2026-08-22 17:00:00'),row('2','1','2026-08-22 17:00:01'),row('3','1','2026-08-22 17:00:02'),row('shared','1')],b=[row('shared','21','2026-08-22 17:02:30')];
  const snapshot=m.snapshot('hkrpg',[...a,...b]);
  assert.equal(snapshot.pityByRecord[m.recordKey('hkrpg',a[3])],4);
  assert.equal(snapshot.pityByRecord[m.recordKey('hkrpg',b[0])],1);
});

test('UIGF grouped import and export preserve cross-pool ID collisions',()=>{
  const {gachaModel:m,uigf}=runtime();
  const decoded=uigf.decode({info:{version:'v4.2'},hkrpg:[{uid:'fixture-a',list:standard},{uid:'fixture-a',list:linked}]});
  assert.equal(decoded.length,1);assert.equal(decoded[0].records.length,14);
  const encoded=uigf.encode(decoded,'2.0.0'),roundTrip=uigf.decode(encoded);
  const root=m.normalizeDataset(null,'hkrpg');m.mergeDataset(root,roundTrip);assert.equal(root.records.length,14);
  assert.equal(root.records.filter(r=>r.id==='100').length,2);
});

test('a fresh full download does not discard collisions encountered in a later pool',async()=>{
  const context=runtime(async raw=>{const url=new URL(raw),type=url.searchParams.get('gacha_type');return{status:200,text:JSON.stringify({retcode:0,data:{list:type==='21'?linked:type==='1'?standard:[]}})};});
  const root=context.gachaModel.normalizeDataset(null,'hkrpg');
  const result=await context.gachaNetwork.fetch({game:'hkrpg',parameters:{authkey:'fixture-only'},overseas:false},root,()=>{},{mode:'full'});
  assert.equal(result.records.length,14);context.gachaModel.mergeDataset(root,[result]);assert.equal(root.records.length,14);
});
