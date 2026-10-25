(() => {
  const games={
    hk4e:{code:'hk4e',label:'原神',biz:'hk4e_',cn:'https://public-operation-hk4e.mihoyo.com',overseas:'https://public-operation-hk4e-sg.hoyoverse.com',pools:[['301','角色活动祈愿',90,true,false,5],['302','武器活动祈愿',80,true,false,5],['500','集录祈愿',90,false,false,5],['2000','千星奇域·活动颂愿',70,false,true,5],['1000','千星奇域·常驻颂愿',70,false,true,4],['200','常驻祈愿',90,false,false,5],['100','新手祈愿',20,false,false,5]]},
    hkrpg:{code:'hkrpg',label:'星穹铁道',biz:'hkrpg_',cn:'https://public-operation-hkrpg.mihoyo.com',overseas:'https://public-operation-hkrpg-sg.hoyoverse.com',pools:[['11','角色活动跃迁',90,true,false,5],['12','光锥活动跃迁',80,true,false,5],['21','角色联动跃迁',90,true,false,5],['22','光锥联动跃迁',80,true,false,5],['1','常驻跃迁',90,false,false,5],['2','新手跃迁',50,false,false,5]]}
  };
  const missing=value=>value===undefined||value===null||value==='';
  const fieldNames=['gacha_id','schedule_id','item_id','name','item_type','rank_type','count','is_up','game_version','version','timezone','region','server'];
  function stringId(value){if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('记录 ID 超出安全精度');return String(value??'');}
  function normalizeRecord(item,game,uid,{beyond=false,source='import',timezone,region}={}){
    const raw=beyond?item.op_gacha_type:item.gacha_type;
    const result={uid:stringId(item.uid??uid),id:stringId(item.id),gacha_type:stringId(raw),uigf_gacha_type:stringId(item.uigf_gacha_type??poolType(game,raw)),
      gacha_id:stringId(beyond?item.schedule_id:item.gacha_id),item_id:stringId(item.item_id),name:String((beyond?item.item_name:item.name)??''),item_type:String(item.item_type??''),rank_type:String(item.rank_type??''),count:String(item.count??'1'),time:String(item.time??'')};
    for(const field of fieldNames)if(!missing(item[field]))result[field]=['gacha_id','schedule_id','item_id'].includes(field)?stringId(item[field]):item[field];
    if(beyond&&!missing(item.schedule_id))result.schedule_id=stringId(item.schedule_id);
    // Only persist source-provided time evidence; an assumed default is not raw evidence.
    if(!missing(timezone)&&missing(result.timezone))result.timezone=Number(timezone);
    if(!missing(region)&&missing(result.region))result.region=String(region);
    result.fieldSources={...item.fieldSources};for(const field of ['gacha_type','time',...fieldNames])if(!missing(result[field])&&!result.fieldSources[field])result.fieldSources[field]=source;
    if(item.fieldConflicts)result.fieldConflicts=JSON.parse(JSON.stringify(item.fieldConflicts));
    if(typeof item.timezoneAssumed==='boolean')result.timezoneAssumed=item.timezoneAssumed;
    if(typeof item.gachaTypeAssumed==='boolean')result.gachaTypeAssumed=item.gachaTypeAssumed;
    return result;
  }
  function mergeRecord(existing,incoming){
    const result={...existing},sources={...existing.fieldSources},conflicts=JSON.parse(JSON.stringify(existing.fieldConflicts||{}));let enriched=false,conflicted=false;
    const verifiedClock=existing.timezoneAssumed&&!incoming.timezoneAssumed&&!missing(incoming.timezone)&&['number','string'].includes(typeof incoming.timezone)&&Number.isFinite(Number(incoming.timezone))&&Number(incoming.timezone)>=-12&&Number(incoming.timezone)<=14&&existing.time===incoming.time;
    for(const field of ['gacha_type','time',...fieldNames]){
      if(missing(incoming[field]))continue;
      if(missing(existing[field])||field==='gacha_type'&&existing.gachaTypeAssumed&&!incoming.gachaTypeAssumed||field==='timezone'&&verifiedClock){result[field]=incoming[field];sources[field]=incoming.fieldSources?.[field]||'import';enriched=true;if(field==='gacha_type')result.gachaTypeAssumed=false;if(field==='timezone'&&verifiedClock)result.timezoneAssumed=false;}
      else if(field==='gacha_type'&&String(existing[field])===String(incoming[field])&&sources[field]!=='official-record-api'&&!incoming.gachaTypeAssumed&&incoming.fieldSources?.gacha_type==='official-record-api'){sources[field]=incoming.fieldSources.gacha_type;enriched=true;}
      else if(String(existing[field])!==String(incoming[field])){
        const entry={value:incoming[field],source:incoming.fieldSources?.[field]||'import'};const list=conflicts[field]||[];
        if(!list.some(item=>String(item.value)===String(entry.value)&&item.source===entry.source)){conflicts[field]=[...list,entry].slice(-8);conflicted=true;}
      }
    }
    if(enriched)result.fieldSources=sources;if(conflicted)result.fieldConflicts=conflicts;
    return {record:result,enriched,conflicted};
  }
  const poolType=(game,raw)=>game==='hk4e'&&raw==='400'?'301':game==='hk4e'&&['20011','20012','20021','20022'].includes(raw)?'2000':String(raw||'');
  const compareId=(a,b)=>{const left=String(a).replace(/^0+/,'')||'0',right=String(b).replace(/^0+/,'')||'0';return left.length-right.length||left.localeCompare(right);};
  const order=(a,b)=>String(a.time).localeCompare(String(b.time))||compareId(a.id,b.id);
  const key=account=>`${account.game}:${account.uid}`;
  const recordKey=(game,record,uid=record.uid)=>JSON.stringify([game,String(uid||''),poolType(game,record.uigf_gacha_type||record.gacha_type),String(record.id)]);
  function normalizeDataset(value,game){const root=value||{formatVersion:1,game,accounts:[],records:[],poolSyncState:[]};root.formatVersion=1;root.game=game;root.accounts=root.accounts||[];root.records=(root.records||[]).map(item=>({...item,game,uid:stringId(item.uid),id:stringId(item.id)}));root.poolSyncState=root.poolSyncState||[];return root;}
  function mergeDataset(root,bundles,replace=false){
    const game=root.game,selected=bundles.filter(bundle=>bundle.account.game===game);if(replace){root.accounts=[];root.records=[];root.poolSyncState=[];}
    const accounts=new Map(root.accounts.map(item=>[item.uid,item])),records=new Map(root.records.map(item=>[recordKey(game,item),item])),states=new Map(root.poolSyncState.map(item=>[`${item.uid}:${item.poolType}`,item]));let inserted=0,skipped=0,enriched=0,conflicted=0;
    for(const bundle of selected){
      const existed=accounts.has(bundle.account.uid),previous=accounts.get(bundle.account.uid)||{},nextAccount={...previous,...bundle.account,game:undefined};
      if(existed&&(previous.timezone!==nextAccount.timezone||previous.timezoneAssumed!==nextAccount.timezoneAssumed||previous.region!==nextAccount.region)){
        // Old records used the old account's clock. Changing account metadata cannot reinterpret them.
        for(const [identity,item] of records)if(item.uid===bundle.account.uid){
          const record={...item};if(missing(record.timezone)&&!record.timezoneAssumed){if(!missing(previous.timezone)&&!previous.timezoneAssumed){record.timezone=previous.timezone;record.fieldSources={...record.fieldSources,timezone:'existing-account-metadata'};}else record.timezoneAssumed=true;}
          if(missing(record.region))record.region=previous.region||'';records.set(identity,record);
        }
      }
      if(bundle.account.timezoneAssumed&&!missing(previous.timezone)&&!previous.timezoneAssumed){nextAccount.timezone=previous.timezone;nextAccount.timezoneAssumed=false;}
      if(missing(bundle.account.region))nextAccount.region=previous.region||'';
      accounts.set(bundle.account.uid,nextAccount);
      for(const item of [...bundle.records,...(bundle.enrichedRecords||[])]){const record={...item,game:undefined,uid:item.uid||bundle.account.uid},identity=recordKey(game,record);if(records.has(identity)){const merged=mergeRecord(records.get(identity),record);records.set(identity,merged.record);skipped++;if(merged.enriched)enriched++;if(merged.conflicted)conflicted++;}else{records.set(identity,record);inserted++;}}
      for(const type of bundle.completedPoolTypes||[])states.set(`${bundle.account.uid}:${type}`,{uid:bundle.account.uid,poolType:type,historyComplete:true});
    }
    root.accounts=[...accounts.values()].sort((a,b)=>b.lastSyncAt-a.lastSyncAt);root.records=[...records.values()].sort((a,b)=>-order(a,b));root.poolSyncState=[...states.values()];return{inserted,skipped,enriched,conflicted,accounts:selected.length};
  }
  function snapshot(game,records,customLossNames=[],sources=['record-field',game==='hk4e'?'paimon-moe':'star-rail-station','local-rules'],accountTimezone=8,context={}){
    const config=games[game],grouped=new Map(),pityByRecord={},analysisByRecord={};let account={...context,timezone:context.timezone??accountTimezone};
    if(Object.keys(context).length&&missing(context.timezone))account.timezoneAssumed=true;
    if(window.gachaReference)account=window.gachaReference.recordContext(records,game,account);
    for(const record of records){const type=poolType(game,record.uigf_gacha_type||record.gacha_type);if(!grouped.has(type))grouped.set(type,[]);grouped.get(type).push(record);}
    const stats=[];
    for(const raw of config.pools){
      const [type,label,hardPity,tracksUp,isBeyond,targetRarity]=raw,list=(grouped.get(type)||[]).sort(order);if(!list.length)continue;
      let pity=0,count3=0,count4=0,count5=0;const targets=[];
      for(const record of list){
        pity++;const identity=recordKey(game,record);pityByRecord[identity]=pity;
        const rarity=Number(record.rank_type)||0;if(rarity===3)count3++;if(rarity===4)count4++;if(rarity===5)count5++;
        if(rarity!==targetRarity)continue;
        let isLoss=null,evidence={value:null,reason:'资料不足'};
        if(tracksUp){
          const override=context.overrides?.[identity];
          if(typeof override==='boolean'){isLoss=!override;evidence={value:override,reason:'用户修订'};}
          else if(customLossNames.includes(record.name)){isLoss=true;evidence={value:false,reason:'用户补充非 UP 名称'};}
          const rawUp=String(record.is_up??'').toLowerCase();
          if(isLoss===null&&sources.includes('record-field')){
            if(record.fieldConflicts?.is_up?.length)evidence={value:null,reason:'原始 UP 标记存在冲突'};
            else if(['1','true','up','yes'].includes(rawUp)){isLoss=false;evidence={value:true,reason:'记录自带标记'};}
            else if(['0','false','not_up','not-up','no'].includes(rawUp)){isLoss=true;evidence={value:false,reason:'记录自带标记'};}
          }
          if(isLoss===null&&!record.fieldConflicts?.is_up?.length&&window.gachaReference){evidence=window.gachaReference.upEvidence(record,game,account,sources);if(evidence.value!==null)isLoss=!evidence.value;}
          else if(isLoss===null&&!window.gachaReference&&window.gachaBannerHistory){const featured=window.gachaBannerHistory.featured(record,game,type,accountTimezone,sources);if(featured!==null){isLoss=!featured;evidence={value:featured,reason:'内置卡池名单'};}}
          if(isLoss===null&&sources.includes('local-rules')&&window.gachaReference){
            const reference=window.gachaReference.active(game),version=window.gachaReference.gameVersion(record,game,account).version;
            const rule=reference?.eligibility?.find(item=>window.gachaReference.supportsRegion(item,window.gachaReference.regionOf({region:record.region??account.region}))&&item.itemId===String(record.item_id)&&item.pool===type&&version&&window.gachaReference.compareVersion(version,item.startVersion)>=0&&(!item.endVersion||window.gachaReference.compareVersion(version,item.endVersion)<0));
            if(rule?.evidence){isLoss=true;evidence={value:false,reason:'按版本生效的常驻资格',source:rule.evidence};}
          }
        }
        analysisByRecord[identity]=evidence;targets.push({record,pity,isLoss,evidence});pity=0;
      }
      const upCount=targets.filter(item=>item.isLoss===false).length,lossCount=targets.filter(item=>item.isLoss===true).length;
      let completedUpPulls=0,targetPity=0,lastUp=-1;targets.forEach((target,index)=>{targetPity+=target.pity;if(target.isLoss===false){completedUpPulls=targetPity;lastUp=index;}});
      stats.push({type,label,hardPity,tracksUp,isBeyond,targetRarity,total:list.length,count3,count4,count5,currentPity:pity,targetCount:targets.length,averageTargetPity:targets.length?targets.reduce((sum,item)=>sum+item.pity,0)/targets.length:0,upCount,lossCount,unknownCount:tracksUp?targets.length-upCount-lossCount:0,averageUpPity:upCount?completedUpPulls/upCount:0,averageUpApproximate:targets.slice(0,lastUp+1).some(target=>target.isLoss===null),targetPulls:[...targets].reverse()});
    }
    return {records,stats,pityByRecord,analysisByRecord,referenceRevision:window.gachaReference?.active(game)?.revision||null,ruleVersion:window.gachaReference?.ruleVersion||1};
  }
  function overallLuck(stats){const tracked=stats.filter(item=>item.tracksUp&&item.upCount>0);if(!tracked.length)return'等待第一份 UP 记录';const pulls=tracked.reduce((sum,item)=>sum+item.total-item.currentPity,0),ups=tracked.reduce((sum,item)=>sum+item.upCount,0),hard=tracked.reduce((sum,item)=>sum+item.hardPity*item.upCount,0)/ups,ratio=(pulls/ups)/hard;return ratio<=.55?'天选欧洲人':ratio<=.8?'稳稳的欧洲人':ratio<=1.05?'薛定谔的欧洲人':ratio<=1.35?'非洲旅行者':'大非酋也会转运';}
  function parseLink(input){const cleaned=String(input||'').trim().replace(/\\u0026/gi,'&').replace(/\\\//g,'/').replace(/&amp;/g,'&'),match=cleaned.match(/https?:\/\/[^\s"'<>]+/i);if(!match)throw new Error('没有找到完整的 https 抽卡链接');const raw=match[0].replace(/[)\]},;]+$/,''),url=new URL(raw),params=Object.fromEntries(url.searchParams.entries());if(!params.authkey&&url.hash.includes('?'))Object.assign(params,Object.fromEntries(new URLSearchParams(url.hash.slice(url.hash.indexOf('?')+1))));if(!params.authkey)throw new Error('链接缺少 AuthKey');const lower=raw.toLowerCase(),game=String(params.game_biz||'').startsWith('hkrpg_')||lower.includes('hkrpg')||lower.includes('starrail')?'hkrpg':String(params.game_biz||'').startsWith('hk4e_')||lower.includes('hk4e')||lower.includes('genshin')?'hk4e':null;if(!game)throw new Error('无法判断链接属于原神还是星穹铁道');params.game_biz=params.game_biz||games[game].biz+(lower.includes('hoyoverse')||lower.includes('-sg.')?'global':'cn');params.authkey_ver=params.authkey_ver||'1';params.sign_type=params.sign_type||'2';params.auth_appid=params.auth_appid||'webview_gacha';params.lang=params.lang||'zh-cn';return{game,parameters:params,overseas:lower.includes('hoyoverse')||lower.includes('-sg.')||params.game_biz.endsWith('global')};}
  function requestUrl(link,pool){const config=games[link.game],path=link.game==='hk4e'&&pool[4]?'/gacha_info/api/getBeyondGachaLog':link.game==='hkrpg'&&['21','22'].includes(pool[0])?'/common/gacha_record/api/getLdGachaLog':link.game==='hk4e'?'/gacha_info/api/getGachaLog':'/common/gacha_record/api/getGachaLog',url=new URL((link.overseas?config.overseas:config.cn)+path);for(const [name,value] of Object.entries(link.parameters))if(!['gacha_type','page','size','end_id'].includes(name))url.searchParams.set(name,value);return url;}
  window.gachaModel={missing,stringId,normalizeRecord,mergeRecord,games,poolType,order,key,recordKey,normalizeDataset,mergeDataset,snapshot,overallLuck,parseLink,requestUrl};
})();
