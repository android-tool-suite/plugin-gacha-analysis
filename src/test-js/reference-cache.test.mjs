import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
function runtime(){const context=vm.createContext({TextEncoder,TextDecoder,crypto:webcrypto,console});context.window=context;for(const file of ['version-calendar','reference-history','reference-data','reference-bundle'])vm.runInContext(readFileSync(new URL(`../web/${file}.js`,import.meta.url),'utf8'),context);return context.gachaReference;}
const config={retcode:0,data:{all_avatar:[{id:10000022,name:'Venti',level:5}],all_weapon:[{id:11111,name:'Fixture Sword',level:5}]}};
const raw="export const banners = {characters:[{name:'Fixture',start:'2020-09-28 00:00:00',end:'2020-10-18 18:00:00',version:'1.0',featured:['venti']},{name:'Fixture',start:'2020-11-11 06:00:00',end:'2020-12-01 18:00:00',version:'1.1',featured:['venti']}],weapons:[{name:'Fixture',start:'2020-09-28 00:00:00',end:'2020-10-18 18:00:00',version:'1.0',featured:['fixture_sword']}],chronicled:[{name:'Fixture',start:'2020-09-28 00:00:00',end:'2020-12-01 18:00:00',version:'1.0',featured:['venti']}]};";
const watcher={'1':{UIGF_pool_type:301,start_time:'2020/09/28 00:00',end_time:'2020/10/18 17:59',version_number:'1.0',order_number:1,UpOrangeList:[10000022],UpPurpleList:[],'zh-cn':{banner_name:'测试祈愿'}}};
function client(ref,{status=200,bad=false,failWrite=false,pending=false}={}){const writes=[],requests=[];let resolve;
  const request=async url=>{requests.push(url);if(status!==200)return {status,text:'{}'};const text=url===ref.urls.paimon?bad?'export const banners = {changed: true};':raw:url===ref.urls.watcher?JSON.stringify(watcher):[ref.urls.genshinItems,ref.urls.genshinNames].includes(url)?JSON.stringify(config):JSON.stringify({retcode:0,data:{list:[]}});return {status,text};};
  return {requests,writes,request,readDataset:async()=>null,writeDataset:async(id,bytes)=>{writes.push({id,value:JSON.parse(new TextDecoder().decode(bytes))});if(failWrite)throw Error('disk full');if(pending)await new Promise(done=>{resolve=done;});},resolve:()=>resolve?.()};
}
test('candidate cache is published only after commit, raw user datasets and settings are never written',async()=>{
  const ref=runtime(),before=ref.active('hk4e').revision,c=client(ref,{pending:true}),updating=ref.update(c,'hk4e');
  while(!c.writes.length)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(ref.active('hk4e').revision,before);assert.equal(c.writes[0].id,'genshin-reference');c.resolve();const result=await updating;assert.equal(result.changed,true);assert.notEqual(ref.active('hk4e').revision,before);assert.deepEqual(c.writes.map(item=>item.id),['genshin-reference']);await ref.verify(result.snapshot,'hk4e');
});
for(const options of [{status:429},{status:403},{bad:true},{failWrite:true}])test(`network, permission, parser or commit failure keeps last valid snapshot ${JSON.stringify(options)}`,async()=>{
  const ref=runtime(),before=ref.active('hk4e').revision,c=client(ref,options);await assert.rejects(ref.update(c,'hk4e'));assert.equal(ref.active('hk4e').revision,before);if(!options.failWrite)assert.equal(c.writes.length,0);
});
test('unchanged data reports unchanged and keeps at most three verifiable generations',async()=>{
  const ref=runtime(),c=client(ref);const first=await ref.update(c,'hk4e'),second=await ref.update(c,'hk4e');assert.equal(first.changed,true);assert.equal(second.changed,false);assert.equal(first.snapshot.contentRevision,second.snapshot.contentRevision);assert.equal(second.store.snapshots.length,2);
  for(let i=0;i<4;i++){const request=c.request;c.request=async url=>{const response=await request(url);if(url===ref.urls.paimon)response.text=response.text.replace("name:'Fixture'","name:'Revision "+i+"'");return response;};await ref.update(c,'hk4e');}
  assert.equal(ref.current(c.writes.at(-1).value).revision,ref.active('hk4e').revision);assert.equal(c.writes.at(-1).value.snapshots.length,3);for(const snapshot of c.writes.at(-1).value.snapshots)await ref.verify(snapshot,'hk4e');
});
test('old backups with no cache use bundled data; corrupt cache cannot replace active snapshot',async()=>{
  const ref=runtime(),c=client(ref);assert.equal(await ref.load(c,'hkrpg'),null);const before=ref.active('hkrpg').revision;
  c.readDataset=async()=>new TextEncoder().encode(JSON.stringify({formatVersion:1,game:'hkrpg',activeRevision:before,snapshots:[{...ref.active('hkrpg'),revision:'0'.repeat(64)}]}));await assert.rejects(ref.load(c,'hkrpg'));assert.equal(ref.active('hkrpg').revision,before);
});

test('a failed commit cannot mutate the previous in-memory snapshot while canonical identities are prepared',async()=>{
 const ref=runtime(),builtin=ref.builtin('hk4e'),older=await ref.seal({...builtin,banners:builtin.banners.map(item=>{const copy={...item};delete copy.groupingId;return copy;})});ref.install('hk4e',{activeRevision:older.revision,snapshots:[older]});const before=JSON.stringify(ref.active('hk4e'));await assert.rejects(ref.update(client(ref,{failWrite:true}),'hk4e'),/disk full/);assert.equal(JSON.stringify(ref.active('hk4e')),before);
});
