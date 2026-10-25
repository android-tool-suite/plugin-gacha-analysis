import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
function runtime(){const c=vm.createContext({console,TextEncoder,TextDecoder,crypto:webcrypto});c.window=c;for(const f of ['model','uigf','presentation','version-calendar','reference-history','reference-data','reference-bundle','distribution','views'])vm.runInContext(readFileSync(new URL(`../web/${f}.js`,import.meta.url),'utf8'),c);return c;}
const cn={game:'hk4e',uid:'fixture',region:'cn_gf01',timezone:8},sr={...cn,game:'hkrpg',region:'prod_gf_cn'};
const row=(extra={})=>({uid:'fixture',id:'1',gacha_type:'301',item_id:'10000003',rank_type:'5',time:'2022-01-10 12:00:00',...extra});
const table=(title,version,time,cells)=>`<table class="wikitable"><tr><th colspan="2">${title}</th></tr><tr><th>时间</th><td>${time}</td></tr><tr><th>版本</th><td>${version}</td></tr>${Object.entries(cells).map(([key,value])=>`<tr><th>${key}</th><td>${value}</td></tr>`).join('')}</table>`;
const calendar=[{version:'2.4',region:'cn',start:'2022-01-05 06:00:00',end:'2022-02-16 06:00:00'}],items=[{id:'1',names:{'zh-cn':'测试甲'},rarity:5,type:'character'},{id:'2',names:{'zh-cn':'测试乙'},rarity:5,type:'character'}];

test('nested simultaneous history tables remain distinct and script/style text never becomes a title or code',()=>{
 const c=runtime(),h=c.gachaReferenceHistory,first=table('<style>wrong()</style><script>globalThis.executed=true</script>「测试池甲」032期角色活动祈愿','2.4上半','2.4版本更新后 ~ 2022/01/25 17:59',{'5星角色':'<a title="测试甲">「测试甲」</a>'}),second=table('「测试池乙」032-2期角色活动祈愿','2.4上半','2.4版本更新后 ~ 2022/01/25 17:59',{'5星角色':'<a title="测试乙">「测试乙」</a>'}),parsed=h.parse('<table><tr><td>'+first+second+'</td></tr></table>','hk4e',items,calendar,{source:'fixture',url:'https://example.org/history',typeProof:true});
 assert.equal(parsed.banners.length,2);assert.equal(parsed.banners[0].rawTypes[0],'301');assert.equal(parsed.banners[1].rawTypes[0],'400');assert.equal(parsed.banners[0].names['zh-cn'],'测试池甲');assert.equal(c.executed,undefined);assert.equal(h.phases(parsed.observations,calendar,'hk4e').length,1);
 const withoutProof=h.parse(first+second,'hk4e',items,calendar,{source:'fixture',url:'https://example.org/history'});assert.deepEqual(Array.from(withoutProof.banners[0].rawTypes),['301','400']);
 assert.equal(h.subtypeProof(withoutProof,parsed.banners.map(item=>({...item,authority:'official'}))),true);assert.throws(()=>h.subtypeProof(withoutProof,[{...parsed.banners[0],rawTypes:['400']}]),/冲突/);
});

test('published minute and second ends are interpreted precisely without extending exact hour boundaries',()=>{
 const h=runtime().gachaReferenceHistory;
 assert.equal(h.range('2022/1/5 6:00 ~ 2022/1/25 17:59','2.4',calendar).end,'2022-01-25 18:00:00');
 assert.equal(h.range('2022/1/5 6:00:00 ~ 2022/1/25 17:59:59','2.4',calendar).end,'2022-01-25 18:00:00');
 assert.equal(h.range('2022/1/5 6:00 ~ 2022/1/25 15:00','2.4',calendar).end,'2022-01-25 15:00:00');
 assert.throws(()=>h.range('2022/2/30 6:00 ~ 2022/3/01 15:00','2.4',calendar),/日期/);
});

test('an incomplete five-star dictionary cannot silently turn a partial promotion list into a complete list',()=>{
 const h=runtime().gachaReferenceHistory;assert.throws(()=>h.itemIds(['<a title="测试甲">「测试甲」</a><a title="缺失角色">「缺失角色」</a>'],items,5,'character'),/完整/);
 assert.equal(h.itemIds(['<a title="缺失角色">「缺失角色」</a>'],items,4,'character').length,0);
});

