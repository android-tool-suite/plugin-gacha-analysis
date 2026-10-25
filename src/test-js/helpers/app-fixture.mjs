import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

export function appFixture({failReads=new Set(),directoryErrors=[],secretError=false,withReference=false}={}) {
  const elements=new Map(),reads=[],writes=[],notices=[];
  const node=()=>({dataset:{},style:{},scrollLeft:0,classList:{add(){},remove(){},toggle(){}},
    setAttribute(){},addEventListener(){},append(){},prepend(){},showModal(){this.open=true;},close(){this.open=false;},insertAdjacentHTML(position,html){this.innerHTML=(this.innerHTML||'')+html;},replaceChildren(){this.innerHTML='';},
    querySelector:selector=>selector==='.pool-strip'?get('pool-strip'):null,querySelectorAll:()=>[],closest:()=>null});
  const get=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const values={
    'record-links':{formatVersion:1,links:{}},
    'gacha-settings':{preferences:{'selected-account':{value:'hkrpg:2'}}},
    'genshin-records':{accounts:[{uid:'1'}],records:[{uid:'1',id:'r1',gacha_type:'200',rank_type:'3',time:'2026-09-19 00:00:00'},{uid:'1',id:'r3',gacha_type:'200',rank_type:'3',time:'2026-09-19 00:01:00'}]},
    'starrail-records':{accounts:[{uid:'2'}],records:[{uid:'2',id:'r2',gacha_type:'1',rank_type:'3',time:'2026-09-19 00:00:00'}]},
  };
  const context=vm.createContext({MutationObserver:class{observe(){}disconnect(){}},TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,console,setTimeout,clearTimeout,queueMicrotask,
    document:{getElementById:get,createElement:node,querySelectorAll:()=>[]},
    createFeedback:()=>message=>notices.push(message),createTabPager:()=>({root:node,syncTabs(){},refresh(){},initialize(){},goTo(){}}),
    ats:{ready:new Promise(()=>{}),onEvent:()=>()=>{},
      readDataset:async id=>{reads.push(id);if(failReads.has(id))throw Error(`Cannot read ${id}`);if(id.endsWith('-reference')&&!Object.hasOwn(values,id))return null;return new TextEncoder().encode(JSON.stringify(values[id]||{}));},
      writeDataset:(id,bytes)=>new Promise((resolve,reject)=>writes.push({id,value:JSON.parse(new TextDecoder().decode(bytes)),resolve,reject})),
      call:async method=>{if(secretError&&method==='storage.secret.get')throw Error('Cannot read session');return {found:false};},
    },
  });context.window=context;
  for(const file of ['back-navigation','operation-reports','loading-feedback','model','uigf','presentation','version-calendar',...(withReference?['reference-history','reference-data','reference-bundle']:[]),'distribution','link-cache','views','initial-load','account-directory'])vm.runInContext(readFileSync(new URL(`../../web/${file}.js`,import.meta.url),'utf8'),context);
  context.gachaAccountDirectory.load=async()=>({accounts:{hk4e:[{uid:'1'}],hkrpg:[{uid:'2'}]},errors:directoryErrors});
  vm.runInContext(readFileSync(new URL('../../web/app.js',import.meta.url),'utf8').replace(/\}\)\(\);\s*$/,'globalThis.testApp={state,load,selectAccount,selectGame,queueWidgetEntry,applyWidgetEntry,drawPage,loadDataPage,openView,backView,showRecords,showRecord,openDistributionSummary,showDistributionRecords,showAccounts,showRecord,openAcquireView,cachePreparedLink,saveAnalysis,analysisDirty,deleteAccount,deleteSelectedAccounts,saveAccountNote,deleteGame,sync,importUigf,confirmImport,exportUigf,startMihoyoLogin,pollMihoyoLogin,cancelMihoyoLogin,loadMihoyoRoles,render,setBusy,requestMihoyoSource,updateReference,maybeUpdateReference,setReferenceAutoCheck,setRecordOverride,backNavigation};})();'),context);
  return {app:context.testApp,get,node,reads,writes,notices,failReads,context,values};
}
export const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
