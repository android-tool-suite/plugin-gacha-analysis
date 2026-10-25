(() => {
  'use strict';
  const hour=3600000,lunar={'月之一':'6.0','月之二':'6.1','月之三':'6.2','月之四':'6.3','月之五':'6.4','月之六':'6.5','月之七':'6.6','月之八':'6.7'};
  const ref=()=>globalThis.gachaReference;
  const contentOnly=value=>String(value).replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi,'');
  function plain(value){return contentOnly(value).replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,code)=>String.fromCodePoint(parseInt(code.replace(/^x/i,''),/^x/i.test(code)?16:10))).replace(/&(?:nbsp|amp|quot|lt|gt);/g,token=>({'&nbsp;':' ','&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>'})[token]).replace(/\s+/g,' ').trim();}
  // Leaf tables preserve the source's separate simultaneous banners; wrapper tables are never merged.
  function tables(html){
    if(typeof html!=='string'||html.length>8388608)throw Error('历史资料页面大小无效');
    html=contentOnly(html);
    const stack=[],result=[];for(const match of html.matchAll(/<\/?table\b[^>]*>/gi)){
      if(match[0][1]==='/'){const entry=stack.pop();if(entry&&!entry.child&&/\bclass\s*=\s*["'][^"']*wikitable/i.test(entry.tag))result.push(html.slice(entry.start,match.index+match[0].length));}
      else{if(stack.length)stack.at(-1).child=true;if(stack.length>=16)throw Error('历史表格嵌套过深');stack.push({start:match.index,tag:match[0],child:false});}
    }
    if(stack.length)throw Error('历史表格不完整');return result;
  }
  function tableRows(table){
    const fields=new Map();let title='',headerTitles=[];for(const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match=>match[1]);
      if(cells.length===1&&!title){headerTitles=[...contentOnly(cells[0]).matchAll(/\balt="([^"]+)"/g)].map(match=>plain(match[1]));title=plain(cells[0])||headerTitles[0]||'';}
      if(cells.length>=2)fields.set(plain(cells[0]),cells.slice(1));
    }return {title,fields,headerTitles};
  }
  function versionTag(text){const match=/^(月之[一二三四五六七八]|\d+\.\d+)(.*)$/.exec(plain(text));return match?{version:lunar[match[1]]||match[1],label:match[2].trim()}:null;}
  function publishedTime(text){
    const match=/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);if(!match)return null;
    const value=match.slice(1).map((part,index)=>index===0?part:String(part??'00').padStart(2,'0')).join('').replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,'$1-$2-$3 $4:$5:$6');
    if(ref().localTime(value)===null)throw Error('历史资料日期无效');return {value,precision:match[6]?'second':'minute'};
  }
  function range(text,version,versions){
    text=plain(text);const pieces=text.split(/\s*[~～至]\s*/);if(pieces.length!==2)throw Error('历史资料起止时间未能识别');
    const calendar=versions.find(item=>item.version===version&&item.region==='cn');if(!calendar)return null;
    const first=publishedTime(pieces[0]),last=publishedTime(pieces[1]),maintenance=/版本更新后|开服后/.test(pieces[0]);
    if(!first&&!maintenance)throw Error('历史资料开始时间未能识别');
    const start=first?.value||calendar.start,identityOnly=/长期/.test(pieces[1]);if(!last&&!identityOnly)throw Error('历史资料结束时间未能识别');
    // Source seconds ending in :59 and published minute endings are inclusive; exact :00 endings are boundaries.
    const end=last?new Date(ref().localTime(last.value)+(last.precision==='minute'&&!last.value.endsWith(':00:00')?60000:last.value.endsWith(':59')?1000:0)).toISOString().slice(0,19).replace('T',' '):null;
    if(end&&start>=end)throw Error('历史资料区间无效');return {start,end,endPublished:last?.value||'长期',maintenanceStart:maintenance,identityOnly,precision:last?.precision||'identity'};
  }
  function itemIds(cells,items,rarity,type){
    const raw=cells.join(' '),names=[...raw.matchAll(/\btitle="([^"]+)"/g)].map(match=>plain(match[1])).filter(name=>!name.startsWith('文件:'));
    const quotes=[...plain(raw).matchAll(/「([^」]+)」/g)].map(match=>match[1].replace(/[（(][^）)]*[）)]$/,''));
    const text=plain(raw),found=items.filter(item=>item.rarity===rarity&&item.type===type&&item.names?.['zh-cn']&&(names.includes(item.names['zh-cn'])||quotes.some(name=>name===item.names['zh-cn']||name.endsWith('·'+item.names['zh-cn']))||text===item.names['zh-cn']||text.startsWith(item.names['zh-cn']+'（')));
    const ids=[...new Set(found.map(item=>item.id))].sort();
    if(rarity===5){const expected=[...new Set(names.length?names:quotes)];if(text&&!ids.length||expected.some(name=>!found.some(item=>name===item.names['zh-cn']||name.endsWith('·'+item.names['zh-cn']))))throw Error('历史五星名单未能完整对应字典');}
    return ids;
  }
  function attachIds(banner,catalog){
    const ids=[...banner.featured5].sort().join(','),start=ref().localTime(banner.start)-8*hour;
    const same=catalog.filter(item=>[...item.featured5].sort().join(',')===ids&&Math.abs(ref().boundary(item,'start',8)-start)<=36*hour),preferred=same.filter(item=>item.pool===banner.pool);
    const matches=preferred.length?preferred:same.filter(item=>banner.pool==='11'&&item.pool==='21'||banner.pool==='12'&&item.pool==='22');
    if(matches.length!==1)return banner;
    return {...banner,id:banner.source+':'+matches[0].pool+':'+matches[0].gameIds.join('-'),pool:matches[0].pool,rawTypes:[matches[0].pool],gameIds:[...matches[0].gameIds],identityEvidence:{source:'star-rail-station',catalogueId:matches[0].id,match:'同类物品、完整五星名单与同一开池日期交叉对应'}};
  }
  function splitIdentities(banner,catalog){
    const direct=attachIds(banner,catalog);if(direct.gameIds.length||banner.featured5.length<2)return [direct];
    const start=ref().localTime(banner.start)-8*hour,choices=catalog.filter(item=>item.pool===banner.pool&&item.featured5.length===1&&banner.featured5.includes(item.featured5[0])&&Math.abs(ref().boundary(item,'start',8)-start)<=36*hour);
    if(choices.length!==banner.featured5.length||new Set(choices.flatMap(item=>item.featured5)).size!==banner.featured5.length)return [banner];
    // The original ID identifies a member of a selection banner. Membership alone does not prove the chosen UP rules.
    return choices.map(item=>({...banner,id:banner.source+':'+banner.pool+':'+item.gameIds.join('-'),gameIds:[...item.gameIds],featured5:[...item.featured5],sourceFeatured5:[...banner.featured5],upListVerified:false,identityEvidence:{source:'star-rail-station',catalogueId:item.id,match:'原始卡池ID与国服同期开池名单的成员对应；不据此推断所选UP'}}));
  }
  function parse(html,game,items,versions,{source,url,kind='regular',catalog=[],typeProof=false}={}){
    const banners=[],observations=[],warnings=[];let recognized=0;
    for(const table of tables(html)){
      const {title,fields,headerTitles}=tableRows(table);if(!fields.has('时间')||!fields.has('版本'))continue;
      const meta=versionTag(fields.get('版本')[0]);if(!meta)continue;
      const character=/角色活动(?:祈愿|跃迁)/.test(title),weapon=/武器活动祈愿|光锥活动跃迁/.test(title);
      if(kind==='regular'&&!character&&!weapon)continue;
      // Chronicle pages contain both a visual overview and a probability table; only the latter is consumed.
      if(kind==='chronicle'&&!fields.has('5星角色'))continue;
      recognized++;let interval;try{interval=range(fields.get('时间')[0],meta.version,versions);}catch(error){warnings.push(error.message);continue;}if(!interval)continue;
      const pool=kind==='chronicle'?'500':game==='hk4e'?character?'301':'302':character?'11':'12';
      const observation=character&&kind==='regular'&&!interval.identityOnly?{...meta,...interval,pool,source,region:'cn',startBasis:'utc8',endBasis:'utc8',evidence:{url,title}}:null;if(observation)observations.push(observation);
      try{
        const character5=fields.has('5星角色')?itemIds(fields.get('5星角色'),items,5,'character'):[],weapon5=fields.has('5星武器')?itemIds(fields.get('5星武器'),items,5,'weapon'):[],lightcone5=fields.has('5星光锥')?itemIds(fields.get('5星光锥'),items,5,'lightcone'):[];
        const featured5=[...character5,...weapon5,...lightcone5];if(!featured5.length)throw Error('历史五星名单为空');
        const featured4=[...(fields.has('4星角色')?itemIds(fields.get('4星角色'),items,4,'character'):[]),...(fields.has('4星武器')?itemIds(fields.get('4星武器'),items,4,'weapon'):[]),...(fields.has('4星光锥')?itemIds(fields.get('4星光锥'),items,4,'lightcone'):[])];
        const ordinal=/(\d+)(-2)?期/.exec(title),second=!!ordinal?.[2],raw=game==='hk4e'&&character?second?'400':'301':pool;
        const rawTypes=game==='hk4e'&&character&&!typeProof&&ref().compareVersion(meta.version,'2.3')>=0?['301','400']:[raw];
        const distinctHeadings=new Set(headerTitles.map(title=>/「([^」]+)」/.exec(title)?.[1]).filter(Boolean)),bannerName=distinctHeadings.size>1?(character?'角色活动跃迁':'光锥活动跃迁'):/「([^」]+)」/.exec(title)?.[1]||plain(fields.get('卡池名称')?.[0]||title);
        let banner={id:game==='hk4e'&&ordinal?`${source}:${pool}:${Number(ordinal[1])}:${second?2:1}`:`${source}:${pool}:${meta.version}:${interval.start}:${featured5.join('-')}`,source,pool,rawTypes,gameIds:[],announcementId:null,names:{'zh-cn':bannerName},version:meta.version,phase:null,...interval,region:'cn',startBasis:'utc8',endBasis:'utc8',featured5,featured4,authority:'community',evidence:{source,url,title},phaseLabel:meta.label,rawTypeEvidence:game==='hk4e'&&character?{publishedSubtype:second?'-2':'first',verified:typeProof||ref().compareVersion(meta.version,'2.3')<0}:null};
        if(game==='hkrpg'){const entries=splitIdentities(banner,catalog);if(entries.some(item=>['21','22'].includes(item.pool))&&observation)observations.splice(observations.indexOf(observation),1);if(entries.some(item=>item.identityOnly&&!item.gameIds.length))throw Error('长期池的原始身份未能核验');banners.push(...entries);}else banners.push(banner);
      }catch(error){warnings.push(meta.version+' '+title+'：'+error.message);}
    }
    if(!recognized||!observations.length&&kind==='regular'||!banners.length)throw Error('国服历史表格未能识别');
    const unique=new Map();for(const banner of banners){if(unique.has(banner.id)&&JSON.stringify(unique.get(banner.id))!==JSON.stringify(banner))throw Error('历史池身份重复且内容不一致');unique.set(banner.id,banner);}
    return {banners:[...unique.values()],observations,warnings};
  }
  function phases(observations,versions,game){
    const result=[];for(const calendar of versions.filter(item=>item.region==='cn')){
      const rows=observations.filter(item=>item.version===calendar.version),labels=new Map();
      for(const row of rows){const key=/^(上半|下半|中半|中|额外|第\d+期)/.exec(row.label)?.[1]||row.start;if(!labels.has(key)||row.start<labels.get(key))labels.set(key,row.start);}
      const starts=[...new Set(labels.values())].sort();if(!starts.length)continue;
      if(!rows.some(item=>item.start===starts[0]&&/上半|上期/.test(item.label))&&starts[0]!==calendar.start)continue;
      for(let i=0;i<starts.length;i++){
        const same=rows.filter(item=>item.start===starts[i]),last=same.map(item=>item.end).filter(Boolean).sort().at(-1),end=starts[i+1]||(!calendar.ongoing?calendar.end:last);
        if(!end||starts[i]>=end)continue;
        result.push({id:`${same[0].source}:phase:${calendar.version}:${i+1}`,source:same[0].source,version:calendar.version,phase:i+1,phaseCount:starts.length,pools:game==='hk4e'?['301','302']:['11','12'],region:'cn',start:starts[i],end,startBasis:'utc8',endBasis:'utc8',precision:'minute',evidence:same[0].evidence});
      }
    }return result;
  }
  function subtypeProof(history,official,previous=false){
    const types=new Set();for(const announcement of official.filter(item=>item.pool==='301')){
      const match=history.banners.find(item=>item.version===announcement.version&&item.start===announcement.start&&item.featured5.join(',')===[...announcement.featured5].sort().join(','));if(!match)continue;
      const expected=match.rawTypeEvidence?.publishedSubtype==='-2'?'400':'301';if(!announcement.rawTypes.includes(expected))throw Error('历史池类型标注与国服公告冲突');types.add(expected);
    }return previous||types.has('301')&&types.has('400');
  }
  function profile(html,item,versions,catalog,{source,url}={}){
    const fields=new Map();for(const table of tables(html))for(const [key,value] of tableRows(table).fields)if(!fields.has(key))fields.set(key,value);
    const text=plain(html),start=text.indexOf('卡池信息'),section=start<0?'':text.slice(start,start+6000).split(/角色故事|光锥故事|背景故事|行迹/)[0],name=plain(fields.get('跃迁名')?.[0]||item.names['zh-cn']);
    const banners=[];for(const match of section.matchAll(/跃迁\s*-\s*(月之[一二三四五六七八]|\d+\.\d+)[\s\S]*?(\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s*[~～]\s*(?:长期|\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?))/g)){
      const version=lunar[match[1]]||match[1],interval=range(match[2],version,versions);if(!interval)continue;
      const pool=item.type==='character'?'21':'22',base={id:`${source}:${pool}:${interval.start}`,source,pool,rawTypes:[pool],gameIds:[],announcementId:null,names:{'zh-cn':name},version,phase:null,...interval,region:'cn',startBasis:'utc8',endBasis:'utc8',featured5:[item.id],featured4:[],authority:'community',evidence:{source,url,title:item.names['zh-cn']+' 国服卡池记录'},profileItemId:item.id};
      const linked=attachIds(base,catalog);if(linked.gameIds.length)banners.push(linked);
    }if(!banners.length)throw Error('联动卡池身份未能交叉核对');return banners;
  }
  globalThis.gachaReferenceHistory={plain,tables,tableRows,versionTag,publishedTime,range,itemIds,attachIds,splitIdentities,parse,phases,subtypeProof,profile};
})();