test('time-based CN phases work without an independent identity, including three periods and weapon changes',()=>{
 const c=runtime(),ref=c.gachaReference;
 for(const [time,expected] of [['2021-02-10 12:00:00','1.3:1'],['2021-02-25 12:00:00','1.3:2'],['2021-03-05 12:00:00','1.3:3']])assert.equal(ref.resolve(row({gacha_type:'302',time}),'hk4e',cn).phase,expected);
 const ambiguous=ref.resolve(row({gachaTypeAssumed:true,gacha_type:'301',time:'2022-01-10 12:00:00'}),'hk4e',cn);assert.equal(ambiguous.banner,null);assert.equal(ambiguous.phase,'2.4:1');
 const rail=ref.resolve(row({gacha_type:'11',time:'2026-01-29 12:00:00'}),'hkrpg',sr);assert.equal(rail.phase,'3.8:3');assert.equal(rail.phaseSchedule.phaseCount,3);
});

test('a mismatched subtype retains its supplied banner with a warning without propagating the obtained character identity',()=>{
 const c=runtime(),ref=c.gachaReference,records=[row({id:'1',item_id:'10000030',time:'2022-09-02 12:00:00'}),row({id:'2',item_id:'11301',rank_type:'3',time:'2022-09-02 12:00:01'})],before=JSON.stringify(records),account=ref.recordContext(records,'hk4e',cn);
 for(const record of records){const result=ref.resolve(record,'hk4e',account);assert.equal(result.version,'3.0');assert.equal(result.phase,'3.0:1');assert.equal(result.rawTypeVerified,false);assert.equal(ref.bannerName(result.banner,ref.active('hk4e')),'巡御蘙荟');assert.equal(result.certainty,'unique');assert.ok(result.possibleError);assert.match(result.identityBasis,/可能错误/);assert.deepEqual(Array.from(result.candidates,b=>ref.bannerName(b,ref.active('hk4e'))),['巡御蘙荟']);}
 assert.equal(ref.upEvidence(records[0],'hk4e',cn,['paimon-moe']).value,null);
 const state={selected:cn,snapshot:c.gachaModel.snapshot('hk4e',records,[],['paimon-moe'],8,cn)};assert.equal(state.snapshot.stats[0].lossCount,0);assert.equal(state.snapshot.stats[0].upCount,0);assert.equal(c.gachaDistribution.compute(state,{mode:'phase'}).total,2);assert.equal(c.gachaDistribution.compute(state,{mode:'version'}).total,2);const shown=c.gachaDistribution.compute(state,{mode:'banner'});assert.equal(shown.total,2);assert.equal(shown.groups[0].warningCount,2);assert.equal(JSON.stringify(records),before);
 const source={fieldSources:{gacha_type:'official-record-api'}};
 assert.equal(ref.bannerName(ref.resolve({...records[0],...source,item_id:'10000069'},'hk4e',cn).banner,ref.active('hk4e')),'巡御蘙荟');
 assert.equal(ref.bannerName(ref.resolve({...records[0],...source,gacha_type:'400'},'hk4e',cn).banner,ref.active('hk4e')),'陵薮市朝');
 assert.equal(ref.bannerName(ref.resolve({...records[0],...source,item_id:'10000035'},'hk4e',cn).banner,ref.active('hk4e')),'巡御蘙荟');
});

