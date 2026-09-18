import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
const source=readFileSync(new URL('../web/runtime.js',import.meta.url),'utf8');
for(const native of [false,true])test(`Base64 ${native?'native':'fallback'} preserves every byte, chunk edges and empty input`,()=>{
  let nativeCalls=0;
  const context=vm.createContext({window:{atsTransport:{postMessage(){}}},document:{querySelector:selector=>({content:selector.includes('plugin-id')?'fixture':'session'})},TextEncoder,TextDecoder,atob,btoa,setTimeout,clearTimeout});
  const Bytes=vm.runInContext('Uint8Array',context);
  Bytes.fromBase64=native?(value=>{nativeCalls++;return new Bytes(Buffer.from(value,'base64'));}):undefined;
  vm.runInContext(source,context);
  for(const size of [0,1,2,3,256,131071,131072,131073]){
    const expected=Buffer.alloc(size);for(let i=0;i<size;i++)expected[i]=i%256;
    assert.deepEqual(Buffer.from(context.window.ats.fromBase64(expected.toString('base64'))),expected);
  }
  assert.equal(nativeCalls,native?8:0);
  if(!native)assert.throws(()=>context.window.ats.fromBase64('!invalid!'));
});
