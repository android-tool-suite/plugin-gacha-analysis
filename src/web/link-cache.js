(() => {
  const empty=()=>({formatVersion:1,links:{}});
  const copy=value=>JSON.parse(JSON.stringify(value));
  const key=(game,uid)=>game+':'+(uid||'latest');
  const valid=value=>value&&['hk4e','hkrpg'].includes(value.game)&&value.parameters&&typeof value.parameters.authkey==='string'&&value.parameters.authkey.length>0;
  function create(client){
    let data=null,pending=null,mutations=Promise.resolve();
    async function load(){
      if(data)return data;
      if(!pending)pending=(async()=>{
        const bytes=await client.readDataset('record-links',1048576);
        const value=bytes?JSON.parse(new TextDecoder().decode(bytes)):empty();
        if(value.formatVersion!==1||!value.links||typeof value.links!=='object'||Array.isArray(value.links))throw Error('抽卡链接缓存格式无效，可在数据管理中恢复或清理此项');
        data=value;return data;
      })().finally(()=>{pending=null;});
      return pending;
    }
    async function write(candidate){
      const bytes=new TextEncoder().encode(JSON.stringify(candidate));
      if(bytes.length>1048576)throw Error('抽卡链接缓存超过容量限制');
      await client.writeDataset('record-links',bytes);
      data=candidate;
    }
    function mutate(update){
      const operation=mutations.then(async()=>{const candidate=copy(await load());update(candidate);await write(candidate);});
      mutations=operation.catch(()=>{});return operation;
    }
    return {
      async get(game,uid){
        const root=await load(),latest=root.links[key(game,null)];
        const entry=root.links[key(game,uid)]||(!uid||latest?.uid==null?latest:null);
        return entry&&valid(entry.link)&&entry.link.game===game&&(!uid||entry.uid==null||entry.uid===String(uid))?copy(entry):null;
      },
      async save(link,uid=null){
        if(!valid(link))throw Error('无法缓存无效的抽卡链接');
        const entry={game:link.game,uid:uid==null?null:String(uid),capturedAt:Date.now(),link:copy(link)};
        await mutate(candidate=>{
          candidate.links[key(link.game,uid)]=entry;candidate.links[key(link.game,null)]=entry;
          const entries=Object.entries(candidate.links).sort((a,b)=>Number(b[1].capturedAt)-Number(a[1].capturedAt));
          candidate.links=Object.fromEntries(entries.slice(0,64));
        });
      },
      async remove(link){
        if(!valid(link))return;
        await mutate(candidate=>{
          for(const [id,entry]of Object.entries(candidate.links)){
            if(entry?.link?.game===link.game&&entry.link.parameters?.authkey===link.parameters.authkey)delete candidate.links[id];
          }
        });
      },
      reset(){data=null;pending=null;}
    };
  }
  const expired=error=>/authkey[^\n]*(timeout|expired|invalid|过期|失效)|(?:过期|失效)[^\n]*authkey/i.test(String(error?.message||''));
  globalThis.gachaLinkCache={create,expired};
})();