test('legacy and UIGF subtypes remain usable and a fresh official response can confirm the unchanged field',()=>{
 const c=runtime(),old=row({item_id:'10000069',time:'2022-09-02 12:00:00'}),before=JSON.stringify(old),imported=c.gachaModel.normalizeRecord(old,'hk4e','fixture',{source:'uigf-import'});
 const duplicate=c.gachaModel.mergeRecord(old,imported);assert.equal(duplicate.record.fieldSources?.gacha_type,undefined);assert.equal(c.gachaReference.bannerName(c.gachaReference.resolve(duplicate.record,'hk4e',cn).banner,c.gachaReference.active('hk4e')),'巡御蘙荟');
 const fresh=c.uigf.decode({hk4e:[{uid:'fixture',timezone:8,region:cn.region,list:[old]}]})[0].records[0];assert.equal(fresh.fieldSources.gacha_type,'uigf-import');assert.equal(c.gachaReference.bannerName(c.gachaReference.resolve(fresh,'hk4e',cn).banner,c.gachaReference.active('hk4e')),'巡御蘙荟');
 const fetched=c.gachaModel.normalizeRecord(old,'hk4e','fixture',{source:'official-record-api'}),verified=c.gachaModel.mergeRecord(old,fetched);assert.equal(verified.enriched,true);assert.equal(verified.record.fieldSources.gacha_type,'official-record-api');assert.equal(verified.record.gacha_type,old.gacha_type);assert.equal(c.gachaReference.bannerName(c.gachaReference.resolve(verified.record,'hk4e',cn).banner,c.gachaReference.active('hk4e')),'巡御蘙荟');assert.equal(JSON.stringify(old),before);
 const verifiedImport=c.gachaModel.mergeRecord(imported,fetched);assert.equal(verifiedImport.enriched,true);assert.equal(verifiedImport.record.fieldSources.gacha_type,'official-record-api');assert.equal(c.gachaReference.resolve(verifiedImport.record,'hk4e',cn).rawTypeVerified,true);assert.equal(c.gachaModel.mergeRecord(verifiedImport.record,fetched).enriched,false);
});

test('subtype warnings stay within their account, active banners, original type and source',()=>{
 const c=runtime(),ref=c.gachaReference,bad=row({id:'1',item_id:'10000030',time:'2022-09-02 12:00:00'}),neighbour=row({id:'2',item_id:'11301',rank_type:'3',time:'2022-09-02 12:00:01'});
 const second={...bad,id:'3',gacha_type:'400'},later={...bad,id:'4',item_id:'10000037',time:'2022-09-15 12:00:00'},imported={...bad,id:'5',item_id:'10000069',fieldSources:{gacha_type:'uigf-import'}},official={...imported,id:'6',fieldSources:{gacha_type:'official-record-api'}},other={...imported,id:'7',uid:'other',fieldSources:undefined};
 const records=[bad,neighbour,second,later,imported,official,other],before=JSON.stringify(records),account=ref.recordContext(records,'hk4e',cn),name=(r,a=account)=>{const result=ref.resolve(r,'hk4e',a);return result.banner?ref.bannerName(result.banner,ref.active('hk4e')):null;};
 assert.equal(name(bad),'巡御蘙荟');assert.equal(name(neighbour),'巡御蘙荟');assert.equal(name(second),'陵薮市朝');assert.equal(name(later),'浮生孰来');assert.equal(name(imported),'巡御蘙荟');assert.equal(name(official),'巡御蘙荟');assert.equal(name(other,ref.recordContext(records,'hk4e',{...cn,uid:'other'})),'巡御蘙荟');
 assert.ok(ref.resolve(bad,'hk4e',account).possibleError);assert.ok(ref.resolve(neighbour,'hk4e',account).possibleError);for(const r of [second,later,imported,official])assert.equal(ref.resolve(r,'hk4e',account).possibleError,null);assert.equal(ref.resolve(other,'hk4e',ref.recordContext(records,'hk4e',{...cn,uid:'other'})).possibleError,null);
 assert.equal(ref.recordContext(records,'hk4e',cn).subtypeEvidence,account.subtypeEvidence);
 const own=records.filter(r=>r.uid===cn.uid),state={selected:cn,snapshot:c.gachaModel.snapshot('hk4e',own,[],['paimon-moe'],8,cn)},banners=c.gachaDistribution.compute(state,{mode:'banner'});assert.equal(banners.total,6);assert.equal(banners.skipped,0);assert.equal(c.gachaDistribution.compute(state,{mode:'phase'}).total,own.length);assert.equal(state.snapshot.stats[0].upCount,4);assert.equal(state.snapshot.stats[0].lossCount,0);
 for(const group of banners.groups){const expected=group.banner.featured5.includes('10000069');assert.equal(c.gachaDistribution.matches(state,{mode:'banner'},group.key,bad),expected);assert.equal(c.gachaDistribution.matches(state,{mode:'banner'},group.key,neighbour),expected);const detail=c.gachaDistribution.summary(state,{filter:{mode:'banner'},key:group.key});assert.equal(detail.total,group.total);assert.equal(detail.warningCount,expected?2:0);}
 assert.equal(JSON.stringify(records),before);
});

