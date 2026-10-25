(() => {
  function bundle(item,game,timestamp,beyond=false){
    const uid=gachaModel.stringId(item.uid),knownTimezone=!gachaModel.missing(item.timezone);
    const timezone=Number(item.timezone??8);if(knownTimezone&&!['number','string'].includes(typeof item.timezone)||!Number.isFinite(timezone)||timezone<-12||timezone>14)throw Error('文件时区无效');
    const records=(item.list||[]).map(value=>{const record=gachaModel.normalizeRecord(value,game,uid,{beyond,source:'uigf-import',timezone:knownTimezone?timezone:undefined,region:item.region});if(!knownTimezone&&gachaModel.missing(record.timezone))record.timezoneAssumed=true;return record;}).filter(value=>value.id&&(value.gacha_type||value.uigf_gacha_type)&&value.time);
    return {account:{game,uid,region:String(item.region??''),timezone,timezoneAssumed:!knownTimezone,lang:String(item.lang??'zh-cn'),lastSyncAt:timestamp},records,completedPoolTypes:[]};
  }
  function decode(raw){
    const root=typeof raw==='string'?JSON.parse(raw):raw,stamp=Number(root.info?.export_timestamp??Math.floor(Date.now()/1000))*1000,values=[];
    for(const item of root.hk4e||[])values.push(bundle(item,'hk4e',stamp));
    for(const item of root.hkrpg||[])values.push(bundle(item,'hkrpg',stamp));
    for(const item of root.hk4e_ugc||[])values.push(bundle(item,'hk4e',stamp,true));
    if(!values.length&&Array.isArray(root.list)){
      const first=root.list[0]||{},game=root.info?.srgf_version||first.gacha_id&&!first.uigf_gacha_type?'hkrpg':'hk4e';
      values.push(bundle({uid:root.info?.uid??first.uid,timezone:root.info?.region_time_zone??root.info?.timezone,lang:root.info?.lang??'zh-cn',list:root.list},game,stamp));
    }
    if(!values.length)throw Error('文件中没有可导入的原神或星穹铁道记录');
    const groups=new Map();
    for(const value of values){if(!value.account.uid)continue;const key=gachaModel.key(value.account);if(!groups.has(key))groups.set(key,value);else{
      const current=groups.get(key),records=new Map(current.records.map(item=>[gachaModel.recordKey(value.account.game,item,value.account.uid),item]));
      for(const item of value.records){const key=gachaModel.recordKey(value.account.game,item,value.account.uid);records.set(key,records.has(key)?gachaModel.mergeRecord(records.get(key),item).record:item);}current.records=[...records.values()];
    }}
    return [...groups.values()];
  }
  function encodedRecord(item,game,beyond,extensions){
    let value;
    if(beyond)value={id:item.id,schedule_id:item.schedule_id??item.gacha_id??'',item_type:item.item_type??'',item_id:item.item_id??'',item_name:item.name??'',rank_type:item.rank_type??'',time:item.time,op_gacha_type:item.gacha_type};
    else{
      value={gacha_type:item.gacha_type,item_id:item.item_id??'',count:item.count||'1',time:item.time,name:item.name??'',item_type:item.item_type??'',rank_type:item.rank_type??'',id:item.id};
      if(game==='hk4e')value.uigf_gacha_type=gachaModel.poolType(game,item.uigf_gacha_type||item.gacha_type);
      if(game==='hkrpg')value.gacha_id=item.gacha_id??'';
    }
    if(extensions)for(const field of ['is_up','game_version','version','timezone','timezoneAssumed','gachaTypeAssumed','region','server','fieldSources','fieldConflicts'])if(!gachaModel.missing(item[field]))value[field]=item[field];
    return value;
  }
  function encode(bundles,version,{extensions=false}={}){
    const root={info:{export_timestamp:Math.floor(Date.now()/1000),export_app:'Android Tool Suite · Gacha Analysis',export_app_version:version,version:'v4.2'}},sections={hk4e:[],hkrpg:[],hk4e_ugc:[]};
    for(const value of bundles){
      const groups=new Map();for(const record of value.records){const beyond=value.account.game==='hk4e'&&['1000','2000'].includes(gachaModel.poolType('hk4e',record.gacha_type)),section=beyond?'hk4e_ugc':value.account.game,timezone=record.timezone??value.account.timezone??8,key=section+':'+timezone;if(!['number','string'].includes(typeof timezone)||!Number.isFinite(Number(timezone))||Number(timezone)<-12||Number(timezone)>14)throw Error('记录时区无效，无法导出');
        if(!groups.has(key))groups.set(key,{section,beyond,timezone,records:[]});groups.get(key).records.push(record);}
      for(const group of groups.values())sections[group.section].push({uid:value.account.uid,timezone:Number(group.timezone),lang:value.account.lang||'zh-cn',list:group.records.sort(gachaModel.order).map(item=>encodedRecord(item,value.account.game,group.beyond,extensions))});
    }
    for(const [section,list] of Object.entries(sections))if(list.length)root[section]=list;
    return JSON.stringify(root,null,2);
  }
  window.uigf={decode,encode};
})();
