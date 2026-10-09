import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
globalThis.window=globalThis;
(0,eval)(readFileSync(new URL('../web/link-cache.js',import.meta.url),'utf8'));
const link=(game,authkey)=>({game,parameters:{authkey,game_biz:game+'_cn'}});
function fixture(){
  let stored=null,fail=false;const writes=[];
  const client={readDataset:async()=>stored,writeDataset:async(id,bytes)=>{if(fail)throw Error('disk full');stored=new Uint8Array(bytes);writes.push(id);}};
  return {client,writes,setFail:value=>{fail=value;}};
}
test('protected link cache survives reopening and keeps accounts and games separate',async()=>{
  const f=fixture(),cache=gachaLinkCache.create(f.client);
  await cache.save(link('hk4e','fixture-genshin'), '1');await cache.save(link('hkrpg','fixture-star'), '2');
  const reopened=gachaLinkCache.create(f.client);
  assert.equal((await reopened.get('hk4e','1')).link.parameters.authkey,'fixture-genshin');
  assert.equal((await reopened.get('hkrpg','2')).link.parameters.authkey,'fixture-star');
  assert.equal(await reopened.get('hk4e','2'),null);
  assert.deepEqual(f.writes,['record-links','record-links']);
});
test('failed persistence preserves the previous link and removing an old link cannot erase a newer one',async()=>{
  const f=fixture(),cache=gachaLinkCache.create(f.client),old=link('hk4e','fixture-old');
  await cache.save(old,'1');f.setFail(true);await assert.rejects(cache.save(link('hk4e','fixture-new'),'1'));
  assert.equal((await cache.get('hk4e','1')).link.parameters.authkey,'fixture-old');
  f.setFail(false);await cache.save(link('hk4e','fixture-new'),'1');await cache.remove(old);
  assert.equal((await cache.get('hk4e','1')).link.parameters.authkey,'fixture-new');
});
test('only explicit authorization-key expiry clears cached data, transient failures do not',()=>{
  assert.equal(gachaLinkCache.expired(Error('authkey timeout')),true);
  assert.equal(gachaLinkCache.expired(Error('AuthKey 已失效')),true);
  assert.equal(gachaLinkCache.expired(Error('Network timeout')),false);
});

test('concurrent game cache writes retain both accounts after reopening',async()=>{
  const f=fixture(),cache=gachaLinkCache.create(f.client);
  await Promise.all([cache.save(link('hk4e','fixture-genshin'),'1'),cache.save(link('hkrpg','fixture-star'),'2')]);
  const reopened=gachaLinkCache.create(f.client);
  assert.equal((await reopened.get('hk4e','1')).link.parameters.authkey,'fixture-genshin');
  assert.equal((await reopened.get('hkrpg','2')).link.parameters.authkey,'fixture-star');
});

test('a prepared link with an unconfirmed UID can be recovered but another known account link is never substituted',async()=>{
  const f=fixture(),cache=gachaLinkCache.create(f.client);
  await cache.save(link('hk4e','fixture-unconfirmed'));
  assert.equal((await gachaLinkCache.create(f.client).get('hk4e','1')).uid,null);
  await cache.save(link('hk4e','fixture-known'),'2');
  assert.equal(await gachaLinkCache.create(f.client).get('hk4e','1'),null);
});