test('standard UIGF import and repeat merge preserve subtype warnings and all supplied banner groups',()=>{
 const c=runtime(),rows=[row({id:'1',item_id:'10000030',time:'2022-09-02 12:00:00'}),row({id:'2',item_id:'11301',rank_type:'3',time:'2022-09-02 12:00:01'}),row({id:'3',gacha_type:'400',item_id:'10000030',time:'2022-09-02 12:00:02'}),row({id:'4',item_id:'10000037',time:'2022-09-15 12:00:00'})],bundles=c.uigf.decode({hk4e:[{uid:cn.uid,region:cn.region,timezone:8,list:rows}]}),root=c.gachaModel.normalizeDataset(null,'hk4e');
 assert.equal(c.gachaModel.mergeDataset(root,bundles).inserted,4);const before=JSON.stringify(root.records),again=c.gachaModel.mergeDataset(root,bundles);assert.equal(again.inserted,0);assert.equal(again.skipped,4);assert.equal(again.conflicted,0);assert.equal(JSON.stringify(root.records),before);
 const account={...root.accounts[0],game:'hk4e'},state={selected:account,snapshot:c.gachaModel.snapshot('hk4e',root.records,[],['paimon-moe'],8,account)},banners=c.gachaDistribution.compute(state,{mode:'banner'});assert.equal(banners.total,4);assert.equal(banners.groups.length,3);assert.equal(banners.groups.reduce((n,g)=>n+g.warningCount,0),2);assert.equal(state.snapshot.stats[0].upCount,2);assert.equal(state.snapshot.stats[0].lossCount,0);
 const exported=JSON.parse(c.uigf.encode([{account,records:root.records}],'fixture'));assert.equal(exported.hk4e[0].list.find(r=>r.id==='3').gacha_type,'400');assert.equal(JSON.stringify(root.records),before);
});

test('raw subtype disagreement preserves a known phase when both values share the same normalized pool',()=>{
 const c=runtime(),old=row({item_id:'10000030',time:'2022-09-02 12:00:00'}),before=JSON.stringify(old),incoming=c.gachaModel.normalizeRecord({...old,gacha_type:'400'},'hk4e',cn.uid,{source:'official-record-api'}),merged=c.gachaModel.mergeRecord(old,incoming),result=c.gachaReference.resolve(merged.record,'hk4e',cn);
 assert.equal(merged.conflicted,true);assert.equal(merged.record.gacha_type,'301');assert.equal(result.banner,null);assert.equal(result.certainty,'conflict');assert.equal(result.version,'3.0');assert.equal(result.phase,'3.0:1');assert.equal(JSON.stringify(old),before);
 const different={...old,fieldConflicts:{gacha_type:[{value:'302',source:'fixture'}]}};assert.equal(c.gachaReference.resolve(different,'hk4e',cn).phase,null);
});

test('native identity and a verified UP list survive timing mismatches; phase stays tied to the record time',()=>{
 const ref=runtime().gachaReference,r=row({gacha_type:'11',gacha_id:'2003',item_id:'1102',time:'2025-01-20 12:00:00'}),result=ref.resolve(r,'hkrpg',sr);
 assert.equal(result.banner.gameIds[0],'2003');assert.equal(result.timeMatch,false);assert.equal(result.phase,'3.0:1');assert.equal(ref.upEvidence(r,'hkrpg',sr,['star-rail-station']).value,true);
 const conflicting={...r,fieldConflicts:{time:[{value:'2020-01-01 00:00:00',source:'fixture'}]}};assert.equal(ref.resolve(conflicting,'hkrpg',sr).phase,null);assert.ok(ref.resolve(conflicting,'hkrpg',sr).banner);assert.equal(ref.upEvidence(conflicting,'hkrpg',sr,['star-rail-station']).value,true);
 const idConflict={...r,fieldConflicts:{gacha_id:[{value:'2004',source:'fixture'}]}};assert.equal(ref.resolve(idConflict,'hkrpg',sr).banner,null);assert.equal(ref.resolve(idConflict,'hkrpg',sr).phase,'3.0:1');assert.equal(ref.upEvidence(idConflict,'hkrpg',sr,['star-rail-station']).value,null);
});

