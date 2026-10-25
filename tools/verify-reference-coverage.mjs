import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto,createHash} from 'node:crypto';
import vm from 'node:vm';

// Read-only local validation. Reports counts and digests, never account IDs, records or credentials.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),input=resolve(process.argv[2]||'../../temp/gacha-reference/real-import/input');
const context=vm.createContext({TextEncoder,TextDecoder,crypto:webcrypto,console});context.window=context;
for(const file of ['model','presentation','version-calendar','reference-history','reference-data','reference-bundle','distribution'])vm.runInContext(readFileSync(resolve(root,'src/web/'+file+'.js'),'utf8'),context);
const {gachaModel:model,gachaReference:ref,gachaDistribution:distribution}=context,reports=[];
for(const [game,name] of [['hk4e','genshin-records.json'],['hkrpg','starrail-records.json']]){
  const path=resolve(input,name),bytes=readFileSync(path),digest=createHash('sha256').update(bytes).digest('hex'),data=JSON.parse(bytes.toString('utf8'));
  for(const [index,account] of data.accounts.entries()){
    const records=data.records.filter(item=>String(item.uid)===String(account.uid)),before=JSON.stringify(records),selected={...account,game},analysisAccount=ref.recordContext(records,game,selected),snapshot=model.snapshot(game,records,[],['record-field','paimon-moe','star-rail-station'],account.timezone,selected),state={selected,snapshot};
    assert.equal(new Set(records.map(record=>model.recordKey(game,record))).size,records.length,'duplicate original identities');assert.equal(snapshot.stats.reduce((sum,pool)=>sum+pool.total,0),records.length,'basic pool totals disagree');
    const coverage={},resources=distribution.compute(state,{mode:'month'}).resources;
    for(const mode of ['month','version','phase','banner']){
      const result=distribution.compute(state,{mode});coverage[mode]={records:result.total,excluded:result.skipped,groups:result.groups.length};assert.equal(result.total+result.skipped,records.length);
      for(const filter of [{mode},...resources.map(resource=>({mode,resources:[resource.id]})),...snapshot.stats.map(pool=>({mode,pools:[pool.type]}))]){
        const filtered=distribution.compute(state,filter);assert.equal(filtered.groups.reduce((sum,group)=>sum+group.total,0),filtered.total);
        for(const group of filtered.groups){
          const summary=distribution.summary(state,{filter,key:group.key});assert.equal(summary.total,group.total);assert.equal(summary.resources.reduce((sum,item)=>sum+item.count,0),group.total);assert.equal(summary.pools.reduce((sum,item)=>sum+item.count,0),group.total);assert.equal(summary.days.reduce((sum,day)=>sum+day.total,0)+summary.undated,group.total);assert.equal(summary.fiveStars.length,summary.records.filter(record=>Number(record.rank_type)===5).length);assert.ok(summary.records.every(record=>distribution.matches(state,filter,group.key,record)));
        }
      }
    }
    const ordinary=game==='hk4e'?['301','302']:['11','12'],eligible=records.filter(record=>ordinary.includes(model.poolType(game,record.uigf_gacha_type||record.gacha_type))&&ref.gameVersion(record,game,selected).version&&ref.timezoneOf(record,selected)!==null&&!['time','timezone','region','gacha_type'].some(field=>record.fieldConflicts?.[field]?.length));
    assert.equal(coverage.phase.records,eligible.length,'ordinary records with known version/time must have phase coverage');
    if(game==='hkrpg')assert.equal(coverage.banner.records,records.length,'native star-rail IDs and fixed pools must all remain groupable');
    const suspectParallel=game==='hk4e'?records.map(record=>ref.resolve(record,game,analysisAccount)).filter(result=>result.subtypeMismatch):[];
    assert.ok(suspectParallel.every(result=>result.banner&&result.possibleError&&result.certainty==='unique'),'suspect subtype cohorts must retain their supplied banner with a warning');
    assert.equal(JSON.stringify(records),before,'analysis changed original fields');
    const outcomes=records.filter(record=>Number(record.rank_type)===5).map(record=>ref.upEvidence(record,game,analysisAccount,[game==='hk4e'?'paimon-moe':'star-rail-station']));
    reports.push({game,accountOrdinal:index+1,records:records.length,coverage,possibleErrorParallelRecords:suspectParallel.length,publicUpKnown:outcomes.filter(item=>item.value!==null).length,publicUpUncomputed:outcomes.filter(item=>item.value===null).length,originalFieldsUnchanged:true,sourceSha256:digest});
  }
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),digest,'source file was changed');
}
console.log(JSON.stringify({verified:true,reports},null,2));
