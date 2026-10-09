function createDatasetCounter() {
  let inString = false;
  let escaped = false;
  let token = '';
  let lastString = '';
  let awaitingArray = '';
  let target = '';
  let bracketDepth = 0;
  let objectDepth = 0;
  const counts = {accounts: 0, records: 0};

  function accept(bytes) {
    for (const byte of bytes) {
      const char = String.fromCharCode(byte);
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
          lastString = token;
        } else if (token.length < 16 && byte < 128) {
          token += char;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        token = '';
        continue;
      }
      if (!target) {
        if (char === ':' && (lastString === 'accounts' || lastString === 'records')) {
          awaitingArray = lastString;
          lastString = '';
        } else if (char === '[' && awaitingArray) {
          target = awaitingArray;
          awaitingArray = '';
          bracketDepth = 1;
          objectDepth = 0;
        } else if (!/\s/.test(char) && char !== ':') {
          awaitingArray = '';
          if (char !== ',') lastString = '';
        }
        continue;
      }
      if (char === '[') bracketDepth += 1;
      else if (char === ']') {
        bracketDepth -= 1;
        if (bracketDepth === 0) target = '';
      } else if (char === '{') {
        if (bracketDepth === 1 && objectDepth === 0) counts[target] += 1;
        objectDepth += 1;
      } else if (char === '}') {
        objectDepth = Math.max(0, objectDepth - 1);
      }
    }
  }

  return {accept, counts};
}

async function datasetStats(ats, datasetId, maxBytes) {
  const opened = await ats.call('storage.dataset.openRead', {datasetId});
  if (!opened.found) return {accounts: 0, records: 0};
  if (Number(opened.size) > maxBytes) {
    await ats.call('storage.dataset.abort', {handle: opened.handle}).catch(() => {});
    throw Object.assign(new Error('Dataset exceeds worker limit'), {code: 'RESOURCE_LIMIT'});
  }
  const key = `summary:${datasetId}`;
  const counter = createDatasetCounter();
  let offset = 0;
  try {
    const cached = await ats.call('storage.kv.get', {key});
    const summary = cached.value;
    if (cached.found && summary?.sha256 === opened.sha256 && summary?.size === opened.size
        && Number.isSafeInteger(summary.accounts) && summary.accounts >= 0
        && Number.isSafeInteger(summary.records) && summary.records >= 0) {
      return {accounts: summary.accounts, records: summary.records};
    }
    while (true) {
      const part = await ats.call('storage.dataset.read', {
        handle: opened.handle,
        offset,
        maxBytes: Math.min(131072, maxBytes - offset)
      });
      const bytes = ats.decodeBase64(part.bytes);
      counter.accept(bytes);
      offset += bytes.length;
      if (part.eof) break;
    }
  } finally {
    await ats.call('storage.dataset.abort', {handle: opened.handle}).catch(() => {});
  }
  await ats.call('storage.kv.set', {key, value: {sha256: opened.sha256, size: opened.size, ...counter.counts}});
  return counter.counts;
}

