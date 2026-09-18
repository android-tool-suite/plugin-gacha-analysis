// Extract the small top-level account array without parsing or retaining records.
(() => {
  function normalize(value){
    if(!Array.isArray(value))throw Error('账号列表格式无效');
    return value.map(account=>{
      if(!account||!['string','number'].includes(typeof account.uid)||!String(account.uid).trim())throw Error('账号 UID 无效');
      return {uid:String(account.uid)};
    });
  }
  function createReader(){
    let depth=0,inString=false,escaped=false,rootString=false,token='',lastString='',awaiting=false,capturing=false,done=false;
    const captured=[];
    return {
      get done(){return done;},
      accept(bytes){for(const byte of bytes){
        if(done)return;
        const char=String.fromCharCode(byte);
        if(capturing){captured.push(byte);if(captured.length>262144)throw Error('账号列表超过读取限制');}
        if(inString){
          if(rootString&&token.length<129)token+=char;
          if(escaped)escaped=false;
          else if(char==='\\')escaped=true;
          else if(char==='"'){inString=false;if(rootString){try{lastString=JSON.parse(token);}catch{lastString='';}}}
          continue;
        }
        if(char==='"'){inString=true;rootString=depth===1;token='"';continue;}
        if(depth===1&&char===':'&&lastString==='accounts'){awaiting=true;lastString='';continue;}
        if(awaiting){
          if(/\s/.test(char))continue;
          awaiting=false;
          if(char==='['){capturing=true;captured.push(byte);}
          else if(char!=='n')throw Error('账号列表格式无效');
        }
        if(char==='{'||char==='[')depth++;
        else if(char==='}'||char===']'){depth--;if(capturing&&depth===1){done=true;return;}}
        if(depth===1&&char===',')lastString='';
      }},
      finish(){if(capturing&&!done)throw Error('账号列表不完整');return done?normalize(JSON.parse(new TextDecoder().decode(new Uint8Array(captured)))):[];},
    };
  }
  async function readGame(ats,game){
    const datasetId=game==='hk4e'?'genshin-records':'starrail-records';
    const opened=await ats.call('storage.dataset.openRead',{datasetId});
    if(!opened.found)return {accounts:[]};
    const key='account-directory:'+datasetId;let cacheError;
    try{
      if(!Number.isSafeInteger(opened.size)||opened.size<0||opened.size>268435456)throw Error('记录文件长度无效');
      if(!/^[a-f0-9]{64}$/i.test(opened.sha256||''))throw Error('记录文件摘要无效');
      try{
        const cached=await ats.call('storage.kv.get',{key}),value=cached.value;
        if(cached.found&&value?.version===1&&value.sha256===opened.sha256&&value.size===opened.size)return {accounts:normalize(value.accounts)};
      }catch(error){cacheError=error.message;}
      const reader=createReader();let offset=0;
      while(offset<opened.size&&!reader.done){
        const length=Math.min(offset===0?4096:131072,opened.size-offset);
        const part=await ats.call('storage.dataset.read',{handle:opened.handle,offset,maxBytes:length});
        const bytes=ats.fromBase64(part.bytes);
        if(bytes.length!==length||(part.offset!=null&&part.offset!==offset)||part.eof!==(offset+length===opened.size))throw Error('账号列表分块无效');
        reader.accept(bytes);offset+=bytes.length;
      }
      const accounts=reader.finish();
      try{await ats.call('storage.kv.set',{key,value:{version:1,sha256:opened.sha256,size:opened.size,accounts}});cacheError=null;}
      catch(error){cacheError=error.message;}
      return {accounts,cacheError};
    }finally{await ats.call('storage.dataset.abort',{handle:opened.handle}).catch(()=>{});}
  }
  async function load(ats){
    const games=['hk4e','hkrpg'],results=await Promise.allSettled(games.map(game=>readGame(ats,game)));
    const accounts={},errors=[];let cacheError;
    results.forEach((result,index)=>{if(result.status==='fulfilled'){accounts[games[index]]=result.value.accounts;cacheError=cacheError||result.value.cacheError;}else{accounts[games[index]]=[];errors.push(games[index]);}});
    return {accounts,errors,cacheError};
  }
  function accounts(datasets,directory,isLoaded){return ['hk4e','hkrpg'].flatMap(game=>(isLoaded(game)?datasets[game].accounts:directory[game]||[]).map(account=>({...account,uid:String(account.uid),game})));}
  globalThis.gachaAccountDirectory={createReader,load,accounts};
})();
