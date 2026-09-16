(() => {
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function json(url){let last;for(let attempt=0;attempt<3;attempt++){try{const response=await ats.request(url.toString(),{deadlineMs:60000}),root=JSON.parse(response.text||'{}');if(response.status>=200&&response.status<300&&Number(root.retcode||0)===0)return root;const code=Number(root.retcode||response.status),message=root.message||`HTTP ${response.status}`;if(code!==-110||attempt===2)throw new Error(`获取失败（${code}）：${message}`);last=new Error(message);}catch(error){last=error;if(attempt===2)throw error;}await sleep(1500*(attempt+1));}throw last||new Error('网络请求失败');}
  const timestamp = value => {
    const normalized=String(value||'').replace('T',' ').slice(0,19);
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)?normalized:null;
  };
  async function fetch(link,dataset,onProgress=()=>{},options={}) {
    const mode=options.mode||'incremental';
    if(!['incremental','full'].includes(mode))throw new Error('未知的获取模式');
    const game=gachaModel.games[link.game],records=[],completed=[],existingByAccountPool=new Map();
    const completePools=new Set((dataset.poolSyncState||[]).filter(item=>item.historyComplete===true).map(item=>`${item.uid}:${item.poolType}`));
    for(const item of dataset.records||[]) {
      const type=gachaModel.poolType(link.game,item.uigf_gacha_type||item.gacha_type),key=`${item.uid}:${type}`;
      if(!existingByAccountPool.has(key))existingByAccountPool.set(key,new Set());
      existingByAccountPool.get(key).add(String(item.id));
    }
    let uid='',region=link.parameters.region||'',timezone=8,scannedRecords=0;
    const fetchedIds=new Set();
    for(const pool of game.pools) {
      const type=pool[0],isBeyond=pool[4],pageSize=isBeyond?5:20;
      // UID survives between pools; each pool's lookup state must be loaded independently.
      let existing=existingByAccountPool.get(`${uid}:${type}`)||new Set();
      let historyComplete=completePools.has(`${uid}:${type}`);
      let endId='0',reachedEnd=false,finished=false,knownPages=0,overlapTime=null;
      const cursors=new Set(['0']);
      for(let page=1;page<=1000;page++) {
        onProgress(`${mode==='full'?'刷新全部':'增量获取'} · ${game.label} · ${pool[1]} · 第 ${page} 页`);
        const url=gachaModel.requestUrl(link,pool);
        url.searchParams.set('gacha_type',type);url.searchParams.set('page',String(page));
        url.searchParams.set('size',String(pageSize));url.searchParams.set('end_id',endId);
        const root=await json(url),data=root.data||{};
        if(!Array.isArray(data.list))throw new Error('接口未返回有效记录列表，本次获取未保存');
        const list=data.list;
        timezone=Number(data.region_time_zone||timezone);region=String(data.region||region);
        if(!list.length){reachedEnd=true;finished=true;break;}
        let allKnown=true,lastId='',olderThanOverlap=true;
        for(const item of list) {
          const itemUid=String(item.uid||uid);
          if(itemUid) {
            if(uid&&uid!==itemUid)throw new Error('接口返回了不一致的 UID');
            if(!uid) {
              uid=itemUid;
              existing=existingByAccountPool.get(`${uid}:${type}`)||new Set();
              historyComplete=completePools.has(`${uid}:${type}`);
            }
          }
          if(typeof item.id==='number'&&!Number.isSafeInteger(item.id))throw new Error('接口记录 ID 超出安全精度，本次获取未保存');
          const id=String(item.id??'');
          if(!id)throw new Error('接口记录缺少 ID，本次获取未保存');
          lastId=id;scannedRecords++;
          const known=existing.has(id),time=timestamp(item.time);
          if(known&&!overlapTime&&time)overlapTime=time;
          if(!known)allKnown=false;
          if(!overlapTime||!time||time>=overlapTime)olderThanOverlap=false;
          // Scan the entire page: a duplicate must not hide later entries from the same ten-pull.
          const rawType=String(isBeyond?item.op_gacha_type||type:item.gacha_type||type);
          const key=gachaModel.recordKey(link.game,{uid:itemUid,id,gacha_type:rawType});
          if(known||fetchedIds.has(key))continue;
          fetchedIds.add(key);
          records.push({uid:itemUid,id,gacha_type:rawType,
            uigf_gacha_type:link.game==='hk4e'?gachaModel.poolType(link.game,rawType):rawType,
            gacha_id:String(isBeyond?item.schedule_id||'':item.gacha_id||''),item_id:String(item.item_id||''),
            name:String(isBeyond?item.item_name||'':item.name||''),item_type:String(item.item_type||''),
            rank_type:String(item.rank_type||''),count:String(item.count||'1'),time:String(item.time||''),is_up:String(item.is_up??'')});
        }
        if(list.length<pageSize){reachedEnd=true;finished=true;break;}
        if(cursors.has(lastId))throw new Error('接口分页游标没有推进，本次获取未保存，请重试');
        cursors.add(lastId);
        knownPages=allKnown?knownPages+1:0;
        const incrementalBoundary=mode==='incremental'&&(!isBeyond||historyComplete);
        // Require two complete known pages and cross the first overlapping timestamp group.
        if(incrementalBoundary&&knownPages>=2&&olderThanOverlap){finished=true;break;}
        endId=lastId;
        await sleep(350);
      }
      if(!finished)throw new Error('记录超过单卡池 1000 页的获取上限，本次获取未保存');
      if(isBeyond&&(historyComplete||reachedEnd))completed.push(type);
      await sleep(350);
    }
    if(!uid)throw new Error('没有获取到任何记录；请确认账号至少有一条可查询记录');
    return {account:{game:link.game,uid,region,timezone,lang:link.parameters.lang||'zh-cn',lastSyncAt:Date.now()},
      records:records.map(item=>({...item,uid:item.uid||uid})),completedPoolTypes:completed,scannedRecords,mode};
  }
  function extractLatestLink(lines,game){
    for(let index=lines.length-1;index>=0;index--){
      const normalized=String(lines[index]).replace(/\\u0026/gi,'&').replace(/\\\//g,'/').replace(/&amp;/g,'&');
      const candidates=normalized.match(/https?:\/\/[^\s"'<>]+/gi)||[];
      for(const candidate of candidates.reverse()){
        try{const link=gachaModel.parseLink(candidate);if(link.game===game)return link;}catch(_){}
        try{const wrapper=new URL(candidate);for(const name of ['url','target','redirect','redirect_url']){const nested=wrapper.searchParams.get(name);if(!nested)continue;try{const link=gachaModel.parseLink(nested);if(link.game===game)return link;}catch(_){}}}catch(_){}
      }
    }
    return null;
  }
  async function fromSystemLogs(game,lookbackMinutes=0){
    if(!Number.isInteger(lookbackMinutes)||lookbackMinutes<0||lookbackMinutes>10080)throw new Error('日志时间范围无效');
    const result=await ats.call('system.logs.search',{terms:['auth_appid=webview_gacha','authkey='],matchMode:'any',maxLines:100,lookbackMinutes});
    if(lookbackMinutes>0&&result.lookbackMinutes!==lookbackMinutes)throw new Error('当前日志提供插件不支持时间筛选，请更新后再试，或选择系统保留的全部日志。');
    const link=extractLatestLink(result.lines||[],game);if(link)return link;
    throw new Error('所选范围内没有找到完整链接。可扩大时间范围，或在游戏／云游戏 App 中重新打开抽卡历史后返回查找。');
  }
  window.gachaNetwork={fetch,fromSystemLogs,extractLatestLink};
})();
