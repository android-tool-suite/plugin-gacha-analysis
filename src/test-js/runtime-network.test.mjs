import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../web/runtime.js',import.meta.url),'utf8');
async function scenario(failure=false){
  const calls=[],bytes=Buffer.alloc(300000,65),transport={};
  const context=vm.createContext({window:{atsTransport:transport},document:{querySelector:selector=>({content:selector.includes('plugin-id')?'fixture':'session'})},TextEncoder,TextDecoder,Uint8Array,atob,btoa,setTimeout,clearTimeout});
  transport.postMessage=raw=>{
    const message=JSON.parse(raw);queueMicrotask(()=>{
      if(message.kind==='hello'){transport.onmessage({data:JSON.stringify({pluginId:'fixture',sessionId:'session',kind:'ready',payload:{}})});return;}
      calls.push([message.method,message.payload]);let result={};
      if(message.method==='network.request')result={status:200,body:null,bodyBlob:{id:'network.fixture',size:bytes.length}};
      if(message.method==='storage.blob.openRead')result={found:true,handle:'reader',size:bytes.length};
      if(message.method==='storage.blob.read')result={bytes:bytes.subarray(message.payload.offset,message.payload.offset+131072).toString('base64'),eof:message.payload.offset+131072>=bytes.length};
      const failed=failure&&message.method==='storage.blob.read';
      transport.onmessage({data:JSON.stringify({pluginId:'fixture',sessionId:'session',kind:'response',requestId:message.requestId,ok:!failed,result,error:failed?{message:'fixture read failed'}:undefined})});
    });
  };
  vm.runInContext(source,context);await context.window.ats.ready;
  if(failure)await assert.rejects(context.window.ats.request('https://example.test/large'),/fixture read failed/);
  else{const result=await context.window.ats.request('https://example.test/large');assert.equal(result.bytes.length,bytes.length);assert.deepEqual(Buffer.from(result.bytes),bytes);}
  assert.ok(calls.some(([method,payload])=>method==='storage.blob.close'&&payload.handle==='reader'));
  assert.ok(calls.some(([method,payload])=>method==='storage.blob.delete'&&payload.id==='network.fixture'));
}
await scenario();await scenario(true);
console.log('Host bodyBlob response: multi-chunk read and cleanup on success/failure OK');