test('original-ID fallback forms a stable group without inventing a name, regional interval or UP',()=>{
 const c=runtime(),r=row({gacha_type:'11',gacha_id:'999999',time:'2025-01-20 12:00:00'}),state={selected:sr,snapshot:c.gachaModel.snapshot('hkrpg',[r],[],[],8,sr)},filter={mode:'banner'},group=c.gachaDistribution.compute(state,filter).groups[0];
 assert.equal(group.total,1);assert.match(group.label,/ID 999999/);assert.equal(c.gachaDistribution.summary(state,{filter,key:group.key}).interval,null);assert.equal(c.gachaReference.upEvidence(r,'hkrpg',sr,['star-rail-station']).value,null);
 const invalid=c.gachaReference.resolve({...r,gacha_id:'0'},'hkrpg',sr);assert.equal(invalid.nativeIdentity,null);
});

test('long-term CN collaboration identities are not clipped to overseas endings and never enter normal phases',()=>{
 const c=runtime(),ref=c.gachaReference,r=row({gacha_type:'21',gacha_id:'5001',item_id:'1014',time:'2026-01-20 12:00:00'}),result=ref.resolve(r,'hkrpg',sr);
 assert.equal(result.banner.region,'cn');assert.equal(result.banner.end,null);assert.equal(result.phase,null);assert.equal(result.version,'3.8');assert.equal(ref.upEvidence(r,'hkrpg',sr,['star-rail-station']).value,true);
 const state={selected:sr,snapshot:c.gachaModel.snapshot('hkrpg',[r],[],[],8,sr)},filter={mode:'banner'},group=c.gachaDistribution.compute(state,filter).groups[0];assert.match(group.label,/长期联动/);assert.equal(c.gachaDistribution.summary(state,{filter,key:group.key}).interval,null);
});

test('selection banner identities are split by original IDs while unverified selected-UP rules remain uncomputed',()=>{
 const c=runtime(),ref=c.gachaReference,r=row({gacha_type:'11',gacha_id:'2061',item_id:'1309',time:'2025-02-10 12:00:00'}),result=ref.resolve(r,'hkrpg',sr);
 assert.equal(result.banner.gameIds[0],'2061');assert.equal(result.banner.upListVerified,false);assert.ok(result.banner.sourceFeatured5.includes('1309'));assert.equal(ref.upEvidence(r,'hkrpg',sr,['star-rail-station']).value,null);
 const snapshot=c.gachaModel.snapshot('hkrpg',[{...r,is_up:true}],[],['record-field','star-rail-station'],8,sr);assert.equal(snapshot.stats[0].upCount,1);assert.equal(snapshot.stats[0].targetPulls[0].evidence.reason,'记录自带标记');
 assert.equal(ref.upEvidence({...r,gacha_id:''},'hkrpg',sr,['star-rail-station']).value,null);
});

test('malformed or overlapping phase intervals and invalid identity seeds are rejected',async()=>{
 const ref=runtime().gachaReference,data=ref.builtin('hk4e');assert.throws(()=>ref.validate({...data,phases:true}),/期次/);assert.throws(()=>ref.validate({...data,phases:[data.phases[0],data.phases[0]]}),/期次/);assert.throws(()=>ref.validate({...data,roleTypeMappingVerified:'yes'}),/标记/);
 const rail=ref.builtin('hkrpg');assert.throws(()=>ref.validate({...rail,cnIdentitySeeds:{source:rail.cnIdentitySeeds.source,entries:[]}}),/身份/);await ref.verify(data,'hk4e');await ref.verify(rail,'hkrpg');
});

