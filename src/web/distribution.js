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
  function groupKey(state,filter,record){return filter.mode==='version'?(version(record,state.selected?.game,state.selected?.timezone??8)||'unknown'):(date(record)?.slice(0,7)||'unknown');}
  function allowed(state,filter,record){
    const type=gachaModel.poolType(state.selected?.game,record.uigf_gacha_type||record.gacha_type),asset=resource(state.selected?.game,type);
    return (!filter.resources?.length||filter.resources.includes(asset.id))&&(!filter.pools?.length||filter.pools.includes(type));
  }
  function compute(state,filter={mode:'month',resources:[],pools:[]}){
    const game=state.selected?.game,{resources,pools}=catalogs(state),groups=new Map();let total=0;
    const poolMap=new Map(pools.map(pool=>[pool.id,pool]));
    for(const record of state.snapshot?.records||[]){
      if(!allowed(state,filter,record))continue;
      const type=gachaModel.poolType(game,record.uigf_gacha_type||record.gacha_type),asset=resource(game,type),key=groupKey(state,filter,record);
      const label=key==='unknown'?(filter.mode==='version'?'版本未知':'日期未知'):filter.mode==='version'?'版本 '+key:key;
      if(!groups.has(key))groups.set(key,{key,label,total:0,segments:new Map()});
      const group=groups.get(key),segmentKey=asset.id+':'+type;
      if(!group.segments.has(segmentKey))group.segments.set(segmentKey,{resource:asset.id,resourceLabel:asset.label,pool:type,poolLabel:poolMap.get(type)?.label||'未知卡池',...appearance(game,type),count:0});
      group.segments.get(segmentKey).count++;group.total++;total++;
    }
    const poolOrder=new Map(pools.map((pool,index)=>[pool.id,index]));
    const rows=[...groups.values()].map(group=>({...group,segments:[...group.segments.values()].sort((a,b)=>poolOrder.get(a.pool)-poolOrder.get(b.pool))}));
    rows.sort((a,b)=>a.key==='unknown'?1:b.key==='unknown'?-1:filter.mode==='version'?compareVersion(b.key,a.key):b.key.localeCompare(a.key));
    return {groups:rows,resources,pools,total,unit:'抽'};
  }
  function compareVersion(a,b){const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<Math.max(left.length,right.length);i++){const delta=(left[i]||0)-(right[i]||0);if(delta)return delta;}return 0;}
  function matches(state,filter,key,record){return allowed(state,filter,record)&&groupKey(state,filter,record)===key;}
  function summary(state,scope){
    const filter=scope.filter||{mode:'month'},result=compute(state,filter),group=result.groups.find(item=>item.key===scope.key);
    const records=(state.snapshot?.records||[]).filter(record=>matches(state,filter,scope.key,record));
    const byDay=new Map();let undated=0;
    for(const record of records){const key=date(record);if(!key){undated++;continue;}const type=gachaModel.poolType(state.selected.game,record.uigf_gacha_type||record.gacha_type);
      if(!byDay.has(key))byDay.set(key,{date:key,total:0,pools:new Map()});
      const day=byDay.get(key);day.total++;day.pools.set(type,(day.pools.get(type)||0)+1);
    }
    if(filter.mode!=='version'&&/^\d{4}-\d{2}$/.test(scope.key)){
      const [year,month]=scope.key.split('-').map(Number),count=new Date(Date.UTC(year,month,0)).getUTCDate();
      for(let i=1;i<=count;i++){const key=scope.key+'-'+String(i).padStart(2,'0');if(!byDay.has(key))byDay.set(key,{date:key,total:0,pools:new Map()});}
    }
    const days=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>({...day,segments:result.pools.filter(pool=>day.pools.has(pool.id)).map(pool=>({...pool,count:day.pools.get(pool.id)}))}));
    const segments=group?.segments||[],resources=result.resources.map(asset=>({...asset,count:segments.filter(segment=>segment.resource===asset.id).reduce((sum,segment)=>sum+segment.count,0)})).filter(asset=>asset.count);
    const pools=segments.map(segment=>({...segment,id:segment.pool,label:segment.poolLabel}));
    const fiveStars=records.filter(record=>Number(record.rank_type)===5).sort((a,b)=>String(b.time||'').localeCompare(String(a.time||'')));
    const peak=days.reduce((best,day)=>day.total>(best?.total||0)?day:best,null);
    return {records,total:records.length,fiveStars,resources,pools,days,undated,activeDays:days.filter(day=>day.total).length,peak};
  }
  globalThis.gachaDistribution={compute,resource,appearance,version,matches,summary};
})();
