(() => {
  const definitions={
    hk4e:[
      {id:'acquaint',label:'相遇之缘',family:'祈愿票券',pools:['200','100'],tone:'info'},
      {id:'intertwined',label:'纠缠之缘',family:'祈愿票券',pools:['301','302','500'],tone:'primary'},
      {id:'beyond-standard',label:'常驻颂愿',family:'千星奇域',pools:['1000'],tone:'success'},
      {id:'beyond-event',label:'活动颂愿',family:'千星奇域',pools:['2000'],tone:'warning'}
    ],
    hkrpg:[
      {id:'pass',label:'星轨通票',family:'跃迁票券',pools:['1','2'],tone:'info'},
      {id:'special-pass',label:'星轨专票',family:'跃迁票券',pools:['11','12','21','22'],tone:'primary'}
    ]
  };
  function resource(game,type){return (definitions[game]||[]).find(item=>item.pools.includes(type))||{id:'unknown',label:'未知资源',family:'其他',pools:[type],tone:'secondary'};}
  function appearance(game,type){const asset=resource(game,type);return {tone:asset.tone,opacity:1-(Math.max(0,asset.pools.indexOf(type))%3)*.18};}
  function date(record){
    const key=String(record.time||'').slice(0,10),parts=/^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if(!parts)return null;
    const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]);
    if(year<100||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;
    return key;
  }
  function version(record,game,timezone=8){
    if(globalThis.gachaReference)return gachaReference.gameVersion(record,game,{timezone}).version;
    const explicit=String(record.game_version||record.version||'').trim();
    if(explicit&&/^\d+(?:\.\d+){1,2}$/.test(explicit))return explicit;
    if(!date(record))return null;
    let stamp=String(record.time||'').replace('T',' ');
    if(game==='hkrpg'&&Number.isFinite(Number(timezone))&&Number(timezone)!==8){
      const parsed=Date.parse(stamp.replace(' ','T')+'Z');
      if(!Number.isFinite(parsed))return null;
      stamp=new Date(parsed+(8-Number(timezone))*3600000).toISOString().slice(0,19).replace('T',' ');
    }
    const match=(globalThis.gachaVersionCalendar?.[game]||[]).find(item=>stamp>=item.start&&stamp<item.end);
    return match?.version||null;
  }
  function catalogs(state){
    const game=state.selected?.game,config=gachaModel.games[game],records=state.snapshot?.records||[];
    if(!config)return {resources:[],pools:[]};
    const available=new Set(records.map(record=>gachaModel.poolType(game,record.uigf_gacha_type||record.gacha_type)));
    const resources=(definitions[game]||[]).filter(asset=>asset.pools.some(pool=>available.has(pool)));
    const known=new Set(resources.flatMap(asset=>asset.pools));
    if([...available].some(pool=>!known.has(pool)))resources.push(resource(game,'unknown'));
    const labels=new Map(config.pools.map(pool=>[pool[0],pool[1]]));
    const order=resources.flatMap(asset=>asset.id==='unknown'?[...available].filter(pool=>!known.has(pool)).sort():asset.pools.filter(pool=>available.has(pool)));
    const pools=order.map(id=>({id,label:labels.get(id)||'未知卡池',resource:resource(game,id).id,...appearance(game,id)}));
    return {resources,pools};
  }
  const indexes=new WeakMap(),fixedPools={hk4e:['200','100','1000'],hkrpg:['1','2']},phasePools={hk4e:['301','302'],hkrpg:['11','12']};
  function indexFor(state){
    const snapshot=state.snapshot,selected=state.selected||{},reference=globalThis.gachaReference?.active(selected.game),signature=JSON.stringify([selected.game,selected.region,selected.timezone,selected.timezoneAssumed]);
    let index=snapshot&&indexes.get(snapshot);if(index&&index.signature===signature&&index.reference===reference)return index;
    const account=globalThis.gachaReference?gachaReference.recordContext(snapshot?.records||[],selected.game,selected):selected;
    index={signature,reference,rows:new Map(),results:new Map(),coverage:{month:0,version:0,phase:0,banner:0},...catalogs(state)};
    for(const record of snapshot?.records||[]){
      const type=gachaModel.poolType(account.game,record.uigf_gacha_type||record.gacha_type),asset=resource(account.game,type),id=String(record.schedule_id||record.gacha_id||''),hasBeyondIdentity=account.game==='hk4e'&&['1000','2000'].includes(type)&&/^\d{1,64}$/.test(id)&&!/^0+$/.test(id),fixed=fixedPools[account.game]?.includes(type)&&!hasBeyondIdentity,regular=phasePools[account.game]?.includes(type);
      const resolved=globalThis.gachaReference?(fixed?gachaReference.gameVersion(record,account.game,account):gachaReference.resolve(record,account.game,account)):{version:version(record,account.game,account.timezone??8)};
      const keys={month:date(record)?.slice(0,7)||null,version:resolved.version||null,phase:regular?resolved.phase||null:null,banner:fixed?'fixed:'+type:(resolved.banner||resolved.nativeIdentity?resolved.identityKey||resolved.banner?.groupingId||resolved.banner?.id||resolved.nativeIdentity?.id:null)};
      index.rows.set(record,{type,asset,keys,resolved});for(const mode of Object.keys(keys))if(keys[mode])index.coverage[mode]++;
    }
    if(snapshot)indexes.set(snapshot,index);return index;
  }
  function availability(state){const coverage=indexFor(state).coverage;return ['month','version','phase','banner'].filter(mode=>coverage[mode]>0);}
  function groupInfo(state,mode,row,key){
    const result=row.resolved,reference=globalThis.gachaReference?.active(state.selected?.game);
    if(mode==='month')return {label:key};
    if(mode==='version')return {label:'版本 '+key,version:key};
    if(mode==='phase'){
      const [version,phase]=key.split(':'),region=gachaReference.regionOf(state.selected),phases=gachaReference.indexFor(reference,region,state.selected.timezone??8).phases.get(version),count=result.phaseSchedule?.phaseCount||phases?.size;
      return {label:'版本 '+version+' · '+(count===2?Number(phase)===1?'上半':'下半':'第 '+phase+' 期'),phaseSchedule:result.phaseSchedule};
    }
    if(key.startsWith('fixed:'))return {label:gachaModel.games[state.selected.game].pools.find(pool=>pool[0]===row.type)?.[1]||row.type,fixed:true};
    if(result.nativeIdentity)return {label:result.nativeIdentity.label,nativeIdentity:result.nativeIdentity};
    const banner=result.banner,items=banner.featured5.map(id=>gachaReference.name(reference,id)).join(' / '),name=gachaReference.bannerName(banner,reference);
    return {label:(banner.identityOnly?'长期联动 · ':banner.version?banner.version+' · ':'')+name+(banner.featured5.length<=2&&items&&items!==name?' · '+items:''),banner,start:banner.start,end:banner.end,precision:banner.precision};
  }
  function allowedRow(filter,row){return (!filter.resources?.length||filter.resources.includes(row.asset.id))&&(!filter.pools?.length||filter.pools.includes(row.type));}
  function compute(state,filter={mode:'month',resources:[],pools:[]}){
    const index=indexFor(state),mode=filter.mode||'month',cacheKey=JSON.stringify([mode,[...(filter.resources||[])].sort(),[...(filter.pools||[])].sort()]);
    if(index.results.has(cacheKey))return index.results.get(cacheKey);
    const {resources,pools}=index,groups=new Map(),poolMap=new Map(pools.map(pool=>[pool.id,pool]));let total=0,selectedTotal=0;
    for(const [record,row] of index.rows){
      if(!allowedRow(filter,row))continue;selectedTotal++;const key=row.keys[mode];if(!key)continue;
      if(!groups.has(key))groups.set(key,{key,...groupInfo(state,mode,row,key),total:0,warningCount:0,segments:new Map(),records:[]});
      const group=groups.get(key),segmentKey=row.asset.id+':'+row.type;
      if(!group.segments.has(segmentKey))group.segments.set(segmentKey,{resource:row.asset.id,resourceLabel:row.asset.label,pool:row.type,poolLabel:poolMap.get(row.type)?.label||row.type,...appearance(state.selected.game,row.type),count:0});
      group.segments.get(segmentKey).count++;group.total++;if(row.resolved.possibleError)group.warningCount++;group.records.push(record);if(date(record)&&String(record.time)>String(group.latestRecord||''))group.latestRecord=String(record.time);total++;
    }
    const poolOrder=new Map(pools.map((pool,i)=>[pool.id,i])),rows=[...groups.values()].map(group=>({...group,segments:[...group.segments.values()].sort((a,b)=>poolOrder.get(a.pool)-poolOrder.get(b.pool))}));
    rows.sort((a,b)=>mode==='version'?compareVersion(b.key,a.key):mode==='phase'?compareVersion(b.key.split(':')[0],a.key.split(':')[0])||Number(b.key.split(':')[1])-Number(a.key.split(':')[1]):mode==='banner'?String(b.latestRecord||'').localeCompare(a.latestRecord||'')||a.label.localeCompare(b.label):b.key.localeCompare(a.key));
    const result={groups:rows,resources,pools,total,selectedTotal,skipped:selectedTotal-total,unit:'抽',availableModes:availability(state)};
    if(index.results.size>=6)index.results.delete(index.results.keys().next().value);index.results.set(cacheKey,result);return result;
  }
  function compareVersion(a,b){const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<Math.max(left.length,right.length);i++){const delta=(left[i]||0)-(right[i]||0);if(delta)return delta;}return 0;}
  function matches(state,filter,key,record){const row=indexFor(state).rows.get(record);return !!row&&allowedRow(filter,row)&&row.keys[filter.mode||'month']===key;}
  function summary(state,scope){
    const filter=scope.filter||{mode:'month'},result=compute(state,filter),group=result.groups.find(item=>item.key===scope.key),records=group?.records||[];
    const byDay=new Map(),byPool=new Map();let undated=0;
    for(const record of records){const type=gachaModel.poolType(state.selected.game,record.uigf_gacha_type||record.gacha_type);if(!byPool.has(type))byPool.set(type,[]);byPool.get(type).push(record);
      const key=date(record);if(!key){undated++;continue;}if(!byDay.has(key))byDay.set(key,{date:key,total:0,pools:new Map()});const day=byDay.get(key);day.total++;day.pools.set(type,(day.pools.get(type)||0)+1);
    }
    if(filter.mode==='month'&&/^\d{4}-\d{2}$/.test(scope.key)){
      const [year,month]=scope.key.split('-').map(Number),count=new Date(Date.UTC(year,month,0)).getUTCDate();
      for(let i=1;i<=count;i++){const key=scope.key+'-'+String(i).padStart(2,'0');if(!byDay.has(key))byDay.set(key,{date:key,total:0,pools:new Map()});}
    }
    const days=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>({...day,segments:result.pools.filter(pool=>day.pools.has(pool.id)).map(pool=>({...pool,count:day.pools.get(pool.id)}))}));
    const segments=group?.segments||[],resources=result.resources.map(asset=>({...asset,count:segments.filter(segment=>segment.resource===asset.id).reduce((sum,segment)=>sum+segment.count,0)})).filter(asset=>asset.count);
    const pools=segments.map(segment=>({...segment,id:segment.pool,label:segment.poolLabel}));
    const fiveStars=records.filter(record=>Number(record.rank_type)===5).sort((a,b)=>String(b.time||'').localeCompare(String(a.time||''))),targetRarity=pools.length&&pools.every(pool=>gachaModel.games[state.selected.game].pools.find(item=>item[0]===pool.id)?.[5]===4)?4:5,targetRecords=targetRarity===5?fiveStars:records.filter(record=>Number(record.rank_type)===4).sort((a,b)=>String(b.time||'').localeCompare(String(a.time||'')));
    const peak=days.reduce((best,day)=>day.total>(best?.total||0)?day:best,null),identities=new Set(records.map(record=>gachaModel.recordKey(state.selected.game,record)));
    const targets=(state.snapshot?.stats||[]).filter(pool=>pool.tracksUp).flatMap(pool=>pool.targetPulls).filter(pull=>identities.has(gachaModel.recordKey(state.selected.game,pull.record)));
    const upCount=targets.filter(pull=>pull.isLoss===false).length,lossCount=targets.filter(pull=>pull.isLoss===true).length,unknownCount=targets.length-upCount-lossCount;
    const targetById=new Map(targets.map(pull=>[gachaModel.recordKey(state.selected.game,pull.record),pull]));
    for(const pool of pools){const list=(byPool.get(pool.id)||[]).slice().sort(gachaModel.order);let completed=0,uncertain=false,completedUncertain=false;pool.upCount=0;pool.lossCount=0;pool.unknownCount=0;
      list.forEach((record,i)=>{const pull=targetById.get(gachaModel.recordKey(state.selected.game,record));if(!pull)return;if(pull.isLoss===false){pool.upCount++;completed=i+1;completedUncertain=uncertain;}else if(pull.isLoss===true)pool.lossCount++;else{pool.unknownCount++;uncertain=true;}});pool.averageUpPity=pool.upCount&&!completedUncertain?completed/pool.upCount:null;
    }
    let interval=null;if(filter.mode==='banner'&&group?.banner?.end&&records.every(record=>gachaReference.inTime(group.banner,record,state.selected)))interval={start:group.banner.start,end:group.banner.end,explanation:group.banner.startExplanation||'已核对地区的卡池开放区间'};
    else if(filter.mode==='version'){const item=globalThis.gachaReference?.active(state.selected.game)?.versions.find(item=>item.version===scope.key&&gachaReference.supportsRegion(item,gachaReference.regionOf(state.selected)));if(item)interval={...item,explanation:item.ongoing?'当前版本；资料已确认至所列时间':'版本日期边界'};}
    else if(filter.mode==='phase'&&group?.phaseSchedule)interval={start:group.phaseSchedule.start,end:group.phaseSchedule.end,explanation:'按该地区实际期次切换时间归类'};
    return {records,total:records.length,warningCount:group?.warningCount||0,fiveStars,targetRarity,targetRecords,resources,pools,days,undated,activeDays:days.filter(day=>day.total).length,peak,upCount,lossCount,unknownCount,interval,nativeIdentity:group?.nativeIdentity||null,referenceRevision:state.snapshot?.referenceRevision};
  }
  globalThis.gachaDistribution={compute,availability,resource,appearance,version,matches,summary};
})();