test('assumed per-record clocks are not promoted by account defaults; an actual duplicate can verify the same timestamp',()=>{
 const c=runtime(),old=row({timezone:8,timezoneAssumed:true});assert.equal(c.gachaReference.timezoneOf(old,cn),null);assert.equal(c.gachaReference.resolve(old,'hk4e',cn).phase,null);
 const merged=c.gachaModel.mergeRecord(old,c.gachaModel.normalizeRecord(row({timezone:0}),'hk4e','fixture',{source:'official-record-api'}));assert.equal(merged.record.timezone,0);assert.equal(merged.record.timezoneAssumed,false);assert.equal(c.gachaReference.timezoneOf(merged.record,cn),0);assert.equal(merged.record.time,old.time);
 const different=c.gachaModel.mergeRecord(old,c.gachaModel.normalizeRecord(row({timezone:0,time:'2022-01-10 04:00:00'}),'hk4e','fixture',{source:'official-record-api'}));assert.equal(different.record.timezoneAssumed,true);assert.equal(different.record.time,old.time);assert.ok(different.record.fieldConflicts.time);assert.equal(c.gachaReference.resolve(different.record,'hk4e',cn).phase,null);
 for(const zone of [false,true,{},'bad'])assert.throws(()=>c.uigf.decode({hk4e:[{uid:'fixture',timezone:zone,list:[row()]}]}),/时区/);
 assert.equal(c.gachaReference.timezoneOf({timezone:false},cn),null);
});

test('chronicle group labels remain compact while original membership data is preserved',()=>{
 const c=runtime(),r=row({gacha_type:'500',time:'2026-03-01 12:00:00'}),state={selected:cn,snapshot:c.gachaModel.snapshot('hk4e',[r],[],[],8,cn)},group=c.gachaDistribution.compute(state,{mode:'banner'}).groups[0];assert.ok(group.banner.featured5.length>2);assert.ok(group.label.length<35);assert.match(group.label,/晨风之诗/);
});

test('rolling version feeds retain previously verified intervals without extending unknown gaps',()=>{
 const ref=runtime().gachaReference,old=[{version:'4.6',region:'cn',start:'2026-09-28 06:00:00',end:'2026-10-13 12:00:00',ongoing:true}],before=JSON.stringify(old);
 assert.equal(ref.retainCnVersions([],old)[0].end,old[0].end);const updated=ref.retainCnVersions([{version:'4.7',region:'cn',start:'2026-11-11 06:00:00',end:'2026-12-01 12:00:00',ongoing:true}],old);assert.equal(updated[0].end,'2026-11-11 06:00:00');assert.equal(updated[0].ongoing,false);
 const skipped=ref.retainCnVersions([{version:'5.0',region:'cn',start:'2027-01-01 06:00:00',end:'2027-01-02 12:00:00',ongoing:true}],old);assert.equal(skipped[0].end,old[0].end);assert.equal(JSON.stringify(old),before);
});

test('beyond schedule IDs keep distinct identities and the permanent beyond scope uses its actual four-star target',()=>{
 const c=runtime(),records=[row({id:'1',gacha_type:'1000',gacha_id:'7001',rank_type:'4'}),row({id:'2',gacha_type:'1000',gacha_id:'7002',rank_type:'4'}),row({id:'3',gacha_type:'20021',gacha_id:'7101'})],state={selected:cn,snapshot:c.gachaModel.snapshot('hk4e',records,[],[],8,cn)};const result=c.gachaDistribution.compute(state,{mode:'banner'});assert.equal(result.total,3);assert.equal(result.groups.length,3);assert.equal(c.gachaDistribution.compute(state,{mode:'phase'}).total,0);const group=result.groups.find(item=>item.label.includes('7001')),scope={filter:{mode:'banner'},key:group.key,label:group.label};const summary=c.gachaDistribution.summary(state,scope);assert.equal(summary.targetRarity,4);assert.equal(summary.targetRecords.length,1);assert.equal(summary.fiveStars.length,0);state.view=scope;assert.match(c.gachaViews.distributionSummary(state),/四星获取|四星明细/);assert.doesNotMatch(c.gachaViews.distributionSummary(state),/UP 名单尚未核验|平均 UP/);
});
