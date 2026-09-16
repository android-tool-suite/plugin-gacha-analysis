(() => {
  const pluginId=document.querySelector('meta[name="ats-plugin-id"]')?.content,sessionId=document.querySelector('meta[name="ats-session-id"]')?.content,transport=window.atsTransport;let nextId=1,readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;}),pending=new Map();
  if(pluginId&&sessionId&&transport){transport.onmessage=event=>{let message;try{message=JSON.parse(event.data);}catch(_){return;}if(message.pluginId!==pluginId||message.sessionId!==sessionId)return;if(message.kind==='ready'){readyResolve(message.payload||{});return;}if(message.kind!=='response')return;const request=pending.get(message.requestId);if(!request)return;pending.delete(message.requestId);clearTimeout(request.timeout);message.ok?request.resolve(message.result||{}):request.reject(Object.assign(new Error(message.error?.message||'操作失败'),message.error||{}));};transport.postMessage(JSON.stringify({protocol:'2.0',kind:'hello',pluginId,sessionId,requestId:'0',payload:{supportedProtocols:['2.0'],features:[]}}));}
  async function call(method,payload={},deadlineMs=60000){await ready;const requestId=String(nextId++);return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error('操作超时'));},deadlineMs);pending.set(requestId,{resolve,reject,timeout});transport.postMessage(JSON.stringify({protocol:'2.0',kind:'request',pluginId,sessionId,requestId,method,payload,deadlineMs}));});}
  const fromBase64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));const toBase64=bytes=>{let result='';for(let offset=0;offset<bytes.length;offset+=0x8000)result+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));return btoa(result);};
  async function readHandle(opened,maxBytes,reader,closer){if(!opened.found)return null;const chunks=[];let offset=0;try{if(opened.size>maxBytes)throw new Error('数据超过大小限制');while(true){const part=await call(reader,{handle:opened.handle,offset,maxBytes:Math.min(131072,maxBytes-offset)}),bytes=fromBase64(part.bytes);chunks.push(bytes);offset+=bytes.length;if(part.eof)break;}}finally{await call(closer,{handle:opened.handle}).catch(()=>{});}const output=new Uint8Array(offset);let cursor=0;for(const chunk of chunks){output.set(chunk,cursor);cursor+=chunk.length;}return output;}
  async function readDataset(id,max=268435456){return readHandle(await call('storage.dataset.openRead',{datasetId:id}),max,'storage.dataset.read','storage.dataset.abort');}
  async function writeDataset(id,bytes){const opened=await call('storage.dataset.openWrite',{datasetId:id});try{for(let offset=0;offset<bytes.length;offset+=131072)await call('storage.dataset.write',{handle:opened.handle,bytes:toBase64(bytes.subarray(offset,offset+131072))});return await call('storage.dataset.commit',{handle:opened.handle});}catch(error){await call('storage.dataset.abort',{handle:opened.handle}).catch(()=>{});throw error;}}
  async function readBlob(id,max=33554432){return readHandle(await call('storage.blob.openRead',{id}),max,'storage.blob.read','storage.blob.close');}
  async function writeBlob(id,bytes){const opened=await call('storage.blob.openWrite',{id});try{for(let offset=0;offset<bytes.length;offset+=131072)await call('storage.blob.write',{handle:opened.handle,bytes:toBase64(bytes.subarray(offset,offset+131072))});return await call('storage.blob.close',{handle:opened.handle});}catch(error){await call('storage.blob.close',{handle:opened.handle}).catch(()=>{});throw error;}}
  async function request(url,{method='GET',headers={},body=null,deadlineMs=60000}={}) {
    const payload={url,method,headers};if(body)payload.bodyBase64=toBase64(body instanceof Uint8Array?body:new TextEncoder().encode(String(body)));
    const response=await call('network.request',payload,deadlineMs),blobId=response.bodyBlob?.id||response.blobId;
    try {
      const bytes=typeof response.body==='string'?fromBase64(response.body):blobId?await readBlob(blobId,8388608):new Uint8Array();
      if(!bytes)throw new Error('网络响应文件不存在');
      if(bytes.length>8388608)throw new Error('网络响应超过大小限制');
      return {...response,bytes,text:new TextDecoder().decode(bytes)};
    } finally { if(blobId)await call('storage.blob.delete',{id:blobId}).catch(()=>{}); }
  }
  window.ats={call,ready,readDataset,writeDataset,readBlob,writeBlob,request,fromBase64,toBase64};
})();
