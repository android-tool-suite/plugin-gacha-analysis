import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const source=readFileSync(new URL('../web/back-navigation.js',import.meta.url),'utf8');
function fixture(){
  const dialogs=[],calls=[],handlers=new Map();let nested=false,returned=0,mutation;
  const document={body:{},querySelectorAll:selector=>selector==='dialog[open]'?dialogs.filter(dialog=>dialog.open):dialogs};
  const client={ready:Promise.resolve(),call:async(method,payload)=>calls.push({method,...payload}),onEvent:(name,handler)=>{handlers.set(name,handler);return()=>handlers.delete(name);}};
  const context=vm.createContext({Event,MutationObserver:class{constructor(callback){mutation=callback;}observe(){}disconnect(){}},document});
  vm.runInContext(source,context);
  const controller=context.createPluginBackNavigation({client,document,canBack:()=>nested,back:()=>{returned++;nested=false;}});
  function dialog(){const target=new EventTarget();target.open=false;target.close=()=>{target.open=false;target.dispatchEvent(new Event('close'));};dialogs.push(target);return target;}
  return {controller,dialog,calls,handlers,setNested:value=>{nested=value;controller.sync();},returned:()=>returned,mutate:()=>mutation()};
}
test('native back returns one local layer at a time and releases the root to the host',async()=>{
  const f=fixture();await tick();assert.deepEqual(f.calls.map(call=>call.enabled),[false]);
  f.setNested(true);await tick();const account=f.dialog(),confirm=f.dialog();account.open=true;f.mutate();confirm.open=true;f.mutate();await tick();
  f.handlers.get('app.backRequested')();assert.equal(confirm.open,false);assert.equal(account.open,true);assert.equal(f.returned(),0);
  f.handlers.get('app.backRequested')();assert.equal(account.open,false);assert.equal(f.returned(),0);
  f.handlers.get('app.backRequested')();await tick();assert.equal(f.returned(),1);assert.equal(f.calls.at(-1).enabled,false);
  f.handlers.get('app.backRequested')();assert.equal(f.returned(),1,'root back belongs to the host');
  assert.ok(f.calls.every(call=>call.method==='app.setBackNavigation'));
});
test('a modal cancel guard remains authoritative and repeated renders do not duplicate bridge state',async()=>{
  const f=fixture(),dialog=f.dialog();dialog.open=true;dialog.addEventListener('cancel',event=>event.preventDefault());f.mutate();await tick();
  const count=f.calls.length;f.controller.sync();f.controller.sync();await tick();assert.equal(f.calls.length,count);
  f.handlers.get('app.backRequested')();assert.equal(dialog.open,true);assert.equal(f.returned(),0);
  f.controller.dispose();assert.equal(f.handlers.size,0);
});
test('runtime dispatches fresh matching-session back events once and supports unsubscribe',async()=>{
  const transport={postMessage(){}},context=vm.createContext({window:{atsTransport:transport},document:{querySelector:selector=>({content:selector.includes('plugin-id')?'fixture':'session'})},TextEncoder,TextDecoder,Uint8Array,atob,btoa,setTimeout,clearTimeout});
  vm.runInContext(readFileSync(new URL('../web/runtime.js',import.meta.url),'utf8'),context);
  let count=0;const stop=context.window.ats.onEvent('app.backRequested',()=>count++);
  const emit=(sequence,sessionId='session')=>transport.onmessage({data:JSON.stringify({kind:'event',pluginId:'fixture',sessionId,event:'app.backRequested',sequence,payload:{}})});
  emit(1,'another');emit(1);emit(1);emit(0);emit(2);assert.equal(count,2);stop();emit(3);assert.equal(count,2);
});
