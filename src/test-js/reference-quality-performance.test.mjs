import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import test from 'node:test';
import {appFixture} from './helpers/app-fixture.mjs';
function runtime(){let parses=0;class MeasuredDate extends Date{static parse(value){parses++;return super.parse(value);}}
 const c=vm.createContext({TextEncoder,TextDecoder,crypto:webcrypto,console,Date:MeasuredDate});c.window=c;
 for(const file of ['model','presentation','version-calendar','reference-history','reference-data','reference-bundle','distribution','views'])vm.runInContext(readFileSync(new URL(`../web/${file}.js`,import.meta.url),'utf8'),c);
 return {c,parses:()=>parses,reset:()=>{parses=0;}};
}
const cn={game:'hk4e',uid:'fixture-cn',region:'cn_gf01',timezone:8};
const row=(type,id='1')=>({uid:cn.uid,id,gacha_type:type,uigf_gacha_type:type==='400'?'301':type,fieldSources:{gacha_type:'official-record-api'},item_id:'10000143',rank_type:'3',time:'2026-10-01 12:00:00'});
const stateFor=(c,account,records)=>({selected:account,snapshot:c.gachaModel.snapshot(account.game,records,[],['record-field','paimon-moe','star-rail-station'],account.timezone,account)});

test('CN current-version coverage includes permanent, beginner and beyond records without assigning event phases',()=>{
 const {c}=runtime(),records=['301','400','302','200','100','1000','2000','500'].map((type,i)=>row(type,String(i))),state=stateFor(c,cn,records),before=JSON.stringify(records);
 const versions=c.gachaDistribution.compute(state,{mode:'version'});assert.equal(versions.groups.length,1);assert.equal(versions.groups[0].key,'7.1');assert.equal(versions.total,8);
 const phases=c.gachaDistribution.compute(state,{mode:'phase'});assert.equal(phases.total,3);assert.equal(phases.skipped,5);assert.ok(phases.groups.every(group=>group.segments.every(segment=>['301','302'].includes(segment.pool))));
 const banners=c.gachaDistribution.compute(state,{mode:'banner'});assert.equal(banners.total,6);assert.ok(banners.groups.some(group=>group.label==='常驻祈愿'));assert.ok(banners.groups.some(group=>group.label==='新手祈愿'));assert.ok(banners.groups.some(group=>group.label==='千星奇域·常驻颂愿'));
 assert.ok(banners.groups.some(group=>group.banner?.rawTypes.includes('400')&&group.label.includes('沃雅妮莎')));assert.ok(banners.groups.some(group=>group.banner?.rawTypes.includes('301')&&group.label.includes('薇斯纳')));
 assert.ok(banners.groups.every(group=>!/(未知|未覆盖|无法区分)/.test(group.label)));assert.equal(JSON.stringify(records),before);
 for(const filter of [{mode:'version'},{mode:'phase'},{mode:'banner'}])for(const group of c.gachaDistribution.compute(state,filter).groups){const detail=c.gachaDistribution.summary(state,{filter,key:group.key});assert.equal(detail.total,group.total);assert.equal(detail.resources.reduce((n,item)=>n+item.count,0),group.total);assert.equal(detail.pools.reduce((n,item)=>n+item.count,0),group.total);assert.equal(detail.days.reduce((n,day)=>n+day.total,0),group.total);}
});

