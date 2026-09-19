import {readFileSync} from 'node:fs';
import vm from 'node:vm';

export function appFixture({failReads=new Set(),directoryErrors=[],secretError=false}={}) {
  const elements=new Map(),reads=[],writes=[],notices=[];
  const node=()=>({dataset:{},style:{},scrollLeft:0,classList:{add(){},remove(){},toggle(){}},
    setAttribute(){},addEventListener(){},append(){},prepend(){},replaceChildren(){this.innerHTML='';},
    querySelector:selector=>selector==='.pool-strip'?get('pool-strip'):null,querySelectorAll:()=>[],closest:()=>null});
  const get=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const values={
    'gacha-settings':{preferences:{'selected-account':{value:'hkrpg:2'}}},
    'genshin-records':{accounts:[{uid:'1'}],records:[{uid:'1',id:'r1',gacha_type:'200',rank_type:'3',time:'2026-09-19 00:00:00'},{uid:'1',id:'r3',gacha_type:'200',rank_type:'3',time:'2026-09-19 00:01:00'}]},
    'starrail-records':{accounts:[{uid:'2'}],records:[{uid:'2',id:'r2',gacha_type:'1',rank_type:'3',time:'2026-09-19 00:00:00'}]},
  };
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,console,setTimeout,clearTimeout,queueMicrotask,
    document:{getElementById:get,createElement:node,querySelectorAll:()=>[]},
    createFeedback:()=>message=>notices.push(message),createTabPager:()=>({root:node,syncTabs(){},refresh(){},initialize(){}}),
    ats:{ready:new Promise(()=>{}),
      readDataset:async id=>{reads.push(id);if(failReads.has(id))throw Error(`Cannot read ${id}`);return new TextEncoder().encode(JSON.stringify(values[id]||{}));},
      writeDataset:(id,bytes)=>new Promise((resolve,reject)=>writes.push({id,value:JSON.parse(new TextDecoder().decode(bytes)),resolve,reject})),
      call:async method=>{if(secretError&&method==='storage.secret.get')throw Error('Cannot read session');return {found:false};},
    },
  });context.window=context;
  for(const file of ['loading-feedback','model','presentation','initial-load','account-directory'])vm.runInContext(readFileSync(new URL(`../../web/${file}.js`,import.meta.url),'utf8'),context);
  context.gachaAccountDirectory.load=async()=>({accounts:{hk4e:[{uid:'1'}],hkrpg:[{uid:'2'}]},errors:directoryErrors});
  vm.runInContext(readFileSync(new URL('../../web/app.js',import.meta.url),'utf8').replace(/\}\)\(\);\s*$/,'globalThis.testApp={state,load,selectAccount,drawPage,loadDataPage};})();'),context);
  return {app:context.testApp,get,node,reads,writes,notices,failReads};
}
export const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
