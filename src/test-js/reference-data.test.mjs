import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import test from 'node:test';

const source=file=>readFileSync(new URL(`../web/${file}.js`,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function runtime(){const context=vm.createContext({TextEncoder,TextDecoder,crypto:webcrypto,console});context.window=context;for(const file of ['model','version-calendar','reference-history','reference-data','reference-bundle','distribution'])vm.runInContext(source(file),context);return context;}
const account={uid:'fixture',region:'os_asia',timezone:8,game:'hk4e'};
const record=(extra={})=>({uid:'fixture',id:'1',item_id:'10000022',gacha_type:'301',uigf_gacha_type:'301',rank_type:'5',time:'2020-09-30 12:00:00',...extra});
const banner=(extra={})=>({id:'fixture-banner',source:'fixture',pool:'301',rawTypes:['301','400'],gameIds:[],announcementId:null,names:{'zh-cn':'测试池'},version:'1.0',phase:1,start:'2020-09-28 00:00:00',end:'2020-10-18 18:00:00',startBasis:'utc8',endBasis:'server',region:'all',featured5:['10000022'],featured4:[],authority:'community',precision:'minute',...extra});
async function snapshot(ref,extra={}){return ref.seal({formatVersion:1,parserVersion:1,ruleVersion:1,game:'hk4e',sources:[{id:'fixture',url:'https://example.org/public',sha256:'a'.repeat(64)}],items:[],banners:[banner()],versions:[{version:'1.0',start:'2020-09-28 00:00:00',end:'2020-11-11 06:00:00',source:'fixture',basis:'utc8'}],eligibility:[],warnings:[],...extra});}

test('bundled public snapshots pass semantic and hash validation and preserve game ID namespaces',async()=>{
  const {gachaReference:ref}=runtime();for(const game of ['hk4e','hkrpg']){const data=ref.builtin(game);await ref.verify(data,game);assert.ok(data.banners.length>250);assert.ok(data.sources.length>=3);assert.ok(data.sources.every(source=>!/[?&](uid|authkey|cookie)=/i.test(source.url)));}
  assert.ok(ref.builtin('hk4e').banners.filter(item=>item.announcementId).every(item=>item.gameIds.length===0));
  assert.ok(ref.builtin('hkrpg').banners.filter(item=>item.source==='star-rail-station').every(item=>item.gameIds.length===1&&item.start&&item.end));assert.ok(ref.builtin('hkrpg').banners.filter(item=>item.identityOnly).every(item=>item.gameIds.length===1&&item.end===null&&item.identityEvidence));
});
test('historical 1.3 has three character phases; the separately changing weapon pool does not create phase four',()=>{
  const {gachaReference:ref}=runtime(),data=ref.builtin('hk4e');
  const result=ref.resolve(record({time:'2021-03-05 12:00:00'}),'hk4e',account,data);assert.equal(result.phase,'1.3:3');assert.equal(result.banner.featured5[0],'10000046');
  const phases=new Set(data.banners.filter(item=>item.version==='1.3'&&item.pool==='301'&&item.source==='paimon-moe').map(item=>item.phase));assert.deepEqual([...phases].sort(),[1,2,3]);
  const weapon=ref.resolve(record({gacha_type:'302',uigf_gacha_type:'302',time:'2021-02-25 12:00:00'}),'hk4e',account,data);assert.equal(weapon.phase,null);assert.ok(weapon.banner);
});
test('literal parser accepts comments and strings, rejects code and prototype keys without execution',()=>{
  const {gachaReference:ref}=runtime();assert.deepEqual(plain(ref.literals("export const banners = {a: [true, false, 'a\\'b',], /* note */ b: 2};")),{a:[true,false,"a'b"],b:2});
  for(const value of ["export const banners = {a: (()=>{globalThis.executed=true})()};","export const banners = {__proto__: {polluted:true}};","export const banners = {}; globalThis.executed=true;"])assert.throws(()=>ref.literals(value));
  assert.equal({}.polluted,undefined);
});
test('double character wishes stay ambiguous until independently evidenced raw pool mapping is available',async()=>{
  const {gachaReference:ref}=runtime(),a=banner(),b=banner({id:'fixture-2',featured5:['10000029']});const data=await snapshot(ref,{banners:[a,b]});
  const result=ref.resolve(record(), 'hk4e',account,data);assert.equal(result.banner,null);assert.equal(result.phase,'1.0:1');assert.equal(result.candidates.length,2);
  assert.equal(ref.upEvidence(record(),'hk4e',account,['paimon-moe'],data).value,null);
  const mapped=await snapshot(ref,{banners:[{...a,rawTypes:['301']},{...b,rawTypes:['400']}]});assert.equal(ref.resolve(record({fieldSources:{gacha_type:'official-record-api'}}),'hk4e',account,mapped).banner.id,a.id);
  assert.equal(ref.resolve(record({gacha_type:'400',fieldSources:{gacha_type:'official-record-api'}}),'hk4e',account,mapped).banner.id,b.id);
  assert.equal(ref.resolve(record({gachaTypeAssumed:true}),'hk4e',account,mapped).banner,null);
});
test('known raw pool does not imply a character from the obtained item; same unknown outcomes keep candidates',async()=>{
  const {gachaReference:ref}=runtime(),data=await snapshot(ref,{banners:[banner(),banner({id:'fixture-2',featured5:['10000029']})]});
  assert.equal(ref.resolve(record({item_id:'10000022'}),'hk4e',account,data).candidates.length,2);
  assert.equal(ref.upEvidence(record({item_id:'10000003'}),'hk4e',account,['paimon-moe'],data).value,false);
});

test('an official announcement replaces its matching history identity without hiding another simultaneous banner',async()=>{
 const {gachaReference:ref}=runtime(),data=await snapshot(ref,{banners:[banner({id:'first',rawTypes:['301']}),banner({id:'second',rawTypes:['400'],featured5:['10000029']}),banner({id:'official-first',rawTypes:['301'],authority:'official'})]});
 const ambiguous=record({gachaTypeAssumed:true}),result=ref.resolve(ambiguous,'hk4e',account,data);assert.equal(result.banner,null);assert.equal(result.candidates.length,2);assert.deepEqual(Array.from(result.candidates,b=>b.id).sort(),['official-first','second']);assert.equal(ref.upEvidence(ambiguous,'hk4e',account,['paimon-moe'],data).value,null);assert.equal(ref.resolve(record({gacha_type:'400',item_id:'10000029'}),'hk4e',account,data).banner.id,'second');
});

test('explicit non-UP, versioned eligibility and conflicted item evidence cannot invalidate neighbouring subtypes',async()=>{
 const {gachaReference:ref}=runtime(),banners=[banner({id:'first',rawTypes:['301']}),banner({id:'second',rawTypes:['400'],featured5:['10000029']})],data=await snapshot(ref,{banners}),outcome=record({item_id:'10000029'}),neighbour=record({id:'2',rank_type:'3',item_id:'11301'});
 for(const changed of [{...outcome,is_up:false},{...outcome,fieldConflicts:{item_id:[{value:'10000022',source:'fixture'}]}}]){const records=[changed,neighbour],context=ref.recordContext(records,'hk4e',account,data);assert.equal(ref.resolve(changed,'hk4e',context,data).banner.id,'first');assert.equal(ref.resolve(neighbour,'hk4e',context,data).banner.id,'first');}
 const eligible=await snapshot(ref,{banners,eligibility:[{source:'fixture',region:'os_asia',itemId:'10000029',pool:'301',startVersion:'1.0',evidence:{url:'https://example.org/eligibility'}}]}),context=ref.recordContext([outcome,neighbour],'hk4e',account,eligible);ref.validate(eligible,'hk4e');assert.equal(ref.resolve(outcome,'hk4e',context,eligible).banner.id,'first');assert.equal(ref.upEvidence(outcome,'hk4e',context,['paimon-moe'],eligible).value,false);assert.equal(ref.resolve(neighbour,'hk4e',context,eligible).banner.id,'first');
 const records=[outcome,neighbour],uncertain=ref.recordContext(records,'hk4e',account,data);assert.equal(ref.resolve(neighbour,'hk4e',uncertain,data).banner.id,'first');assert.ok(ref.resolve(neighbour,'hk4e',uncertain,data).possibleError);assert.equal(ref.upEvidence(outcome,'hk4e',uncertain,['paimon-moe'],data).value,null);
 const changedReference=ref.recordContext(records,'hk4e',account,eligible);assert.equal(ref.resolve(neighbour,'hk4e',changedReference,eligible).banner.id,'first');
});
test('official promotion checks the probability table and raw type; a name elsewhere in the announcement is insufficient',()=>{
  const {gachaReference:ref}=runtime(),entry=banner({announcementId:'1',names:{'zh-cn':'测试池'},start:'2020-09-28 18:00:00',end:'2020-10-18 18:00:00',maintenanceStart:false,rawTypes:['301']}),items=[{id:'10000022',rarity:5,names:{'zh-cn':'温迪'}},{id:'10000029',rarity:5,names:{'zh-cn':'可莉'}}];
  const content='<table><tr><td>祈愿时间</td><td>5星</td><td>4星</td></tr><tr><td>&lt;t class="t_lc"&gt;2020/09/28 18:00&lt;/t&gt; ~ &lt;t class="t_lc"&gt;2020/10/18 17:59&lt;/t&gt;</td><td>「温迪」</td><td>测试四星</td></tr></table><p>本祈愿属于「角色活动祈愿」</p>';
  const root={retcode:0,data:{list:[{ann_id:1,title:'测试池祈愿',content}]}};assert.equal(ref.announcements(root,[entry],items)[0].authority,'official');
  const wrong={retcode:0,data:{list:[{ann_id:1,title:'测试池祈愿',content:content.replace('<td>「温迪」</td>','<td>「另一角色」</td>')+'<p>过去的角色温迪</p>'}]}};assert.ok(ref.announcements(wrong,[entry],items)[0].conflict);
  const incomplete={retcode:0,data:{list:[{ann_id:1,title:'测试池祈愿',content:content.replace('「温迪」','「温迪」「可莉」')}]}};assert.ok(ref.announcements(incomplete,[entry],items)[0].conflict);
  assert.ok(ref.announcements(root,[{...entry,rawTypes:['400']}],items)[0].conflict);
});
test('explicit version conflicting with an ordinary banner cannot produce a precise phase or confirmed UP',async()=>{
  const {gachaReference:ref}=runtime(),data=await snapshot(ref),result=ref.upEvidence(record({game_version:'1.1'}),'hk4e',account,['paimon-moe'],data);assert.equal(result.version,'1.1');assert.equal(result.phase,null);assert.equal(result.banner,null);assert.equal(result.value,null);assert.equal(result.certainty,'conflict');
});
test('published announcement ending minute includes its last second and excludes the following minute',()=>{
  const {gachaReference:ref}=runtime(),result=ref.watcher({'1':{UIGF_pool_type:301,start_time:'2020/09/28 18:00',end_time:'2020/10/18 17:59',version_number:'1.0',order_number:2,UpOrangeList:[10000022],UpPurpleList:[],'zh-cn':{banner_name:'测试'}}})[0];
  assert.equal(result.end,'2020-10-18 18:00:00');assert.equal(result.endPublished,'2020-10-18 17:59');assert.equal(ref.inTime(result,record({time:'2020-10-18 17:59:59'}),account),true);assert.equal(ref.inTime(result,record({time:'2020-10-18 18:00:00'}),account),false);
});
test('official Epitome Invocation weapon tables establish type 302 without the character-wish membership sentence',()=>{
  const {gachaReference:ref}=runtime(),entry=banner({announcementId:'1',pool:'302',names:{'zh-cn':'神铸赋形'},rawTypes:['302'],featured5:['11111'],start:'2020-09-28 18:00:00',end:'2020-10-18 18:00:00'}),items=[{id:'11111',rarity:5,type:'weapon',names:{'zh-cn':'测试剑'}}],content='<table><tr><td>时间</td><td>概率提升武器（5星）</td><td>概率提升武器（4星）</td></tr><tr><td>&lt;t class="t_lc"&gt;2020/09/28 18:00&lt;/t&gt; ~ &lt;t class="t_lc"&gt;2020/10/18 17:59&lt;/t&gt;</td><td>「单手剑·测试剑」</td><td>测试武器</td></tr></table>',root={retcode:0,data:{list:[{ann_id:1,title:'「神铸赋形」祈愿',content}]}};
  assert.equal(ref.announcements(root,[entry],items)[0].authority,'official');assert.ok(ref.announcements(root,[entry],[{...items[0],type:'character'}])[0].conflict);
});
test('unsupported region, missing time and invalid IDs remain unknown',async()=>{
  const {gachaReference:ref}=runtime(),data=await snapshot(ref,{banners:[banner({region:'os_asia'})]});
  assert.equal(ref.resolve(record(),'hk4e',{...account,region:''},data).banner,null);
  assert.equal(ref.resolve(record(),'hk4e',{...account,timezone:undefined},data).banner,null);
  assert.equal(ref.resolve(record(),'hk4e',{...account,timezoneAssumed:true},data).banner,null);
  assert.equal(ref.resolve(record({time:'2020-02-31 12:00:00'}),'hk4e',account,data).banner,null);
  assert.equal(ref.gameVersion(record({time:'invalid'}),'hk4e',account,data).version,null);
});
test('zero, positive and negative offsets share UTC boundaries and end is exclusive',async()=>{
  const {gachaReference:ref}=runtime(),data=await snapshot(ref,{banners:[banner({start:'2020-09-28 08:00:00',end:'2020-09-29 08:00:00',startBasis:'utc8',endBasis:'utc8'})]});
  for(const [timezone,time] of [[8,'2020-09-28 08:00:00'],[0,'2020-09-28 00:00:00'],[-5,'2020-09-27 19:00:00']])assert.equal(ref.resolve(record({time}),'hk4e',{...account,timezone},data).banner.id,'fixture-banner');
  assert.equal(ref.resolve(record({time:'2020-09-29 00:00:00'}),'hk4e',{...account,timezone:0},data).banner,null);
});
test('CN native identities use cross-checked CN metadata while a legacy overseas-only cache supplies no CN names or UP judgment',()=>{
  const {gachaReference:ref}=runtime(),row=record({gacha_type:'21',uigf_gacha_type:'21',gacha_id:'5001',item_id:'1014',time:'2025-07-20 00:00:00'}),cn={game:'hkrpg',timezone:8,region:'prod_gf_cn'};
  const result=ref.resolve(row,'hkrpg',cn);assert.equal(result.banner.region,'cn');assert.equal(result.banner.names['zh-cn'],'圣剑辉烈之誓');assert.equal(result.phase,null);assert.equal(result.certainty,'identity');assert.ok(result.banner.identityEvidence);
  assert.equal(ref.upEvidence(row,'hkrpg',cn,['star-rail-station']).value,true);
  const legacy={...ref.builtin('hkrpg'),banners:ref.builtin('hkrpg').banners.filter(item=>item.source==='star-rail-station').map(item=>({...item,region:'all'}))};const unsupported=ref.resolve(row,'hkrpg',cn,legacy);assert.equal(unsupported.banner,null);assert.equal(unsupported.nativeIdentity.gameId,'5001');assert.equal(ref.upEvidence(row,'hkrpg',cn,['star-rail-station'],legacy).value,null);
  const overseas=ref.resolve(row,'hkrpg',{timezone:8,region:'os_asia'});assert.equal(overseas.banner.gameIds[0],'5001');assert.equal(overseas.certainty,'identity');
  const unlisted=ref.resolve({...row,gacha_id:'999999'},'hkrpg',cn);assert.equal(unlisted.banner,null);assert.equal(unlisted.nativeIdentity.gameId,'999999');assert.equal(ref.upEvidence({...row,gacha_id:'999999'},'hkrpg',cn,['star-rail-station']).value,null);
});
test('a long-lived special banner keeps its initial version while the pull uses its actual game version',async()=>{
  const {gachaReference:ref}=runtime(),data=await snapshot(ref,{banners:[banner({pool:'500',rawTypes:['500'],end:'2020-12-01 12:00:00'})],versions:[{version:'1.0',start:'2020-09-28 00:00:00',end:'2020-11-11 06:00:00'},{version:'1.1',start:'2020-11-11 06:00:00',end:'2020-12-23 06:00:00'}]});
  const result=ref.resolve(record({gacha_type:'500',uigf_gacha_type:'500',time:'2020-11-12 12:00:00'}),'hk4e',account,data);assert.equal(result.version,'1.1');assert.equal(result.banner.version,'1.0');
});
test('three actual phases display phase 3 and summary, charts and details use the identical record set',async()=>{
  const context=runtime(),ref=context.gachaReference,data=await snapshot(ref,{banners:[1,2,3].map(phase=>banner({id:'phase-'+phase,phase,start:`2020-10-0${phase} 00:00:00`,end:`2020-10-0${phase+1} 00:00:00`}))});
  ref.install('hk4e',{activeRevision:data.revision,snapshots:[data]});const records=[record({id:'1',time:'2020-10-03 12:00:00',is_up:true}),record({id:'2',time:'2020-10-03 12:01:00',rank_type:'3'}),record({id:'3',time:'2020-10-02 12:00:00',rank_type:'3'})],state={selected:account,snapshot:context.gachaModel.snapshot('hk4e',records,[],['record-field'],8,account)};
  const filter={mode:'phase'},result=context.gachaDistribution.compute(state,filter),group=result.groups.find(item=>item.key==='1.0:3');assert.equal(group.label,'版本 1.0 · 第 3 期');assert.equal(group.total,2);
  const summary=context.gachaDistribution.summary(state,{filter,key:group.key});assert.equal(summary.total,2);assert.equal(summary.days.reduce((sum,day)=>sum+day.total,0),2);assert.equal(summary.pools.reduce((sum,pool)=>sum+pool.count,0),2);assert.equal(summary.resources.reduce((sum,item)=>sum+item.count,0),2);assert.equal(summary.fiveStars.length,1);assert.equal(summary.upCount,1);
  assert.deepEqual(plain(summary.records.map(item=>item.id)).sort(),records.filter(item=>context.gachaDistribution.matches(state,filter,group.key,item)).map(item=>item.id).sort());
});
test('malformed, duplicate and overlapping version data fail; hashing catches changed cached content',async()=>{
  const {gachaReference:ref}=runtime(),data=await snapshot(ref);await ref.verify(data,'hk4e');
  assert.throws(()=>ref.validate({...data,banners:[...data.banners,...data.banners]}));
  assert.throws(()=>ref.validate({...data,versions:[...data.versions,{...data.versions[0],version:'1.1'}]}));
  assert.throws(()=>ref.validate({...data,banners:[{...data.banners[0],featured5:[]}]}));
  assert.throws(()=>ref.validate({...data,banners:[{...data.banners[0],featured5:['0']}]}));
  assert.throws(()=>ref.validate({...data,eligibility:true}));
  assert.throws(()=>ref.validate({...data,eligibility:[{itemId:'10000003',pool:'301',startVersion:'1.0'}]}));
  await assert.rejects(ref.verify({...data,banners:[{...data.banners[0],featured5:['10000029']}]},'hk4e'),/哈希/);
});
test('local rule absence never asserts UP; user corrections override explicit fields without changing raw records',()=>{
  const context=runtime(),row=record({time:'2099-01-01 00:00:00',name:'未知新角色'}),before=JSON.stringify(row),identity=context.gachaModel.recordKey('hk4e',row);
  assert.equal(context.gachaModel.snapshot('hk4e',[row],[],['local-rules'],8,account).stats[0].unknownCount,1);
  const corrected=context.gachaModel.snapshot('hk4e',[{...row,is_up:false}],[],['record-field'],8,{...account,overrides:{[identity]:true}});assert.equal(corrected.stats[0].upCount,1);assert.equal(corrected.stats[0].targetPulls[0].evidence.reason,'用户修订');assert.equal(JSON.stringify(row),before);
});
