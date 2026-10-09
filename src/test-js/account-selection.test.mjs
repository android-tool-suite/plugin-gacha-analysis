import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

test('the picker shows the visible game and switching games loads its real UID only after selection',async()=>{
  const elements=new Map(),reads=[],writes=[];
  let finishWrite;
  const node=()=>({dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},showModal(){},addEventListener(){},replaceChildren(){},querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null});
  const get=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const values={
    'gacha-settings':{preferences:{'selected-account':{value:'hkrpg:2'}}},
    'genshin-records':{accounts:[{uid:'1'}],records:[{uid:'1',id:'r1',gacha_type:'200',rank_type:'3',time:'2026-09-19 00:00:00'},{uid:'1',id:'r3',gacha_type:'200',rank_type:'3',time:'2026-09-19 00:01:00'}]},
    'starrail-records':{accounts:[{uid:'2'}],records:[{uid:'2',id:'r2',gacha_type:'1',rank_type:'3',time:'2026-09-19 00:00:00'}]},
  };
  const context=vm.createContext({MutationObserver:class{observe(){}disconnect(){}},TextEncoder,TextDecoder,Uint8Array,console,setTimeout,clearTimeout,document:{getElementById:get,createElement:node,querySelectorAll:()=>[]},
    createFeedback:()=>()=>{},createTabPager:()=>({root:node,syncTabs(){},refresh(){},initialize:()=>{}}),
    ats:{ready:new Promise(()=>{}),onEvent:()=>()=>{},readDataset:async id=>{reads.push(id);return new TextEncoder().encode(JSON.stringify(values[id]));},writeDataset:async(id,bytes)=>{writes.push({id,value:JSON.parse(new TextDecoder().decode(bytes))});await new Promise(resolve=>{finishWrite=resolve;});}},
  });context.window=context;
  for(const file of ['back-navigation','operation-reports','loading-feedback','model','presentation','initial-load','account-directory'])vm.runInContext(readFileSync(new URL(`../web/${file}.js`,import.meta.url),'utf8'),context);
  context.gachaAccountDirectory.load=async()=>({accounts:{hk4e:[{uid:'1'}],hkrpg:[{uid:'2'}]}});
  vm.runInContext(readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/\}\)\(\);\s*$/,'globalThis.testApp={state,load,selectAccount,showAccounts};})();'),context);
  await context.testApp.load();
  assert.deepEqual(reads,['gacha-settings','starrail-records']);
  context.testApp.showAccounts();
  assert.doesNotMatch(get('account-choices').innerHTML,/data-choose-account="hk4e:1"/);assert.match(get('account-choices').innerHTML,/data-choose-account="hkrpg:2"/);
  assert.equal((get('account-choices').innerHTML.match(/UID 2/g)||[]).length,1);
  assert.match(get('account-choices').innerHTML,/1 条记录/);assert.doesNotMatch(get('account-choices').innerHTML,/0 条记录/);
  assert.doesNotMatch(get('accounts').innerHTML,/加载/);
  assert.equal(context.testApp.state.datasets.hk4e.records.length,0);
  const previousSubtitle=get('subtitle').textContent,previousAccounts=get('accounts').innerHTML;
  const switching=context.testApp.selectAccount('hk4e:1');await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(typeof finishWrite,'function');
  assert.equal(get('subtitle').textContent,previousSubtitle,'record count must not lead the selected account while settings are saving');
  assert.equal(get('accounts').innerHTML,previousAccounts);
  finishWrite();await switching;
  assert.deepEqual(reads,['gacha-settings','starrail-records','genshin-records']);
  assert.equal(context.testApp.state.selected.uid,'1');assert.equal(context.testApp.state.snapshot.records.length,2);
  assert.match(get('accounts').innerHTML,/UID 1/);
  context.testApp.showAccounts();assert.match(get('account-choices').innerHTML,/data-choose-account="hk4e:1"/);assert.doesNotMatch(get('account-choices').innerHTML,/data-choose-account="hkrpg:2"/);
  assert.equal((get('account-choices').innerHTML.match(/UID 1/g)||[]).length,1);assert.match(get('account-choices').innerHTML,/2 条记录/);
  assert.equal(writes.at(-1).value.preferences['selected-account'].value,'hk4e:1');
});