const widgetPools={
  hk4e:{'301':['角色活动祈愿',90,5],'302':['武器活动祈愿',80,5],'500':['集录祈愿',90,5],'2000':['千星奇域·活动颂愿',70,5],'1000':['千星奇域·常驻颂愿',70,4],'200':['常驻祈愿',90,5],'100':['新手祈愿',20,5]},
  hkrpg:{'11':['角色活动跃迁',90,5],'12':['光锥活动跃迁',80,5],'21':['角色联动跃迁',90,5],'22':['光锥联动跃迁',80,5],'1':['常驻跃迁',90,5],'2':['新手跃迁',50,5]}
};
const widgetPoolType=(game,type)=>game==='hk4e'&&type==='400'?'301':game==='hk4e'&&['20011','20012','20021','20022'].includes(type)?'2000':String(type||'');
const widgetOrder=(a,b)=>String(a.time).localeCompare(String(b.time))||(()=>{const left=String(a.id).replace(/^0+/,'')||'0',right=String(b.id).replace(/^0+/,'')||'0';return left.length-right.length||left.localeCompare(right);})();
// Retain one record at a time, including nested fields and UTF-8 split across transport chunks.
function createWidgetRecordReader(ats,onRecord,arrayName='records'){
  let depth=0,inString=false,escaped=false,token='',rootString=false,lastString='',awaiting=false,inRecords=false,capturing=false,done=false;const bytes=[];
  return{accept(chunk){for(const byte of chunk){const char=String.fromCharCode(byte);if(capturing){bytes.push(byte);if(bytes.length>1048576)throw Error('单条抽卡记录过大');}if(inString){if(rootString&&token.length<129)token+=char;if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"'){inString=false;if(rootString){try{lastString=JSON.parse(token);}catch{lastString='';}}}continue;}
    if(char==='"'){inString=true;rootString=depth===1;token='"';continue;}
    if(depth===1&&char===':'&&lastString===arrayName){awaiting=true;lastString='';continue;}
    if(awaiting){if(/\s/.test(char))continue;awaiting=false;if(char!=='[')throw Error('抽卡记录列表格式无效');inRecords=true;}
    if(inRecords&&depth===2&&char==='{'){capturing=true;bytes.push(byte);}
    if(char==='{'||char==='[')depth++;else if(char==='}'||char===']'){depth--;if(capturing&&depth===2){onRecord(JSON.parse(ats.decodeUtf8(new Uint8Array(bytes))));bytes.length=0;capturing=false;}if(inRecords&&depth===1){inRecords=false;done=true;}}
    if(depth===1&&char===',')lastString='';
  }},finish(){if(inString||capturing||depth!==0||!done)throw Error('抽卡记录文件不完整');}};
}
async function widgetSettings(ats){
  const opened=await ats.call('storage.dataset.openRead',{datasetId:'gacha-settings'});if(!opened.found)return{};
  try{if(!Number.isSafeInteger(opened.size)||opened.size<0||opened.size>1048576)throw Error('账号设置大小无效');const out=new Uint8Array(opened.size);for(let offset=0;offset<opened.size;){const length=Math.min(131072,opened.size-offset),part=await ats.call('storage.dataset.read',{handle:opened.handle,offset,maxBytes:length}),bytes=ats.decodeBase64(part.bytes);if(bytes.length!==length)throw Error('账号设置读取不完整');out.set(bytes,offset);offset+=length;}return JSON.parse(ats.decodeUtf8(out));}finally{await ats.call('storage.dataset.abort',{handle:opened.handle}).catch(()=>{});}
}
async function currentPoolSummary(ats,configuration){
  const settings=configuration?{}:await widgetSettings(ats),preferences=settings.preferences||{},selected=String(configuration?configuration.account||'':preferences['selected-account']?.value??preferences.selected_account_key?.value??''),separator=selected.indexOf(':'),game=selected.slice(0,separator),uid=selected.slice(separator+1);
  if(!widgetPools[game]||!uid)return{title:'尚未选择记录账号',detail:'打开工具选择账号',value:'—',state:'empty'};
  const configured=String(configuration?configuration.pool||'':preferences['widget-pool:'+selected]?.value??''),type=widgetPools[game][configured]?configured:game==='hk4e'?'301':'11',pool=widgetPools[game][type],datasetId=game==='hk4e'?'genshin-records':'starrail-records';
  if(configuration && !widgetPools[game][configured])return{title:'请重新配置卡池',detail:'长按卡片修改设置',value:'—',state:'empty'};
  const empty={title:pool[0],detail:`${uid} · 尚无本地记录`,value:'—',state:'empty'};
  const opened=await ats.call('storage.dataset.openRead',{datasetId});if(!opened.found)return empty;
  try{if(!Number.isSafeInteger(opened.size)||opened.size<0||opened.size>268435456)throw Error('抽卡记录大小无效');if(!/^[a-f0-9]{64}$/i.test(opened.sha256||''))throw Error('抽卡记录摘要无效');
    const key=`widget-pity:${game}:${uid}:${type}`,cached=await ats.call('storage.kv.get',{key}),cache=cached.value;
    if(cached.found&&cache?.version===1&&cache.sha256===opened.sha256&&cache.size===opened.size&&Number.isSafeInteger(cache.total)&&cache.total>=0&&Number.isSafeInteger(cache.current)&&cache.current>=0&&cache.current<=cache.total)return cache.total?{title:pool[0],detail:`${uid} · ${cache.current}/${pool[1]} 抽`,value:cache.current,state:'ready',progress:cache.current,max:pool[1]}:empty;
    let total=0,current=0,last=null,latestTarget=null,descending=true,beforeFirstTarget=true;
    const matches=record=>String(record.uid)===uid&&widgetPoolType(game,record.uigf_gacha_type||record.gacha_type)===type;
    async function scan(onRecord){const reader=createWidgetRecordReader(ats,onRecord);for(let offset=0;offset<opened.size;){const length=Math.min(131072,opened.size-offset),part=await ats.call('storage.dataset.read',{handle:opened.handle,offset,maxBytes:length}),bytes=ats.decodeBase64(part.bytes);if(bytes.length!==length||(part.offset!=null&&part.offset!==offset)||part.eof!==(offset+length===opened.size))throw Error('抽卡记录分块无效');reader.accept(bytes);offset+=length;}reader.finish();}
    await scan(record=>{if(!matches(record))return;total++;if(last&&widgetOrder(last,record)<0)descending=false;last={id:record.id,time:record.time};if(Number(record.rank_type)===pool[2]){beforeFirstTarget=false;if(!latestTarget||widgetOrder(record,latestTarget)>0)latestTarget={id:record.id,time:record.time};}else if(beforeFirstTarget)current++;});
    if(!descending&&latestTarget){current=0;await scan(record=>{if(matches(record)&&widgetOrder(record,latestTarget)>0)current++;});}
    if(!latestTarget)current=total;
    await ats.call('storage.kv.set',{key,value:{version:1,sha256:opened.sha256,size:opened.size,total,current}});
    return total?{title:pool[0],detail:`${uid} · ${current}/${pool[1]} 抽`,value:current,state:'ready',progress:current,max:pool[1]}:empty;
  }finally{await ats.call('storage.dataset.abort',{handle:opened.handle}).catch(()=>{});}
}

globalThis.atsWorkerMain = async function (input, ats) {
  if(input?.kind==='capability'&&input.method==='gacha.summary.configure')return configureSummary(ats,input.payload||{});
  if (input?.kind === 'capability' && input?.method === 'gacha.summary.get') return input.payload?.configuration ? configuredSummary(ats,input.payload) : currentPoolSummary(ats);
  const [genshin, starrail] = await Promise.all([
    datasetStats(ats, 'genshin-records', 268435456),
    datasetStats(ats, 'starrail-records', 268435456)
  ]);
  return {status:'succeeded',accounts:genshin.accounts+starrail.accounts,records:genshin.records+starrail.records};
};

async function scanSummaryDataset(ats,game,arrayName,visit) {
  const opened=await ats.call('storage.dataset.openRead',{datasetId:game==='hk4e'?'genshin-records':'starrail-records'});
  if(!opened.found)return;
  try {
    if(!Number.isSafeInteger(opened.size)||opened.size<0||opened.size>268435456)throw Error('记录大小无效');
    const reader=createWidgetRecordReader(ats,visit,arrayName);
    for(let offset=0;offset<opened.size;) {
      const length=Math.min(131072,opened.size-offset),part=await ats.call('storage.dataset.read',{handle:opened.handle,offset,maxBytes:length}),bytes=ats.decodeBase64(part.bytes);
      if(bytes.length!==length)throw Error('记录读取不完整');reader.accept(bytes);offset+=length;
    }
    reader.finish();
  }finally{await ats.call('storage.dataset.abort',{handle:opened.handle}).catch(()=>{});}
}
async function summaryAccounts(ats) {
  const accounts=[];
  for(const game of ['hk4e','hkrpg'])await scanSummaryDataset(ats,game,'accounts',account=>{
    if(account.uid!=null)accounts.push({value:`${game}:${account.uid}`,label:`${game==='hk4e'?'原神':'星穹铁道'} · ${String(account.uid).slice(0,32)}`});
  });
  return [...new Map(accounts.map(item=>[item.value,item])).values()];
}
function poolBindings(configuration) {
  const source=configuration||{},legacy=String(source.account||''),bindings={};
  for(const game of ['hk4e','hkrpg'])bindings[game]=String(source['account_'+game]||((legacy.split(':')[0]===game)?legacy:''));
  const pools=Array.isArray(source.pools)?source.pools.map(pool=>String(pool).includes(':')?String(pool):legacy.split(':')[0]+':'+pool):[];
  return {bindings,pools};
}
async function configureSummary(ats,payload) {
  const draft=payload.configuration||{};
  if(payload.widgetId==='records')return{configuration:{game:['all','hk4e','hkrpg'].includes(draft.game)?draft.game:'all'},fields:[{key:'game',label:'统计范围',type:'select',options:[{value:'all',label:'全部游戏'},{value:'hk4e',label:'原神'},{value:'hkrpg',label:'星穹铁道'}]}]};
  const accounts=await summaryAccounts(ats),settings=await widgetSettings(ats),preferences=settings.preferences||{};
  if(payload.widgetId==='pools'){
    const previous=poolBindings(draft),configuration={},fields=[],options=[];
    for(const game of ['hk4e','hkrpg']){
      const choices=accounts.filter(account=>account.value.startsWith(game+':'));
      const fallback=String(preferences['last-account:'+game]?.value||preferences['selected-account']?.value||preferences.selected_account_key?.value||'');
      const selected=previous.bindings[game]||choices.find(account=>account.value===fallback)?.value||choices[0]?.value||'';
      configuration['account_'+game]=selected;
      if(choices.length)fields.push({key:'account_'+game,label:game==='hk4e'?'固定原神账号':'固定星穹铁道账号',type:'select',options:choices});
      if(selected)for(const [type,pool]of Object.entries(widgetPools[game]))options.push({value:game+':'+type,label:(game==='hk4e'?'原神':'星铁')+' · '+pool[0]});
    }
    const selected=previous.pools.filter(pool=>options.some(option=>option.value===pool));
    const defaults=['hk4e:301','hkrpg:11'].filter(pool=>options.some(option=>option.value===pool));
    configuration.pools=selected.length?selected:defaults.length?defaults:options.slice(0,1).map(option=>option.value);
    fields.push({key:'pools',label:'卡池（最多四个，可混合两个游戏）',type:'multi',options,minItems:1,maxItems:4});
    return{configuration,fields};
  }
  const account=Object.hasOwn(draft,'account')?String(draft.account):String(preferences['selected-account']?.value??preferences.selected_account_key?.value??'');
  const game=account.split(':')[0],pools=widgetPools[game]||{},options=Object.entries(pools).map(([value,pool])=>({value,label:pool[0]}));
  const fields=[{key:'account',label:'固定账号',type:'select',options:accounts,description:'工具内切换账号和卡池不会改变此卡片。'}];
  const pool=pools[draft.pool]?draft.pool:game==='hk4e'?'301':'11';
  fields.push({key:'pool',label:'卡池',type:'select',options});return{configuration:{account,pool},fields};
}
async function configuredSummary(ats,payload) {
  const configuration=payload.configuration;
  if(payload.widgetId==='records') {
    if(!['all','hk4e','hkrpg'].includes(configuration.game))return{title:'请选择统计范围',detail:'长按配置小部件',state:'empty'};
    const games=configuration.game==='all'?['hk4e','hkrpg']:[configuration.game];let accounts=0,records=0,latest='';
    for(const game of games){await scanSummaryDataset(ats,game,'accounts',()=>accounts++);await scanSummaryDataset(ats,game,'records',record=>{records++;const time=String(record.time||'');if(time>latest)latest=time;});}
    return{title:configuration.game==='all'?'全部游戏':configuration.game==='hk4e'?'原神':'星穹铁道',rows:[{label:'账号',value:accounts},{label:'记录',value:records}],detail:latest?`最新记录 ${latest}`:'暂无本地记录',state:records?'ready':'empty'};
  }
  const accounts=await summaryAccounts(ats);
  if(payload.widgetId!=='pools'){
    if(!accounts.some(item=>item.value===configuration.account))return{title:configuration.account?'账号已移除':'尚未配置账号',detail:'长按卡片配置',value:'—',state:'empty'};
    return currentPoolSummary(ats,configuration);
  }
  const {bindings,pools}=poolBindings(configuration);
  if(pools.length<1||pools.length>4||new Set(pools).size!==pools.length)return{title:'请重新配置卡池',detail:'长按修改卡片',state:'empty'};
  const rows=[];let missing=0,emptyPools=0;
  for(const key of pools){
    const [game,type]=key.split(':'),account=bindings[game];
    if(!widgetPools[game]?.[type])return{title:'请重新配置卡池',detail:'长按修改卡片',state:'empty'};
    const result=accounts.some(item=>item.value===account)?await currentPoolSummary(ats,{account,pool:type}):null;
    if(!result)missing++;else if(result.state!=='ready')emptyPools++;
    rows.push({label:(game==='hk4e'?'原神':'星铁')+' · '+widgetPools[game][type][0],value:result?.state==='ready'?String(result.value)+'/'+result.max+' 抽':result?'暂无记录':'—'});
  }
  const mixed=new Set(pools.map(key=>key.split(':')[0])).size>1;
  return{title:mixed?'原神 · 星穹铁道':accounts.find(item=>item.value===bindings[pools[0].split(':')[0]])?.label||'多池概览',rows,detail:missing?'部分绑定账号不可用，请检查配置':emptyPools?'部分卡池暂无本地记录':'各游戏与卡池独立计算',state:missing+emptyPools===rows.length?'empty':'ready'};
}
