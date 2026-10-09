import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import {appFixture,tick} from './helpers/app-fixture.mjs';

const reporterSource=readFileSync(new URL('../web/operation-reports.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function reporter(client){const context=vm.createContext({console});vm.runInContext(reporterSource,context);return context.createOperationReporter(client);}
function observeReports(fixture,handler){
  const reports=[],call=fixture.context.ats.call;
  fixture.context.ats.call=async(method,payload)=>{
    if(method==='app.reportOperation'){reports.push(plain(payload));return handler?handler(payload):{taskId:'host-'+payload.id,status:payload.status};}
    return call(method,payload);
  };
  return reports;
}

test('each operation keeps a unique stable identity and its end cannot overtake its start',async()=>{
  const reports=[],acks=new Map();
  const client={call(method,payload){assert.equal(method,'app.reportOperation');reports.push(plain(payload));if(payload.status==='running'){const ack=deferred();acks.set(payload.id,ack);return ack.promise;}return {taskId:'host-'+payload.id,status:payload.status};}};
  const controller=reporter(client),first=controller.start('获取新抽卡记录'),second=controller.start('导出 UIGF 记录');
  const endFirst=first.success('新增 3 条'),endSecond=second.cancel();
  assert.notEqual(first.id,second.id);assert.ok(first.id.length<=96);assert.deepEqual(reports.map(r=>r.status),['running','running']);
  acks.get(second.id).resolve({taskId:'host-'+second.id,status:'running'});await endSecond;
  assert.deepEqual(reports.map(r=>r.id),[first.id,second.id,second.id]);
  acks.get(first.id).resolve({taskId:'host-'+first.id,status:'running'});await endFirst;
  await first.fail();assert.equal(reports.length,4,'a terminal operation cannot be overwritten');
  for(const id of [first.id,second.id]){const messages=reports.filter(r=>r.id===id);assert.equal(new Set(messages.map(r=>r.label)).size,1);}
});

test('the shipped runtime sends the real app capability method and validates host acknowledgements',async()=>{
  const requests=[],transport={postMessage(raw){const message=JSON.parse(raw);if(message.kind==='request'){
    requests.push(message);
    assert.equal(message.method,'app.reportOperation');
    assert.deepEqual(Object.keys(message.payload).sort(),message.payload.status==='running'?['id','label','status']:['detail','id','label','status']);
    queueMicrotask(()=>transport.onmessage({data:JSON.stringify({kind:'response',pluginId:'gacha_analysis',sessionId:'fixture-session',requestId:message.requestId,ok:true,result:{taskId:'host-'+message.payload.id,status:message.payload.status}})}));
  }}};
  const context=vm.createContext({window:{atsTransport:transport},document:{querySelector:selector=>({content:selector.includes('plugin-id')?'gacha_analysis':'fixture-session'})},TextEncoder,TextDecoder,Uint8Array,atob,btoa,setTimeout,clearTimeout,queueMicrotask});
  vm.runInContext(readFileSync(new URL('../web/runtime.js',import.meta.url),'utf8'),context);vm.runInContext(reporterSource,context);
  transport.onmessage({data:JSON.stringify({kind:'ready',pluginId:'gacha_analysis',sessionId:'fixture-session',payload:{}})});
  const operation=context.createOperationReporter(context.window.ats).start('保存统计设置');
  assert.equal(await operation.started,true);assert.equal(await operation.success('统计设置已保存'),true);
  assert.deepEqual(requests.map(r=>r.payload.status),['running','success']);assert.ok(requests.every(r=>r.pluginId==='gacha_analysis'&&r.sessionId==='fixture-session'));
  const invalid=reporter({call:()=>({found:false})}).start('保存统计设置');assert.equal(await invalid.started,false,'missing host support must not be mistaken for a successful report');
});

test('first reads, account selection and browsing never create operations',async()=>{
  const f=appFixture(),reports=observeReports(f);await f.app.load();f.app.openView('pool','1');f.app.backView();f.app.showRecords('all',3,'2026-09');
  const switching=f.app.selectAccount('hk4e:1');await tick();f.writes[0].resolve();await switching;await tick();
  assert.deepEqual(reports,[]);
});

test('a slow or failed report never delays or rolls back the actual settings save',async()=>{
  const f=appFixture(),start=deferred(),reports=observeReports(f,payload=>payload.status==='running'?start.promise:Promise.reject(Error('report unavailable')));
  await f.app.load();f.app.openView('analysis');f.app.state.analysisDraft={sources:[],losses:[]};
  const save=f.app.saveAnalysis();await tick();assert.equal(f.writes.length,1,'business save must start while reporting is unresolved');
  assert.deepEqual(reports.map(r=>r.status),['running']);f.writes[0].resolve();await save;
  assert.deepEqual(plain(f.app.state.settings.preferences['banner-history-sources:hkrpg:2'].value),[]);
  assert.equal(f.app.state.busy,false);assert.equal(reports.length,1);
  start.reject(Error('report timeout'));await tick();assert.deepEqual(reports.map(r=>r.status),['running','success']);
  assert.ok(f.notices.includes('已保存此账号的统计设置'));assert.ok(!f.notices.includes('report timeout'));
});

test('actual save failure reports only the fixed non-sensitive failure message',async()=>{
  const f=appFixture(),reports=observeReports(f);await f.app.load();f.app.openView('analysis');f.app.state.analysisDraft={sources:[],losses:[]};
  const before=JSON.stringify(f.app.state.settings),save=f.app.saveAnalysis();await tick();
  f.writes[0].reject(Error('secret https://fixture.test/?authkey=private-value uid=900000001'));await save;await tick();
  assert.equal(JSON.stringify(f.app.state.settings),before);assert.deepEqual(reports.map(r=>r.status),['running','failed']);
  assert.equal(reports[1].detail,'未完成，请返回插件查看详情');
  assert.doesNotMatch(JSON.stringify(reports),/private-value|900000001|https:|authkey/);
});

for(const outcome of ['saved','cancelled','failed'])test(`UIGF export reports ${outcome} only after the real file result`,async()=>{
  const f=appFixture(),reports=observeReports(f),file=deferred();await f.app.load();await f.app.loadDataPage();
  f.app.state.exportKeys=['hkrpg:2'];f.app.state.transferStage='review';f.context.ats.writeBlob=async()=>{};
  const call=f.context.ats.call;f.context.ats.call=(method,payload)=>method==='file.export.save'?file.promise:call(method,payload);
  const exporting=f.app.exportUigf();await tick();assert.deepEqual(reports.map(r=>r.status),['running']);
  if(outcome==='saved')file.resolve({saved:true});else file.reject(Object.assign(Error('private file contents'),{code:outcome==='cancelled'?'CANCELLED':'INTERNAL'}));
  await exporting;await tick();assert.equal(reports.at(-1).status,outcome==='saved'?'success':outcome==='cancelled'?'cancelled':'failed');
  assert.doesNotMatch(JSON.stringify(reports),/private file contents/);
  if(outcome==='saved')assert.equal(f.app.state.transferStage,'result');else assert.equal(f.app.state.transferStage,'review');
});

test('UIGF file preview and the later confirmed write are distinct real operations',async()=>{
  const f=appFixture(),reports=observeReports(f);await f.app.load();
  const bundles=[{account:{game:'hk4e',uid:'900000001'},records:[{uid:'900000001',id:'9',name:'fixture private item',gacha_type:'301',rank_type:'5',time:'2026-09-20 00:00:00'}],completedPoolTypes:[]}];
  const bytes=new TextEncoder().encode(f.context.uigf.encode(bundles,'fixture'));
  f.context.ats.readBlob=async()=>bytes;const call=f.context.ats.call;f.context.ats.call=(method,payload)=>method==='file.import.pick'?Promise.resolve({files:[{blobId:'fixture-private-file'}]}):call(method,payload);
  await f.app.importUigf();await tick();assert.equal(f.writes.length,0);assert.deepEqual(reports.map(r=>r.status),['running','success']);assert.equal(reports[1].detail,'文件已读取，请核对导入范围');
  const importing=f.app.confirmImport();await tick();assert.equal(reports.at(-1).status,'running');assert.equal(f.writes.length,1);
  f.writes[0].resolve();await importing;await tick();assert.equal(reports.at(-1).status,'success');assert.match(reports.at(-1).detail,/新增 1 条/);
  assert.notEqual(reports[0].id,reports[2].id);assert.doesNotMatch(JSON.stringify(reports),/900000001|fixture private item|fixture-private-file/);
});

test('fetching records stays running until the merged Dataset commit succeeds',async()=>{
  const f=appFixture(),reports=observeReports(f);await f.app.load();
  f.app.state.link={game:'hkrpg',parameters:{authkey:'fixture-private-authkey'}};
  f.context.gachaNetwork={fetch:async()=>({account:{game:'hkrpg',uid:'2'},records:[{uid:'2',id:'new',gacha_type:'11',rank_type:'5',name:'fixture-private-name',time:'2026-09-20 00:00:00'}],completedPoolTypes:[],scannedRecords:7})};
  const sync=f.app.sync();await tick();assert.equal(f.writes.length,1);assert.deepEqual(reports.map(r=>r.status),['running']);
  f.writes[0].resolve();await tick();
  assert.equal(f.writes[1].id,'record-links');assert.deepEqual(reports.map(r=>r.status),['running']);
  f.writes[1].resolve();await sync;await tick();assert.deepEqual(reports.map(r=>r.status),['running','success']);assert.equal(reports[1].detail,'新增 1 条，检查 7 条');
  assert.doesNotMatch(JSON.stringify(reports),/fixture-private|authkey/);
});

test('partial UIGF commit never reports the whole import as successful',async()=>{
  const f=appFixture(),reports=observeReports(f);await f.app.load();
  const bundles=['hk4e','hkrpg'].map((game,index)=>({account:{game,uid:String(900000010+index)},records:[{uid:String(900000010+index),id:'9',name:'fixture',gacha_type:index?'11':'301',rank_type:'5',time:'2026-09-20 00:00:00'}],completedPoolTypes:[]}));
  f.context.ats.readBlob=async()=>new TextEncoder().encode(f.context.uigf.encode(bundles,'fixture'));
  const call=f.context.ats.call;f.context.ats.call=(method,payload)=>method==='file.import.pick'?Promise.resolve({files:[{blobId:'fixture'}]}):call(method,payload);
  await f.app.importUigf();await tick();const importing=f.app.confirmImport();await tick();
  const operationId=reports.at(-1).id;f.writes[0].resolve();await tick();assert.equal(f.writes.length,2);
  assert.equal(reports.filter(r=>r.id===operationId).length,1);
  f.writes[1].reject(Error('private second-game payload'));await importing;await tick();
  assert.deepEqual(reports.filter(r=>r.id===operationId).map(r=>r.status),['running','failed']);
  assert.ok(f.app.state.datasets.hk4e.accounts.some(account=>account.uid==='900000010'));
  assert.ok(!f.app.state.datasets.hkrpg.accounts.some(account=>account.uid==='900000011'));
  assert.equal(reports.at(-1).detail,'未完成，请返回插件查看详情');
});

test('QR login reports cancellation while automatic role reads do not create tasks',async()=>{
  const f=appFixture(),reports=observeReports(f);await f.app.load();f.context.setTimeout=()=>0;
  f.context.mihoyo={createQrSession:async()=>({loginUrl:'https://fixture.test/private-qr'}),loadRoles:async()=>({cookie:'fixture-private-cookie',roles:[]})};
  await f.app.startMihoyoLogin();await tick();assert.deepEqual(reports.map(r=>r.status),['running']);
  f.app.cancelMihoyoLogin();await tick();assert.deepEqual(reports.map(r=>r.status),['running','cancelled']);
  const reading=f.app.loadMihoyoRoles('fixture-private-cookie');await tick();f.writes[0].resolve();await reading;await tick();
  assert.equal(reports.length,2);assert.doesNotMatch(JSON.stringify(reports),/private-qr|private-cookie|https:/);
});
