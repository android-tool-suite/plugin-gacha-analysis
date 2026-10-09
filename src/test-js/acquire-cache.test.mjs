import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appFixture,tick} from './helpers/app-fixture.mjs';

const fixtureLink={game:'hkrpg',parameters:{authkey:'fixture-only-key',game_biz:'hkrpg_cn'}};
test('the acquire button loads only the current account cache without requesting game records',async()=>{
  const f=appFixture();await f.app.load();
  f.values['record-links'].links['hkrpg:2']={uid:'2',link:fixtureLink};
  await f.get('open-acquire').onclick({type:'click'});
  assert.equal(f.app.state.view.kind,'acquire');assert.equal(f.app.state.link.parameters.authkey,'fixture-only-key');
  assert.deepEqual(f.reads,['gacha-settings','starrail-records','record-links']);assert.equal(f.writes.length,0);
});
test('a cache write failure is visible and preserves the prepared link for this session',async()=>{
  const f=appFixture();await f.app.load();await f.app.openAcquireView();f.app.state.link=fixtureLink;
  const saving=f.app.cachePreparedLink('2');await tick();f.writes.at(-1).reject(Error('disk full'));await saving;
  assert.equal(f.app.state.link,fixtureLink);assert.equal(f.app.state.cachedLink,false);
  assert.match(f.get('link-status').textContent,/未能保存到本机/);
});

test('switching games opens that game link while retaining the other prepared link',async()=>{
  const f=appFixture();await f.app.load();
  const genshin={game:'hk4e',parameters:{authkey:'fixture-genshin',game_biz:'hk4e_cn'}};
  f.values['record-links'].links={'hkrpg:2':{uid:'2',link:fixtureLink},'hk4e:1':{uid:'1',link:genshin}};
  await f.app.openAcquireView();assert.equal(f.app.state.link.game,'hkrpg');f.app.backView();
  let switching=f.app.selectGame('hk4e');await tick();f.writes.at(-1).resolve();await switching;
  await f.app.openAcquireView();assert.equal(f.app.state.link.game,'hk4e');assert.equal(f.app.state.link.parameters.authkey,'fixture-genshin');f.app.backView();
  switching=f.app.selectGame('hkrpg');await tick();f.writes.at(-1).resolve();await switching;
  await f.app.openAcquireView();assert.equal(f.app.state.link.parameters.authkey,'fixture-only-key');
});
