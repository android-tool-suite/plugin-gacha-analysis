(() => {
  'use strict';
  const formatVersion=1, parserVersion=1, ruleVersion=6, hour=3600000;
  const urls={
    paimon:'https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/banners.js',
    watcher:'https://raw.githubusercontent.com/UIGF-org/CurrentBannerWatcher/main/banner-data.json',
    genshinItems:'https://sg-public-api.hoyolab.com/event/simulatoros/config?lang=en-us',
    genshinNames:'https://sg-public-api.hoyolab.com/event/simulatoros/config?lang=zh-cn',
    station:'https://starrailstation.com/api/v1/warp_config',
    characters:'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/cn/characters.json',
    lightcones:'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/cn/light_cones.json',
    announcements:'https://sg-hk4e-api-static.hoyoverse.com/common/hk4e_global/announcement/api/getAnnContent?game=hk4e&game_biz=hk4e_global&region=os_asia&bundle_id=hk4e_global&channel_id=1&level=55&platform=pc&lang=zh-cn',
    genshinCnAnnouncements:'https://hk4e-ann-api.mihoyo.com/common/hk4e_cn/announcement/api/getAnnContent?game=hk4e&game_biz=hk4e_cn&region=cn_gf01&bundle_id=hk4e_cn&channel_id=1&level=55&platform=pc&lang=zh-cn',
    starrailCnAnnouncements:'https://hkrpg-ann-api.mihoyo.com/common/hkrpg_cn/announcement/api/getAnnContent?game=hkrpg&game_biz=hkrpg_cn&region=prod_gf_cn&bundle_id=hkrpg_cn&channel_id=1&level=70&platform=pc&lang=zh-cn',
    genshinCnVersions:'https://wiki.biligame.com/ys/%E7%89%88%E6%9C%AC%E5%8E%86%E5%8F%B2',
    starrailCnVersions:'https://wiki.biligame.com/sr/%E7%89%88%E6%9C%AC%E6%96%B0%E5%A2%9E%E5%86%85%E5%AE%B9',
    genshinCnHistory:'https://wiki.biligame.com/ys/%E5%BE%80%E6%9C%9F%E7%A5%88%E6%84%BF',
    genshinCnChronicle:'https://wiki.biligame.com/ys/%E9%9B%86%E5%BD%95%E7%A5%88%E6%84%BF',
    starrailCnHistory:'https://wiki.biligame.com/sr/%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81'
  };
  const id=value=>{if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('资料 ID 超出安全精度');const text=String(value??'');if(!/^\d+$/.test(text)||/^0+$/.test(text))throw Error('资料 ID 无效');return text;};
  function localTime(value){
    const raw=String(value??'').replaceAll('/','-').replace('T',' '),text=raw.length===16?raw+':00':raw;
    if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text))return null;
    const stamp=Date.parse(text.replace(' ','T')+'Z');
    return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,19).replace('T',' ')===text?stamp:null;
  }
  const versionValid=value=>/^\d+\.\d+(?:\.\d+)?$/.test(String(value||''));
  const minuteEnd=value=>{const stamp=localTime(value);if(stamp===null)throw Error('公告结束时间无效');return new Date(stamp+60000).toISOString().slice(0,19).replace('T',' ');};
  function compareVersion(a,b){const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d;}return 0;}
  // Accept data literals only. Remote code, expressions, computed keys and prototype keys are rejected.
  function literals(raw){
    let source=String(raw).replace(/^\uFEFF/,'').trim();
    if(!source.startsWith('export const banners ='))throw Error('历史排期格式改变');
    source=source.slice('export const banners ='.length);let offset=0,tokens=0;
    const fail=()=>{throw Error('历史排期含非数据内容（位置 '+offset+'）');};
    const space=()=>{while(offset<source.length){if(/\s/.test(source[offset]))offset++;else if(source.slice(offset,offset+2)==='//'){const end=source.indexOf('\n',offset+2);offset=end<0?source.length:end+1;}else if(source.slice(offset,offset+2)==='/*'){const end=source.indexOf('*/',offset+2);if(end<0)fail();offset=end+2;}else break;}};
    function value(depth=0){
      if(depth>16||++tokens>100000)throw Error('历史排期超过解析限制');space();const char=source[offset++];
      if(char==='"'||char==="'"){
        let text='';while(offset<source.length){const c=source[offset++];if(c===char)return text;if(c==='\\'){const e=source[offset++];if(e==='u'){const hex=source.slice(offset,offset+4);if(!/^[a-f0-9]{4}$/i.test(hex))fail();text+=String.fromCharCode(parseInt(hex,16));offset+=4;}else if(e==='x'){const hex=source.slice(offset,offset+2);if(!/^[a-f0-9]{2}$/i.test(hex))fail();text+=String.fromCharCode(parseInt(hex,16));offset+=2;}else if(Object.hasOwn({n:1,r:1,t:1,'\\':1,"'":1,'"':1},e))text+=({n:'\n',r:'\r',t:'\t','\\':'\\',"'":"'",'"':'"'})[e];else fail();}else text+=c;}fail();
      }
      if(char==='['||char==='{'){
        const object=char==='{',result=object?Object.create(null):[],close=object?'}':']';space();
        while(source[offset]!==close){let key;if(object){space();if(/["']/.test(source[offset]))key=value(depth+1);else{const match=/^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(offset));if(!match)fail();key=match[0];offset+=key.length;}if(['__proto__','prototype','constructor'].includes(key)||Object.hasOwn(result,key))fail();space();if(source[offset++]!==':')fail();}
          const item=value(depth+1);if(object)result[key]=item;else result.push(item);space();if(source[offset]===close)break;if(source[offset++]!==',')fail();space();}
        offset++;return result;
      }
      offset--;const match=/^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?)/.exec(source.slice(offset));if(!match)fail();offset+=match[0].length;return JSON.parse(match[0]);
    }
    const result=value();space();if(source[offset]===';')offset++;space();if(offset!==source.length)fail();return result;
  }
  const slug=name=>String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll(/[’']/g,'').toLowerCase().replaceAll(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  function genshinDictionary(root,language='en-us'){
    if(root.retcode!==0||!Array.isArray(root.data?.all_avatar)||!Array.isArray(root.data?.all_weapon))throw Error('原神物品字典格式改变');
    return [...root.data.all_avatar.map(item=>({...item,type:'character'})),...root.data.all_weapon.map(item=>({...item,type:'weapon'}))].map(item=>({id:id(item.id),names:{[language]:String(item.name||'')},rarity:Number(item.level),type:item.type}));
  }
  function starrailDictionary(root,type){
    if(!root||Array.isArray(root)||typeof root!=='object'||!Object.keys(root).length)throw Error('星铁物品字典格式改变');
    return Object.entries(root).map(([key,item])=>{if(!item.name||id(item.id)!==id(key)||![3,4,5].includes(item.rarity))throw Error('星铁物品字典内容无效');return {id:id(key),names:{'zh-cn':String(item.name)},rarity:item.rarity,type};});
  }
  function paimon(raw,items,observedAt=Date.now()){
    const root=literals(raw),dictionary=new Map(items.flatMap(item=>Object.values(item.names).map(name=>[slug(name),item]))),banners=[];
    for(const [category,pool] of [['characters','301'],['weapons','302'],['chronicled','500']]){
      if(!Array.isArray(root[category])||!root[category].length)throw Error('历史排期缺少卡池分类');
      for(const item of root[category]){
        if(localTime(item.start)===null||localTime(item.end)===null||!versionValid(item.version)||!Array.isArray(item.featured)||!item.featured.length)throw Error('历史排期字段无效');
        const mapped=item.featured.map(name=>dictionary.get(slug(name))),rare=(item.featuredRare||[]).map(name=>dictionary.get(slug(name)));
        if(mapped.some(entry=>!entry))throw Error('历史排期物品映射不完整：'+item.featured.filter((name,index)=>!mapped[index]).join(' / '));
        // Multiple characters are distinct wishes, but this source does not establish 301/400 ownership.
        const groups=pool==='301'?mapped.map(entry=>[entry]):[mapped];
        for(const group of groups)banners.push({id:`paimon:${pool}:${item.start}:${group.map(entry=>entry.id).join('-')}`,source:'paimon-moe',pool,rawTypes:pool==='301'?['301','400']:[pool],gameIds:[],announcementId:null,names:{'en-us':pool==='301'&&groups.length>1?group[0].names['en-us']:String(item.name||item.shortName)},version:String(item.version),phase:null,start:item.start,end:item.end,startBasis:item.timezoneDependent?'utc8':'server',endBasis:item.timezoneDependentEnd?'utc8':'server',region:'global',featured5:group.map(entry=>entry.id),featured4:rare.filter(Boolean).map(entry=>entry.id),authority:'community',precision:'minute'});
      }
    }
    const regular=banners.filter(item=>['301','302'].includes(item.pool)),starts=new Map();
    for(const item of regular)if(!starts.has(item.version)||item.start<starts.get(item.version))starts.set(item.version,item.start);
    const ordered=[...starts].sort((a,b)=>compareVersion(a[0],b[0]));
    // A current version is covered only through the observed source time, never through a guessed ending.
    const through=new Date(observedAt+1000+8*hour).toISOString().slice(0,19).replace('T',' ');
    const versions=ordered.filter(([,start])=>start<through).map(([version,start],index)=>({version,start,end:ordered[index+1]?.[1]||through,ongoing:!ordered[index+1],region:'global',basis:'utc8',source:'paimon-moe',precision:'day'}));
    for(const [version] of ordered){
      const times=[...new Set(regular.filter(item=>item.version===version&&item.pool==='301').map(item=>item.start))].sort();
      for(const item of regular.filter(item=>item.version===version)){const index=times.indexOf(item.start);item.phase=index<0?null:index+1;}
    }
    return {banners,versions};
  }
  function watcher(root){
    if(!root||Array.isArray(root)||!Object.keys(root).length)throw Error('当前公告排期为空');
    return Object.entries(root).map(([key,item])=>{
      const raw=id(item.UIGF_pool_type);if(!['301','400','302','500'].includes(raw)||!versionValid(item.version_number)||!Number.isInteger(item.order_number)||item.order_number<1)throw Error('当前公告排期字段改变');
      const start=String(item.start_time).replaceAll('/','-'),end=String(item.end_time).replaceAll('/','-');if(localTime(start)===null||localTime(end)===null)throw Error('当前公告时间无效');
      const names={};for(const [lang,value] of Object.entries(item))if(value?.banner_name)names[lang]=String(value.banner_name);
      return {id:'announcement:'+id(key),announcementId:id(key),source:'current-banner-watcher',pool:raw==='400'?'301':raw,rawTypes:[raw],gameIds:[],names,version:String(item.version_number),phase:item.order_number,start:start+':00',end:minuteEnd(end),endPublished:end,startBasis:item.order_number===1?'utc8':'server',endBasis:'server',region:'os_asia',featured5:item.UpOrangeList.map(id),featured4:item.UpPurpleList.map(id),authority:'community',precision:'minute',maintenanceStart:item.order_number===1};
    });
  }
  function station(root){
    if(root.compat_ver!==1||!root.config?.banners||!Number.isSafeInteger(root.time))throw Error('星铁卡池配置格式改变');
    const banners=[];for(const [key,item] of Object.entries(root.config.banners)){
      if(!item.is_exclusive)continue;const gameId=id(key),prefix=gameId[0],pool=({2:'11',3:'12',5:'21',6:'22'})[prefix];if(!pool)throw Error('星铁出现未知卡池 ID 分类');
      if(!Number.isSafeInteger(item.start_time)||!Number.isSafeInteger(item.end_time)||item.start_time<=0||item.end_time<=item.start_time||!Array.isArray(item.rateup4))throw Error('星铁排期时间无效');
      banners.push({id:'station:'+gameId,gameIds:[gameId],announcementId:null,source:'star-rail-station',pool,rawTypes:[pool],names:{},version:null,phase:null,start:new Date(item.start_time*1000).toISOString().slice(0,19).replace('T',' '),end:new Date(item.end_time*1000).toISOString().slice(0,19).replace('T',' '),startBasis:'utc',endBasis:'utc',region:'global',featured5:[id(item.rateup)],featured4:item.rateup4.map(id),authority:'community',precision:'minute',companionId:item.companion_banner==null?null:id(item.companion_banner)});
    }
    if(!banners.length)throw Error('星铁活动卡池为空');return banners;
  }
  const plainHtml=html=>String(html).replace(/<[^>]*>/g,'').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&').replaceAll('&nbsp;',' ');
  function announcementTable(table){
    const grid=[],spans=[];
    for(const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[];for(let column=0;column<spans.length;column++)if(spans[column]?.remaining){cells[column]=spans[column].text;spans[column].remaining--;}
      let column=0;for(const cell of row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)){
        while(cells[column]!==undefined)column++;
        if(/\bcolspan\s*=/.test(cell[1]))throw Error('官方祈愿表格列结构改变');
        const text=plainHtml(cell[2]),span=Number(/\browspan\s*=\s*["']?(\d+)/i.exec(cell[1])?.[1]||1);if(span<1||span>20)throw Error('官方祈愿表格跨度无效');
        cells[column]=text;spans[column]={text,remaining:span-1};column++;
      }
      if(cells.length!==3||cells.some(cell=>cell===undefined))throw Error('官方祈愿表格列数无效');grid.push(cells);
    }
    if(grid.length<2)throw Error('官方祈愿表格为空');return grid;
  }
  function announcements(root,banners,items){
    if(root.retcode!==0||!Array.isArray(root.data?.list))throw Error('官方公告格式改变');
    const byId=new Map(root.data.list.map(item=>[id(item.ann_id),item])),dictionary=new Map(items.map(item=>[item.id,item]));
    return banners.map(banner=>{
      const announcement=byId.get(banner.announcementId);if(!announcement)return banner;
      const text=plainHtml(announcement.content),table=/<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(announcement.content)?.[1];
      if(!table||!String(announcement.title).includes(banner.names['zh-cn']))return {...banner,conflict:'官方公告名称或表格未匹配'};
      let grid;try{grid=announcementTable(table);}catch(error){return {...banner,conflict:error.message};}const time=grid[1][0];
      const dates=[...time.matchAll(/<(?:t)\b[^>]*class="(t_lc|t_gl)"[^>]*>(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})<\/t>/g)];
      const expected5=banner.featured5.map(itemId=>dictionary.get(itemId)?.names['zh-cn']),expected4=banner.featured4.map(itemId=>dictionary.get(itemId)?.names['zh-cn']);
      const five=grid.slice(1).map(row=>row[1]).join(''),four=grid.slice(1).map(row=>row[2]).join('');
      if(expected5.some(name=>!name||!five.includes(name))||expected4.some(name=>!name||!four.includes(name)))return {...banner,conflict:'官方概率提升名单与采集资料不一致'};
      const quotes=[...five.matchAll(/「([^」]+)」/g)].map(match=>match[1].replace(/[（(][^）)]*[）)]$/,''));
      const tableIds=new Set(items.filter(item=>item.rarity===5&&item.names?.['zh-cn']&&quotes.some(text=>text===item.names['zh-cn']||text.endsWith('·'+item.names['zh-cn']))).map(item=>item.id));
      if(tableIds.size!==banner.featured5.length||banner.featured5.some(itemId=>!tableIds.has(itemId)))return {...banner,conflict:'官方五星名单未能完整对应'};
      const namedWeapon=String(announcement.title).includes('「神铸赋形」')&&grid[0][1].includes('概率提升武器')&&banner.featured5.every(itemId=>dictionary.get(itemId)?.type==='weapon');
      const rawType=({'角色活动祈愿':'301','角色活动祈愿-2':'400','武器活动祈愿':'302','集录祈愿':'500'})[/本祈愿属于「([^」]+)」/.exec(text)?.[1]]||(namedWeapon?'302':null);
      if(!rawType||!banner.rawTypes.includes(rawType))return {...banner,conflict:'官方原始池类型未能确认'};
      if(!dates.length||dates.length>2||!banner.maintenanceStart&&dates.length!==2)return {...banner,conflict:'官方开放时间未能确认'};
      const end=minuteEnd(dates.at(-1)[2].replaceAll('/','-'));
      if(end!==banner.end)return {...banner,conflict:'官方结束时间与采集资料冲突'};
      if(!banner.maintenanceStart&&dates[0][2].replaceAll('/','-')+':00'!==banner.start)return {...banner,conflict:'官方开始时间与采集资料冲突'};
      return {...banner,authority:'official',region:'os_asia',startBasis:banner.maintenanceStart?'utc8':dates[0][1]==='t_gl'?'utc8':'server',endBasis:dates.at(-1)[1]==='t_gl'?'utc8':'server',evidence:{source:'hoyoverse-announcements',announcementId:banner.announcementId,url:urls.announcements,title:String(announcement.title)},startExplanation:banner.maintenanceStart?'版本更新后；06:00 为维护边界，不代表开放时刻':null};
    });
  }
  function cnVersions(html,game,observedAt=Date.now(),official=null){
    const source=game==='hk4e'?'genshin-cn-versions':'starrail-cn-versions',starts=new Map(),confirmed=new Set(),through=new Date(observedAt+1000+8*hour).toISOString().slice(0,19).replace('T',' ');
    const lunar={'月之一':'6.0','月之二':'6.1','月之三':'6.2','月之四':'6.3','月之五':'6.4','月之六':'6.5','月之七':'6.6','月之八':'6.7'};
    for(const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(match=>plainHtml(match[1]).trim());
      const version=game==='hk4e'&&lunar[cells[0]]||cells[0],date=/^(\d{4})\/(\d{2})\/(\d{2})$/.exec(cells[1]||'');
      if(!versionValid(version)||!date||!cells[2]?.replace(/[「」\s]/g,''))continue;
      const start=date.slice(1).join('-')+' 06:00:00';if(localTime(start)===null||start>=through)continue;
      if(starts.has(version)&&starts.get(version)!==start)throw Error('国服版本日期存在冲突');starts.set(version,start);
    }
    if(!starts.size)throw Error('国服版本日期表未能识别');
    if(official){if(official.retcode!==0||!Array.isArray(official.data?.list))throw Error('国服公告格式改变');
      for(const item of official.data.list){
        if(!/版本更新说明/.test(item.title||''))continue;
        const version=/(\d+\.\d+)版本/.exec(item.title)?.[1],text=plainHtml(item.content),date=/更新时间[^]*?(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/.exec(text);
        if(!version||!date)continue;const start=date[1].replaceAll('/','-')+' '+date[2].slice(0,5)+':00';
        if(localTime(start)!==null&&start<through){if(starts.has(version)&&starts.get(version)!==start)throw Error('国服公告与版本日期冲突');starts.set(version,start);confirmed.add(version);}
      }
    }
    const ordered=[...starts].sort((a,b)=>a[1].localeCompare(b[1]));
    return ordered.filter(([version],index)=>index<ordered.length-1||confirmed.has(version)).map(([version,start],index)=>({version,start,end:ordered[index+1]?.[1]||through,ongoing:index===ordered.length-1,region:'cn',basis:'utc8',source,precision:'day'}));
  }
  function cnGenshinAnnouncements(root,items,versions){
    if(root.retcode!==0||!Array.isArray(root.data?.list))throw Error('国服公告格式改变');
    const banners=[],source='mihoyo-genshin-announcements';
    const fromQuotes=(text,rarity)=>{const quotes=[...text.matchAll(/「([^」]+)」/g)].map(match=>match[1].replace(/[（(][^）)]*[）)]$/,''));
      const found=quotes.map(quote=>items.filter(item=>item.rarity===rarity&&item.names?.['zh-cn']&&(quote===item.names['zh-cn']||quote.endsWith('·'+item.names['zh-cn']))));
      if(!found.length||found.some(list=>list.length!==1))throw Error('国服概率提升名单未能完整对应');return [...new Set(found.map(list=>list[0].id))];};
    for(const item of root.data.list){
      const title=String(item.title||''),name=/^「([^」]+)」祈愿/.exec(title)?.[1],table=/<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(item.content)?.[1];if(!name||!table)continue;
      const grid=announcementTable(table),text=plainHtml(item.content),time=grid[1][0];
      const dates=[...time.matchAll(/(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})/g)].map(match=>match[1].replaceAll('/','-'));
      const maintenance=/版本更新后/.test(time);if(dates.length!==(maintenance?1:2))throw Error('国服祈愿开放时间未能确认');
      const end=minuteEnd(dates.at(-1)),version=maintenance?versions.find(version=>time.includes(version.version+'版本')):versions.find(version=>dates[0]+':00'>=version.start&&dates[0]+':00'<version.end);
      if(!version)continue;const start=maintenance?version.start:dates[0]+':00';
      const rawType=({'角色活动祈愿':'301','角色活动祈愿-2':'400','武器活动祈愿':'302','集录祈愿':'500'})[/本祈愿属于「([^」]+)」/.exec(text)?.[1]]||(name==='神铸赋形'&&grid[0][1].includes('概率提升武器')?'302':null);
      if(!rawType)continue;
      banners.push({id:'cn-announcement:'+id(item.ann_id),announcementId:id(item.ann_id),source,pool:rawType==='400'?'301':rawType,rawTypes:[rawType],gameIds:[],names:{'zh-cn':name},version:version.version,phase:null,start,end,endPublished:dates.at(-1),startBasis:'utc8',endBasis:'utc8',region:'cn',featured5:fromQuotes(grid.slice(1).map(row=>row[1]).join(''),5),featured4:fromQuotes(grid.slice(1).map(row=>row[2]).join(''),4),authority:'official',precision:'minute',maintenanceStart:maintenance,evidence:{source,announcementId:id(item.ann_id),url:urls.genshinCnAnnouncements,title},startExplanation:maintenance?'版本更新后；06:00 为维护边界':'国服公告开放时间'});
    }
    for(const version of versions){const starts=[...new Set(banners.filter(banner=>banner.pool==='301'&&banner.version===version.version).map(banner=>banner.start))].sort();
      // A rolling feed with only the latter period cannot establish the first period or its ordinal.
      if(starts[0]!==version.start)continue;for(const banner of banners.filter(banner=>banner.version===version.version&&['301','302'].includes(banner.pool))){const index=starts.indexOf(banner.start);if(index>=0)banner.phase=index+1;}
    }
    return banners;
  }
  function retainCnVersions(next,previous=[]){
    const current=new Map(previous.filter(item=>item.region==='cn').map(item=>[item.version,{...item}]));for(const item of next)current.set(item.version,{...item});
    const ordered=[...current.values()].sort((a,b)=>a.start.localeCompare(b.start));
    for(let i=0;i<ordered.length-1;i++){const item=ordered[i],following=ordered[i+1],a=item.version.split('.').map(Number),b=following.version.split('.').map(Number);if(item.end>following.start||item.ongoing&&a[0]===b[0]&&b[1]===a[1]+1){item.end=following.start;item.ongoing=false;}}
    return ordered;
  }
  async function hash(value){return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');}
  async function seal(value){const data={...value};delete data.revision;return {...data,revision:await hash(data)};}
  function validate(value,game=value?.game){
    if(!value||value.formatVersion!==formatVersion||value.parserVersion!==parserVersion||value.game!==game||!['hk4e','hkrpg'].includes(game)||!Array.isArray(value.banners)||!value.banners.length||!Array.isArray(value.versions)||!Array.isArray(value.items)||!Array.isArray(value.sources)||!/^[a-f0-9]{64}$/.test(value.revision||''))throw Error('游戏资料快照无效');
    const sourceIds=new Set();for(const source of value.sources){if(sourceIds.has(source.id)||!/^https:\/\//.test(source.url)||!/^[a-f0-9]{64}$/.test(source.sha256))throw Error('资料来源无效');sourceIds.add(source.id);}
    const ids=new Set();for(const banner of value.banners){
      if(!banner.id||ids.has(banner.id)||!sourceIds.has(banner.source)||!Array.isArray(banner.gameIds)||!Array.isArray(banner.rawTypes)||!Array.isArray(banner.featured5)||!banner.featured5.length||!Array.isArray(banner.featured4)||localTime(banner.start)===null||(!banner.identityOnly&&(localTime(banner.end)===null||localTime(banner.start)>=localTime(banner.end)))||banner.identityOnly&&(banner.end!==null||!banner.gameIds.length||!banner.identityEvidence)||![banner.startBasis,banner.endBasis].every(basis=>['utc8','utc','server'].includes(basis)))throw Error('卡池资料包含重复身份、无效名单或区间');
      ids.add(banner.id);[...banner.gameIds,...banner.rawTypes,...banner.featured5,...banner.featured4].forEach(id);
      if(banner.version!==null&&!versionValid(banner.version)||banner.phase!==null&&(!Number.isInteger(banner.phase)||banner.phase<1))throw Error('卡池版本或期次无效');
    }
    const itemIds=new Set();for(const item of value.items){id(item.id);if(itemIds.has(item.id)||!item.names||![1,2,3,4,5].includes(item.rarity))throw Error('物品字典无效');itemIds.add(item.id);}
    if(value.roleTypeMappingVerified!==undefined&&typeof value.roleTypeMappingVerified!=='boolean')throw Error('池类型核验标记无效');
    if(value.cnIdentitySeeds){const seed=value.cnIdentitySeeds;if(!seed.source?.id||!sourceIds.has(seed.source.id)||!Array.isArray(seed.entries)||!seed.entries.length||seed.entries.some(item=>!['21','22'].includes(item.pool)||!['character','lightcone'].includes(item.type)||!item.name||!item.itemName||!versionValid(item.version)||localTime(item.start)===null||item.longTerm!==true))throw Error('国服身份档案无效');}
    const ends=new Map();for(const item of [...value.versions].sort((a,b)=>a.start.localeCompare(b.start))){const region=item.region||'all';if(!versionValid(item.version)||localTime(item.start)===null||localTime(item.end)===null||item.start>=item.end||item.start<(ends.get(region)||''))throw Error('版本区间重叠或无效');ends.set(region,item.end);}
    if(value.phases!==undefined&&!Array.isArray(value.phases))throw Error('期次资料格式无效');
    const phaseEnds=new Map(),phaseIds=new Set();for(const item of [...(value.phases||[])].sort((a,b)=>a.start.localeCompare(b.start))){const key=item.region+':'+item.version;if(!item.id||phaseIds.has(item.id)||!sourceIds.has(item.source)||!versionValid(item.version)||!Number.isInteger(item.phase)||item.phase<1||!Number.isInteger(item.phaseCount)||item.phaseCount<item.phase||!Array.isArray(item.pools)||!item.pools.length||item.pools.some(pool=>!['301','302','11','12'].includes(pool))||localTime(item.start)===null||localTime(item.end)===null||item.start>=item.end||item.start<(phaseEnds.get(key)||'')||![item.startBasis,item.endBasis].every(basis=>['utc8','utc','server'].includes(basis)))throw Error('期次区间重复、重叠或无效');phaseIds.add(item.id);phaseEnds.set(key,item.end);}
    if(!Array.isArray(value.eligibility))throw Error('常驻资格规则格式无效');
    for(const rule of value.eligibility){id(rule.itemId);if(!/^\d+$/.test(rule.pool)||!versionValid(rule.startVersion)||rule.endVersion&&(!versionValid(rule.endVersion)||compareVersion(rule.endVersion,rule.startVersion)<=0)||typeof rule.evidence?.url!=='string'||!rule.evidence.url.startsWith('https://'))throw Error('常驻资格规则缺少版本或来源证据');}
    return value;
  }
  async function verify(value,game){validate(value,game);if((await seal(value)).revision!==value.revision)throw Error('游戏资料哈希不匹配');return value;}
  const datasetId=game=>game==='hk4e'?'genshin-reference':'starrail-reference';
  const current=store=>store?.snapshots?.find(item=>item.revision===store.activeRevision)||null;
  function builtin(game){return globalThis.gachaReferenceBundle?.[game]||null;}
  const stores=new Map();
  const active=game=>{const cached=current(stores.get(game));return cached&&!(cached.ruleVersion<ruleVersion&&cached.sources.some(source=>['paimon-moe','star-rail-station'].includes(source.id)))?cached:builtin(game);};
  function install(game,store){const next=current(store);if(next)validate(next,game);stores.set(game,store);return active(game);}
  async function load(client,game){
    const bytes=await client.readDataset(datasetId(game),8388608);if(!bytes){stores.delete(game);return null;}
    const root=JSON.parse(new TextDecoder().decode(bytes));if(root.formatVersion!==1||root.game!==game||!Array.isArray(root.snapshots)||root.snapshots.length>3)throw Error('游戏资料缓存格式无效');
    for(const snapshot of root.snapshots)await verify(snapshot,game);if(!current(root))throw Error('游戏资料有效修订缺失');install(game,root);return root;
  }
  function regionOf(account){const raw=String(account?.region||'');if(/^(cn_|prod_gf_cn|prod_qd_cn)/.test(raw))return 'cn';if(raw==='os_asia'||raw==='prod_official_asia')return 'os_asia';if(raw==='os_usa'||raw==='prod_official_usa')return 'os_usa';if(raw==='os_euro'||raw==='prod_official_eur')return 'os_euro';if(raw==='os_cht'||raw==='prod_official_cht')return 'os_cht';return null;}
  const timezoneOf=(record,account)=>{if(record.timezoneAssumed)return null;const value=record.timezone??(account?.timezoneAssumed?null:account?.timezone);if(value===null||value===undefined||value===''||!['number','string'].includes(typeof value))return null;const number=Number(value);return Number.isFinite(number)&&number>=-12&&number<=14?number:null;};
  const boundaryTimes=new WeakMap();
  function boundary(banner,side,timezone){const legacyMinute=side==='end'&&banner.source==='current-banner-watcher'&&!banner.endPublished&&banner.precision==='minute'&&banner.end?.endsWith(':59'),key=side+':'+banner[side]+':'+legacyMinute;let times=boundaryTimes.get(banner);if(!times){times=new Map();boundaryTimes.set(banner,times);}if(!times.has(key))times.set(key,localTime(banner[side])+(legacyMinute?1000:0));return times.get(key)-(banner[side+'Basis']==='utc8'?8:banner[side+'Basis']==='utc'?0:timezone)*hour;}
  function inTime(banner,record,account){const zone=timezoneOf(record,account),stamp=localTime(record.time);if(zone===null||stamp===null||!banner.start||!banner.end)return false;const utc=stamp-zone*hour;return utc>=boundary(banner,'start',zone)&&utc<boundary(banner,'end',zone);}
  function supportsRegion(item,region){
    if(!region)return false;
    // Older caches used "all" for overseas collectors. Provenance still restricts their use.
    if(['paimon-moe','star-rail-station'].includes(item.source)&&region==='cn')return false;
    if(item.source==='current-banner-watcher')return region==='os_asia';
    if(item.source==='starrail-version-calendar')return region==='cn';
    return !item.region||item.region==='all'||item.region===region||item.region==='global'&&region!=='cn';
  }
  const indexes=new WeakMap();
  function intervalIndex(entries){
    entries.sort((a,b)=>a.start-b.start);let end=-Infinity;
    for(const entry of entries){end=Math.max(end,entry.end);entry.maxEnd=end;}
    return entries;
  }
  function atTime(entries,stamp){
    let low=0,high=entries.length;while(low<high){const middle=(low+high)>>>1;if(entries[middle].start<=stamp)low=middle+1;else high=middle;}
    const matches=[];for(let index=low-1;index>=0&&entries[index].maxEnd>stamp;index--)if(entries[index].end>stamp)matches.push(entries[index].item);return matches;
  }
  function indexFor(snapshot,region,zone){
    if(!snapshot)return {versions:[],pools:new Map(),ids:new Map(),phases:new Map(),phaseIntervals:[]};
    let contexts=indexes.get(snapshot);if(!contexts){contexts=new Map();indexes.set(snapshot,contexts);}const key=region+':'+zone;if(contexts.has(key))return contexts.get(key);
    const versions=intervalIndex(snapshot.versions.filter(item=>supportsRegion(item,region)).map(item=>({item,start:localTime(item.start)-(item.basis==='server'?zone:8)*hour,end:localTime(item.end)-(item.basis==='server'?zone:8)*hour}))),pools=new Map(),ids=new Map(),phases=new Map();
    for(const item of snapshot.banners){if(!supportsRegion(item,region)||item.conflict)continue;
      if(!item.identityOnly){const entry={item,start:boundary(item,'start',zone),end:boundary(item,'end',zone)};if(!pools.has(item.pool))pools.set(item.pool,[]);pools.get(item.pool).push(entry);}
      for(const id of item.gameIds){const key=item.pool+':'+id;if(!ids.has(key))ids.set(key,[]);ids.get(key).push(item);}
      if(item.version&&item.phase&&['301','302','11','12'].includes(item.pool)){const key=item.version+':'+item.phase;if(!phases.has(item.version))phases.set(item.version,new Set());phases.get(item.version).add(key);}
    }
    const phaseIntervals=intervalIndex((snapshot.phases||[]).filter(item=>supportsRegion(item,region)).map(item=>({item,start:boundary(item,'start',zone),end:boundary(item,'end',zone)})));
    for(const {item} of phaseIntervals){if(!phases.has(item.version))phases.set(item.version,new Set());phases.get(item.version).add(item.version+':'+item.phase);}
    for(const entries of pools.values())intervalIndex(entries);
    const result={versions,pools,ids,phases,phaseIntervals};if(contexts.size>=8)contexts.delete(contexts.keys().next().value);contexts.set(key,result);return result;
  }
  function gameVersion(record,game,account={},snapshot=active(game)){
    const explicit=String(record.game_version??record.version??'').trim();if(versionValid(explicit)&&!record.fieldConflicts?.game_version?.length&&!record.fieldConflicts?.version?.length)return {version:explicit,basis:'record-field'};
    if(['time','timezone','region'].some(field=>record.fieldConflicts?.[field]?.length))return {version:null,basis:'conflict'};
    const stamp=localTime(record.time),zone=timezoneOf(record,account);if(stamp===null||zone===null)return {version:null,basis:'missing-time'};
    const region=regionOf({region:record.region??account.region}),index=indexFor(snapshot,region,zone),item=atTime(index.versions,stamp-zone*hour)[0]||atTime(index.phaseIntervals,stamp-zone*hour)[0];
    return {version:item?.version||null,basis:item?.source||'uncovered'};
  }
  const recordContexts=new WeakMap();
  function recordContext(records,game,account={},snapshot=active(game)){
    if(game!=='hk4e'||!snapshot)return account;
    let contexts=recordContexts.get(records);if(!contexts){contexts=new Map();recordContexts.set(records,contexts);}
    const key=JSON.stringify([game,account.uid,account.region,account.timezone,account.timezoneAssumed]);let evidence=contexts.get(key);
    if(!evidence||evidence.snapshot!==snapshot||evidence.length!==records.length){
      evidence={snapshot,length:records.length,suspectSubtypes:new Set()};
      const probe={...account,subtypeEvidence:null};
      for(const record of records){
        if(account.uid&&String(record.uid)!==String(account.uid)||Number(record.rank_type)!==5||!['301','400'].includes(String(record.gacha_type)))continue;
        const result=resolve(record,game,probe,snapshot);if(result.subtypeMismatch&&result.subtypeKey)evidence.suspectSubtypes.add(result.subtypeKey);
      }
      if(contexts.size>=8)contexts.delete(contexts.keys().next().value);contexts.set(key,evidence);
    }
    return {...account,subtypeEvidence:evidence};
  }
  function knownNonUp(record,version,pool,region,snapshot){
    if(!record.fieldConflicts?.is_up?.length&&['0','false','not_up','not-up','no'].includes(String(record.is_up??'').toLowerCase()))return true;
    return !!snapshot?.eligibility?.some(rule=>rule.evidence&&rule.itemId===String(record.item_id)&&rule.pool===pool&&supportsRegion(rule,region)&&version&&compareVersion(version,rule.startVersion)>=0&&(!rule.endVersion||compareVersion(version,rule.endVersion)<0));
  }
  function resolve(record,game,account={},snapshot=active(game)){
    const version=gameVersion(record,game,account,snapshot),raw=record.gachaTypeAssumed?'':String(record.gacha_type||''),pool=globalThis.gachaModel?.poolType(game,record.uigf_gacha_type||record.gacha_type)||raw;
    // Preserve the supplied subtype for display. Contradictory outcomes flag its scope for review;
    // they never reassign the record or its neighbours to the obtained character's banner.
    const rawTypeVerified=!!raw;
    const result={...version,candidates:[],banner:null,nativeIdentity:null,identityKey:null,phase:null,phaseSchedule:null,timeMatch:null,certainty:'uncovered',rawTypeVerified,possibleError:null,revision:snapshot?.revision||null,ruleVersion};
    const gameId=String(game==='hk4e'&&['1000','2000'].includes(pool)?record.schedule_id||record.gacha_id||'':record.gacha_id||record.schedule_id||''),region=regionOf({region:record.region??account.region}),zone=timezoneOf(record,account),stamp=localTime(record.time),index=indexFor(snapshot,region,zone??8);
    const timeConflict=['time','timezone','region'].some(field=>record.fieldConflicts?.[field]?.length),poolConflict=record.fieldConflicts?.gacha_type?.some(entry=>(globalThis.gachaModel?.poolType(game,String(entry.value))||String(entry.value))!==pool);
    if(!timeConflict&&!poolConflict&&zone!==null&&stamp!==null){const phase=atTime(index.phaseIntervals,stamp-zone*hour).find(item=>item.pools.includes(pool)&&(!result.version||item.version===result.version));if(phase){result.phase=phase.version+':'+phase.phase;result.phaseSchedule=phase;if(!result.version)result.version=phase.version;}}
    if(['gacha_type','gacha_id','schedule_id','region'].some(field=>record.fieldConflicts?.[field]?.length))return {...result,certainty:'conflict'};
    let available=game==='hkrpg'&&gameId?index.ids.get(pool+':'+gameId)||[]:!timeConflict&&zone!==null&&stamp!==null?atTime(index.pools.get(pool)||[],stamp-zone*hour):[];
    const official=available.filter(item=>item.authority==='official');if(official.length)available=available.filter(item=>item.authority==='official'||!official.some(next=>next.pool===item.pool&&next.version===item.version&&next.featured5.slice().sort().join(',')===item.featured5.slice().sort().join(',')));
    let candidates=available.filter(item=>!rawTypeVerified||item.rawTypes.includes(raw));
    if(game==='hk4e'&&pool==='301'&&rawTypeVerified&&new Set(available.map(item=>item.featured5.slice().sort().join(','))).size>1){
      const source=record.fieldSources?.gacha_type||'legacy';
      result.subtypeKey=JSON.stringify([String(record.uid??account.uid??''),region,raw,source,available.map(item=>item.groupingId||item.id).sort()]);
      const itemId=String(record.item_id||''),outcomeMismatch=Number(record.rank_type)===5&&itemId&&!['item_id','rank_type','time','timezone','region'].some(field=>record.fieldConflicts?.[field]?.length)&&candidates.length&&!candidates.some(item=>item.featured5.includes(itemId))&&available.some(item=>item.featured5.includes(itemId))&&!knownNonUp(record,result.version,pool,region,snapshot);
      const evidence=account.subtypeEvidence;
      result.subtypeMismatch=!!outcomeMismatch||evidence?.snapshot===snapshot&&evidence.suspectSubtypes.has(result.subtypeKey);
      if(result.subtypeMismatch){result.rawTypeVerified=false;result.possibleError=outcomeMismatch?'出金物品与记录所指角色池不符，却出现在同期另一个角色池的 UP 名单中。':'同一期、同类型和来源的出金记录与卡池名单不符，本条记录的归属也需核对。';}
    }
    const identities=new Set(candidates.map(item=>item.featured5.slice().sort().join(',')+':'+item.pool)),sameIdentity=game==='hkrpg'&&gameId&&identities.size===1;
    result.candidates=candidates;result.banner=candidates.length===1||sameIdentity?candidates[0]:null;result.certainty=result.banner?(game==='hkrpg'&&gameId?'identity':'unique'):candidates.length?'ambiguous':'uncovered';
    if(game==='hk4e'&&pool==='301'&&candidates.length>1)result.identityReason=!raw?'缺少可用的原始角色子池类型，保留版本与期次。':'同期开池资料无法唯一对应原始类型，保留版本与期次。';
    if((game==='hkrpg'&&['11','12','21','22'].includes(pool)||game==='hk4e'&&['1000','2000'].includes(pool))&&/^\d{1,64}$/.test(gameId)&&!/^0+$/.test(gameId)){
      result.identityKey='native:'+game+':'+(region||'unspecified')+':'+pool+':'+gameId;
      if(!result.banner&&!candidates.length){const label=globalThis.gachaModel?.games[game]?.pools.find(item=>item[0]===pool)?.[1]||pool;result.nativeIdentity={id:result.identityKey,gameId,pool,label:label+' · ID '+gameId};result.certainty='record-identity';}
    }
    if(result.banner&&zone!==null&&stamp!==null&&!timeConflict){const utc=stamp-zone*hour;result.timeMatch=result.banner.identityOnly?utc>=boundary(result.banner,'start',zone):utc>=boundary(result.banner,'start',zone)&&utc<boundary(result.banner,'end',zone);}
    if(result.banner&&result.timeMatch===false)result.possibleError='记录时间与所指卡池已核验的开放区间不符。';
    const phases=[...new Set(candidates.map(item=>item.version&&item.phase?`${item.version}:${item.phase}`:null))];
    if(!result.phase&&!timeConflict&&['301','302','11','12'].includes(pool)&&phases.length===1&&phases[0]&&(!gameId||result.timeMatch===true))result.phase=phases[0];
    if(!result.version&&result.banner?.version&&['301','302','11','12'].includes(pool)&&inTime(result.banner,record,account))result.version=result.banner.version;
    if(version.basis==='record-field'&&['301','302','11','12'].includes(pool)&&candidates.some(item=>item.version)&&candidates.every(item=>item.version&&item.version!==version.version))return {...result,banner:game==='hkrpg'&&gameId?result.banner:null,phase:null,phaseSchedule:null,certainty:game==='hkrpg'&&gameId?'identity':'conflict',conflict:'记录版本与卡池排期冲突'};
    if(result.banner&&game==='hk4e'&&pool==='301')result.identityBasis=result.possibleError?'按记录中的子池类型展示，归属可能错误，需核对。':/^user-(?:recollection|confirmed):/.test(record.fieldSources?.gacha_type||'')?'用户确认或回忆补全的子池类型与对应地区排期':'记录原始子池类型与对应地区排期';
    return result;
  }
  function upEvidence(record,game,account,sources,snapshot=active(game)){
    const resolved=resolve(record,game,account,snapshot),allowed=game==='hk4e'?sources.includes('paimon-moe'):sources.includes('star-rail-station');
    const byId=game==='hkrpg'&&!!record.gacha_id&&resolved.certainty==='identity';
    if(resolved.possibleError&&!byId)return {value:null,reason:'卡池归属可能错误，暂不自动判断 UP／非 UP',...resolved};
    if(record.fieldConflicts?.item_id?.length||record.fieldConflicts?.region?.length||!byId&&(['time','timezone'].some(field=>record.fieldConflicts?.[field]?.length)||resolved.timeMatch===false))return {value:null,reason:'记录时间或物品证据与资料存在冲突',...resolved};
    if(resolved.certainty==='conflict')return {value:null,reason:resolved.conflict||'原始身份或时间证据存在冲突',...resolved};
    if(!allowed||!record.item_id||!resolved.candidates.length)return {value:null,reason:resolved.certainty==='conflict'?'原始身份或时间证据存在冲突':'资料不足',...resolved};
    if(resolved.candidates.some(item=>item.conflict))return {value:null,reason:'资料来源冲突',...resolved};
    const usable=byId?resolved.candidates.filter(item=>item.upListVerified!==false):resolved.candidates;
    if(!usable.length||!byId&&usable.some(item=>item.upListVerified===false))return {value:null,reason:'组合卡池的所选UP规则未核验',...resolved};
    const values=usable.map(item=>item.featured5.includes(String(record.item_id)));
    if(values.some(value=>value!==values[0]))return {value:null,reason:'同期开池无法区分',...resolved};
    return {value:values[0],reason:byId?'原始卡池ID与国服／相应地区名单对应':resolved.certainty==='ambiguous'?'同期开池的名单结论一致':'公开卡池名单',...resolved};
  }
  function mergeItems(...lists){const result=new Map();for(const list of lists)for(const item of list){const previous=result.get(item.id);result.set(item.id,{...previous,...item,names:{...previous?.names,...item.names}});}return [...result.values()].sort((a,b)=>a.id.localeCompare(b.id));}
  async function download(request,url,sourceId){const response=await request(url,{deadlineMs:60000});if(response.status<200||response.status>=300)throw Object.assign(Error(`资料读取失败（HTTP ${response.status}）`),{status:response.status});const text=String(response.text||'');if(!text||text.length>8388608)throw Error('资料响应大小无效');return {text,source:{id:sourceId,url,sha256:await hash(text),fetchedAt:Number.isFinite(response.observedAt)&&response.observedAt<=Date.now()?response.observedAt:Date.now(),revision:response.headers?.etag||null}};}
  async function candidate(request,game,previous=active(game)){
    const fetchedAt=Date.now(),sources=[],warnings=[];let items,banners,versions,phases=[],roleTypeMappingVerified=!!previous?.roleTypeMappingVerified;
    if(game==='hk4e'){
      const results=await Promise.all([download(request,urls.paimon,'paimon-moe'),download(request,urls.genshinItems,'hoyolab-genshin-items'),download(request,urls.watcher,'current-banner-watcher')]);
      sources.push(...results.map(item=>item.source));items=mergeItems(previous?.items||[],genshinDictionary(JSON.parse(results[1].text)));({banners,versions}=paimon(results[0].text,items,results[0].source.fetchedAt));
      let latest=watcher(JSON.parse(results[2].text));
      try{const names=await download(request,urls.genshinNames,'hoyolab-genshin-names');sources.push(names.source);items=mergeItems(items,genshinDictionary(JSON.parse(names.text),'zh-cn'));
        const official=await download(request,urls.announcements,'hoyoverse-announcements');sources.push(official.source);latest=announcements(JSON.parse(official.text),latest,items);
      }catch(error){warnings.push('官方公告交叉核对未完成：'+error.message);}
      // Current announcement collectors are rolling: retain prior, evidenced announcements for older periods.
      const latestIds=new Set(latest.map(item=>item.id));latest=[...(previous?.banners||[]).filter(item=>item.source==='current-banner-watcher'&&!latestIds.has(item.id)),...latest];
      banners=[...banners,...latest];
    }else{
      const config=await download(request,urls.station,'star-rail-station');sources.push(config.source);banners=station(JSON.parse(config.text));versions=(previous?.versions||[]).filter(item=>item.region&&item.region!=='cn');items=previous?.items||[];
      try{const results=await Promise.all([download(request,urls.characters,'starrail-characters'),download(request,urls.lightcones,'starrail-lightcones')]);sources.push(...results.map(item=>item.source));items=mergeItems(previous?.items||[],starrailDictionary(JSON.parse(results[0].text),'character'),starrailDictionary(JSON.parse(results[1].text),'lightcone'));}
      catch(error){warnings.push('物品字典未更新：'+error.message);sources.push(...(previous?.sources||[]).filter(source=>['starrail-characters','starrail-lightcones'].includes(source.id)));}
      sources.push(...(previous?.sources||[]).filter(source=>versions.some(item=>item.source===source.id)&&!sources.some(next=>next.id===source.id)));
    }
    const cnVersionId=game==='hk4e'?'genshin-cn-versions':'starrail-cn-versions',cnAnnouncementId=game==='hk4e'?'mihoyo-genshin-announcements':'mihoyo-starrail-announcements';
    try{
      const [dates,official]=await Promise.all([download(request,game==='hk4e'?urls.genshinCnVersions:urls.starrailCnVersions,cnVersionId),download(request,game==='hk4e'?urls.genshinCnAnnouncements:urls.starrailCnAnnouncements,cnAnnouncementId)]),root=JSON.parse(official.text);
      const calendar=retainCnVersions(cnVersions(dates.text,game,official.source.fetchedAt,root),previous?.versions),latest=game==='hk4e'?cnGenshinAnnouncements(root,items,calendar):[],latestIds=new Set(latest.map(item=>item.id));
      sources.push(dates.source,official.source);versions=[...versions,...calendar];banners.push(...(previous?.banners||[]).filter(item=>item.source===cnAnnouncementId&&!latestIds.has(item.id)),...latest);
    }catch(error){
      warnings.push('国服资料未更新：'+error.message);versions.push(...(previous?.versions||[]).filter(item=>item.region==='cn'));banners.push(...(previous?.banners||[]).filter(item=>item.source===cnAnnouncementId));
      sources.push(...(previous?.sources||[]).filter(source=>[cnVersionId,cnAnnouncementId].includes(source.id)));
    }
    const historySources=game==='hk4e'?[{id:'genshin-cn-history',url:urls.genshinCnHistory,kind:'regular'},{id:'genshin-cn-chronicle',url:urls.genshinCnChronicle,kind:'chronicle'}]:[{id:'starrail-cn-history',url:urls.starrailCnHistory,kind:'regular'}];
    const historyDownloads=await Promise.allSettled(historySources.map(source=>download(request,source.url,source.id)));
    for(let i=0;i<historySources.length;i++){
      const source=historySources[i];try{
        if(historyDownloads[i].status==='rejected')throw historyDownloads[i].reason;const data=historyDownloads[i].value;
        let parsed=gachaReferenceHistory.parse(data.text,game,items,versions,{source:source.id,url:source.url,kind:source.kind,catalog:banners.filter(item=>item.source==='star-rail-station'),typeProof:roleTypeMappingVerified});
        if(game==='hk4e'&&source.kind==='regular'){roleTypeMappingVerified=gachaReferenceHistory.subtypeProof(parsed,banners.filter(item=>item.source===cnAnnouncementId),roleTypeMappingVerified);if(roleTypeMappingVerified)parsed=gachaReferenceHistory.parse(data.text,game,items,versions,{source:source.id,url:source.url,kind:source.kind,typeProof:true});}
        const old=(previous?.banners||[]).filter(item=>item.source===source.id);if(old.length>20&&parsed.banners.length<old.length*.8)throw Error('历史覆盖明显减少，保留上一份资料');
        const merged=new Map(old.map(item=>[item.id,item]));for(const item of parsed.banners){for(const [key,prior] of merged)if(key!==item.id&&prior.pool===item.pool&&prior.version===item.version&&prior.featured5.join(',')===item.featured5.join(',')&&prior.start===item.start)merged.delete(key);merged.set(item.id,item);}banners.push(...merged.values());sources.push(data.source);
        if(source.kind==='regular')phases.push(...gachaReferenceHistory.phases(parsed.observations,versions,game));
        if(parsed.warnings.length)warnings.push(source.id+'：'+parsed.warnings.length+' 项未能完整解析');
      }catch(error){warnings.push(source.id+' 未更新：'+error.message);banners.push(...(previous?.banners||[]).filter(item=>item.source===source.id));phases.push(...(previous?.phases||[]).filter(item=>item.source===source.id));sources.push(...(previous?.sources||[]).filter(item=>item.id===source.id));}
    }
    const cnIdentitySeeds=game==='hkrpg'?(builtin(game)?.cnIdentitySeeds||previous?.cnIdentitySeeds):null;
    if(game==='hkrpg'){
      const catalog=banners.filter(item=>item.source==='star-rail-station');
      if(cnIdentitySeeds){
        const source={...cnIdentitySeeds.source,sha256:await hash(cnIdentitySeeds.entries)};sources.push(source);
        for(const seed of cnIdentitySeeds.entries){const item=items.find(item=>item.type===seed.type&&item.rarity===5&&item.names?.['zh-cn']===seed.itemName);if(!item)continue;
          const base={id:source.id+':'+seed.pool+':'+item.id,source:source.id,pool:seed.pool,rawTypes:[seed.pool],gameIds:[],announcementId:null,names:{'zh-cn':seed.name},version:seed.version,phase:null,start:seed.start,end:null,identityOnly:true,startBasis:'utc8',endBasis:'utc8',region:'cn',featured5:[item.id],featured4:[],authority:'official',precision:'identity',evidence:{source:source.id,url:source.url,title:'国服联动跃迁说明；开池时间与完整五星名单'},profileItemId:item.id};
          const linked=gachaReferenceHistory.attachIds(base,catalog);if(linked.gameIds.length)banners.push(linked);
        }
      }
      const covered=new Set(banners.filter(item=>item.region==='cn'&&['21','22'].includes(item.pool)).flatMap(item=>item.featured5)),wanted=[...new Set(catalog.filter(item=>['21','22'].includes(item.pool)).flatMap(item=>item.featured5))].filter(id=>!covered.has(id));
      const jobs=wanted.map(itemId=>({item:items.find(item=>item.id===itemId),id:'starrail-cn-profile-'+itemId}));
      // Keep public wiki requests bounded; these calls never carry account data.
      let throttled=false;for(let i=0;i<jobs.length;i+=2){if(throttled){for(const job of jobs.slice(i)){banners.push(...(previous?.banners||[]).filter(item=>item.source===job.id));sources.push(...(previous?.sources||[]).filter(item=>item.id===job.id));}break;}await Promise.all(jobs.slice(i,i+2).map(async job=>{
        try{if(!job.item?.names?.['zh-cn'])throw Error('联动物品缺少中文名称');const url='https://wiki.biligame.com/sr/index.php?title='+encodeURIComponent(job.item.names['zh-cn']),data=await download(request,url,job.id),entries=gachaReferenceHistory.profile(data.text,job.item,versions,catalog,{source:job.id,url});banners.push(...entries);sources.push(data.source);}
        catch(error){if([403,429,567].includes(error.status))throttled=true;warnings.push(job.id+' 未更新：'+error.message);banners.push(...(previous?.banners||[]).filter(item=>item.source===job.id));sources.push(...(previous?.sources||[]).filter(item=>item.id===job.id));}
      }));}
    }
    if(game==='hk4e')banners=banners.map(official=>{if(official.authority!=='official'||official.region!=='cn')return official;
      const matches=banners.filter(item=>item.source.startsWith('genshin-cn-')&&item.pool===official.pool&&item.version===official.version&&item.rawTypes.length===1&&official.rawTypes.length===1&&item.rawTypes[0]===official.rawTypes[0]&&item.featured5.slice().sort().join(',')===official.featured5.slice().sort().join(',')&&item.start<official.end&&official.start<item.end);
      return matches.length===1?{...official,groupingId:matches[0].id}:official;
    });
    banners.sort((a,b)=>a.id.localeCompare(b.id));sources.sort((a,b)=>a.id.localeCompare(b.id));phases.sort((a,b)=>a.id.localeCompare(b.id));
    const result=await seal({formatVersion,parserVersion,ruleVersion,game,sources,items,banners,versions,phases,roleTypeMappingVerified,cnIdentitySeeds,eligibility:previous?.eligibility||[],warnings});validate(result,game);
    // Revision describes semantic data and source content, not the time of the check.
    const stable=await hash({game,parserVersion,ruleVersion,banners,versions:versions.map(item=>item.ongoing?{...item,end:null}:item),phases,roleTypeMappingVerified,items,eligibility:result.eligibility,sources:sources.map(({id,url})=>({id,url}))});
    return {...result,contentRevision:stable,fetchedAt};
  }
  async function update(client,game){
    const previous=active(game),next=await candidate(client.request,game,previous);
    // Seal the full stored representation after adding public metadata.
    const sealed=await seal(next),old=stores.get(game),changed=previous?.contentRevision!==sealed.contentRevision;
    const snapshots=[sealed,...(old?.snapshots||[previous]).filter(Boolean).filter(item=>item.revision!==sealed.revision&&(changed||item.revision!==previous.revision))].slice(0,3);
    const store={formatVersion,game,activeRevision:sealed.revision,snapshots,checkedAt:Date.now(),lastResult:changed?'updated':'unchanged',warnings:next.warnings};
    await client.writeDataset(datasetId(game),new TextEncoder().encode(JSON.stringify(store)));
    install(game,store);return {changed,previous,snapshot:active(game),store};
  }
  const name=(snapshot,itemId,lang='zh-cn')=>{const names=snapshot?.items?.find(item=>item.id===String(itemId))?.names;return names?.[lang]||names?.['en-us']||String(itemId);};
  const bannerName=(banner,snapshot)=>banner.names?.['zh-cn']||banner.names?.['en-us']||banner.featured5.map(itemId=>name(snapshot,itemId)).join(' / ')||banner.id;
  globalThis.gachaReference={urls,formatVersion,parserVersion,ruleVersion,literals,genshinDictionary,starrailDictionary,paimon,watcher,station,announcements,cnVersions,retainCnVersions,cnGenshinAnnouncements,hash,seal,validate,verify,datasetId,current,active,builtin,install,load,regionOf,supportsRegion,indexFor,timezoneOf,localTime,boundary,inTime,gameVersion,recordContext,resolve,upEvidence,candidate,update,name,bannerName,mergeItems,compareVersion};
})();
