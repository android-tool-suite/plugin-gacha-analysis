import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
const source=readFileSync(new URL('../web/runtime.js',import.meta.url),'utf8');
async function scenario(mode='ok',size=400001,kind='dataset'){
  const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=i%251;
  const transport={},calls=[];let pending=0,maxPending=0,closed=false;
  const context=vm.createContext({window:{atsTransport:transport},document:{querySelector:selector=>({content:selector.includes('plugin-id')?'fixture':'session'})},TextEncoder,TextDecoder,Uint8Array,atob,btoa,setTimeout,clearTimeout});
  transport.postMessage=raw=>{
    const message=JSON.parse(raw),{method,payload={}}=message;
    if(message.kind==='hello'){queueMicrotask(()=>transport.onmessage({data:JSON.stringify({pluginId:'fixture',sessionId:'session',kind:'ready',payload:{}})}));return;}
    calls.push(method);let result={},failed=false,delay=0;
    if(method.endsWith('openRead'))result={found:true,handle:'reader',size};
    if(method.endsWith('.read')){
      pending++;maxPending=Math.max(maxPending,pending);delay=payload.offset===0?20:1;
      result={offset:payload.offset,bytes:bytes.subarray(payload.offset,payload.offset+payload.maxBytes).toString('base64'),eof:payload.offset+payload.maxBytes===size};
      if(payload.offset===0){if(mode==='failure')failed=true;if(mode==='short')result.bytes='';if(mode==='offset')result.offset++;if(mode==='eof')result.eof=true;}
    }
    if(method.endsWith('.abort')||method.endsWith('.close')){assert.equal(pending,0,'outstanding reads must finish before close');closed=true;}
    setTimeout(()=>{if(method.endsWith('.read'))pending--;transport.onmessage({data:JSON.stringify({pluginId:'fixture',sessionId:'session',kind:'response',requestId:message.requestId,ok:!failed,result,error:failed?{message:'read failed'}:undefined})});},delay);
  };
  vm.runInContext(source,context);await context.window.ats.ready;
  const operation=kind==='dataset'?context.window.ats.readDataset('fixture',mode==='limit'?size-1:size):context.window.ats.readBlob('fixture',size);
  if(mode==='ok')assert.deepEqual(Buffer.from(await operation),bytes);else await assert.rejects(operation);
  assert.equal(closed,true);assert.ok(maxPending<=2);if(size>131072&&mode!=='limit')assert.equal(maxPending,2);
  if(mode==='limit')assert.ok(!calls.some(method=>method.endsWith('.read')));
}
test('out-of-order responses reassemble exact Dataset and Blob bytes with at most two reads',async()=>{await scenario();await scenario('ok',400001,'blob');await scenario('ok',0);});
test('read errors, malformed chunks and size violations preserve validation and drain handles',async()=>{for(const mode of ['failure','short','offset','eof','limit'])await scenario(mode);});