test('CN star rail uses historical phase boundaries, known native identities and separate fixed pools',()=>{
 const {c}=runtime(),account={...cn,game:'hkrpg',region:'prod_gf_cn'},records=['1','2','11','12','21'].map((type,i)=>({...row(type,String(i)),gacha_id:type==='21'?'5001':''})),state=stateFor(c,account,records);
 assert.equal(c.gachaDistribution.compute(state,{mode:'version'}).total,5);const banners=c.gachaDistribution.compute(state,{mode:'banner'});assert.equal(banners.total,3);assert.ok(banners.groups.some(group=>group.label==='常驻跃迁'));assert.ok(banners.groups.some(group=>group.label==='新手跃迁'));assert.ok(banners.groups.some(group=>group.label.includes('圣剑辉烈之誓')));
 assert.equal(c.gachaDistribution.compute(state,{mode:'phase'}).total,2);assert.ok(c.gachaDistribution.availability(state).includes('phase'));
 const html=c.gachaViews.months(state);assert.match(html,/data-distribution-mode="phase"/);assert.doesNotMatch(html,/期次未知|卡池资料未覆盖/);
 state.distributionFilter={mode:'banner'};assert.match(c.gachaViews.months(state),/已归类 3 \/ 5 抽/);
});
test('missing server/time evidence and ambiguous double banners cannot produce derived groups or UP metrics',()=>{
 const {c}=runtime(),account={...cn,region:'',timezoneAssumed:true},records=[{...row('301'),rank_type:'5'}],state=stateFor(c,account,records);
 assert.deepEqual(Array.from(c.gachaDistribution.availability(state)),['month']);const html=c.gachaViews.months(state);assert.doesNotMatch(html,/data-distribution-mode="(?:version|phase|banner)"|版本未知|期次未知/);
 assert.doesNotMatch(c.gachaViews.overview(state),/平均 UP|已确认 UP/);state.view={key:'301'};state.detailFilter='all';assert.doesNotMatch(c.gachaViews.pool(state),/未知归属|平均 UP|class="badge/);
 const global={...cn,region:'os_asia'},ambiguous=stateFor(c,global,[{...row('301'),time:'2024-06-10 12:00:00'}]);assert.equal(c.gachaDistribution.compute(ambiguous,{mode:'banner'}).total,0);assert.equal(c.gachaDistribution.compute(ambiguous,{mode:'phase'}).total,1);
});

test('CN dates are read from CN history and official updates, with no guessed next-version boundary',()=>{
 const {c}=runtime(),ref=c.gachaReference,html='<table><tr><td>7.0</td><td>2026/08/12</td><td>旧版</td></tr><tr><td>7.2</td><td>2026/11/04</td><td>未来版本</td></tr></table>',observed=Date.parse('2026-10-12T04:00:00Z'),official={retcode:0,data:{list:[{title:'7.1版本更新说明',content:'〓更新时间〓&lt;t&gt;2026/09/23 06:00&lt;/t&gt;开始'}]}};
 const versions=ref.cnVersions(html,'hk4e',observed,official);assert.equal(versions.length,2);assert.equal(versions[0].end,'2026-09-23 06:00:00');assert.equal(versions[1].version,'7.1');assert.equal(versions[1].ongoing,true);assert.equal(versions[1].region,'cn');assert.equal(versions[1].end,'2026-10-12 12:00:01');
 assert.equal(ref.cnVersions(html,'hk4e',observed).length,0,'a stale history table alone cannot prove the current version');
 assert.equal(ref.gameVersion({...row('200'),time:'2026-11-01 12:00:00'},'hk4e',cn,{versions,banners:[]}).version,null);
});

test('large mixed datasets build time indexes once and reuse grouping and record filters',()=>{
 const {c,reset,parses}=runtime(),records=Array.from({length:30000},(_,i)=>({...row(['301','400','302','200','1000','2000'][i%6],String(i)),time:'2026-10-01 '+String(Math.floor(i/3600)).padStart(2,'0')+':'+String(Math.floor(i/60)%60).padStart(2,'0')+':'+String(i%60).padStart(2,'0')})),state=stateFor(c,cn,records);reset();const started=performance.now();
 const first=c.gachaDistribution.compute(state,{mode:'month'});assert.equal(first.total,30000);
 for(const mode of ['version','phase','banner']){const result=c.gachaDistribution.compute(state,{mode});assert.equal(result.total+result.skipped,30000);assert.ok(result.groups.every(group=>group.total===group.records.length));assert.equal(c.gachaDistribution.compute(state,{mode}),result);}
 assert.ok(parses()<records.length*4+5000,'time boundaries must not be reparsed for each record and each grouping');
 const sorted=c.gachaPresentation.records(state.snapshot,cn.game,'','all',0);assert.equal(c.gachaPresentation.records(state.snapshot,cn.game,'','all',0),sorted);assert.equal(sorted[0].id,'29999');assert.equal(records[0].id,'0');
 console.log(JSON.stringify({fixtureRecords:records.length,firstGroupingAndAllModesMs:Math.round(performance.now()-started),dateParses:parses()}));
});

test('opening management does not read peer-game records or reanalyze the selected account',async()=>{
 const f=appFixture({withReference:true});f.values['starrail-records'].accounts=[{uid:'2',timezone:8,region:'prod_gf_cn'}];f.values['starrail-records'].records=Array.from({length:20000},(_,i)=>({...row('11',String(i)),uid:'2'}));await f.app.load();
 const snapshot=f.app.state.snapshot,beforeReads=[...f.reads];let analyses=0;const original=f.context.gachaModel.snapshot;f.context.gachaModel.snapshot=(...args)=>{analyses++;return original(...args);};
 f.app.openView('data');await Promise.resolve();assert.deepEqual(f.reads,beforeReads);assert.equal(analyses,0);assert.equal(f.app.state.snapshot,snapshot);assert.match(f.get('view-content').innerHTML,/UID 1|UID 2/);
 await f.app.loadDataPage();assert.ok(f.reads.includes('genshin-records'));assert.equal(analyses,0);assert.equal(f.app.state.snapshot,snapshot);
});
