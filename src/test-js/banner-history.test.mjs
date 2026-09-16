import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
for (const file of ['banner-history.js', 'model.js']) {
  (0, eval)(readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8'));
}

assert.equal(gachaBannerHistory.count, 471);
assert.equal(gachaBannerHistory.featured({
  item_id: '10000022', gacha_id: '', time: '2020-09-30 12:00:00'
}, 'hk4e', '301', 8, ['paimon-moe']), true);
assert.equal(gachaBannerHistory.featured({
  item_id: '10000029', gacha_id: '', time: '2020-09-30 12:00:00'
}, 'hk4e', '301', 8, ['paimon-moe']), false);
assert.equal(gachaBannerHistory.featured({
  item_id: '1014', gacha_id: '5001', time: '2026-01-01 00:00:00'
}, 'hkrpg', '21', 8, ['star-rail-station']), true);

const result = gachaModel.snapshot('hk4e', [{
  uid: '1', id: '1', gacha_type: '301', uigf_gacha_type: '301', item_id: '10000022',
  name: '温迪', item_type: '角色', rank_type: '5', time: '2020-09-30 12:00:00', is_up: ''
}], [], ['paimon-moe'], 8);
assert.equal(result.stats[0].upCount, 1);
assert.equal(result.stats[0].lossCount, 0);

console.log('Locked banner history and source selection fixtures: OK');
