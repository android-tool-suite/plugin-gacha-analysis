import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
(0, eval)(readFileSync(new URL('../web/model.js', import.meta.url), 'utf8'));

const urls = [];
globalThis.ats = {
  request: async raw => {
    const url = new URL(raw);
    urls.push(url);
    const type = url.searchParams.get('gacha_type');
    const page = Number(url.searchParams.get('page'));
    let list = [];
    if (type === '301' && page === 1) {
      list = Array.from({ length: 20 }, (_, index) => ({
        uid: '100000001', id: String(200 - index), gacha_type: '301', item_id: String(1000 + index),
        name: `记录${index}`, item_type: '角色', rank_type: index === 0 ? '5' : '3', count: '1',
        time: `2026-01-01 00:00:${String(index).padStart(2, '0')}`
      }));
    } else if (type === '301' && page === 2) {
      list = [{ uid: '100000001', id: '180', gacha_type: '301', item_id: '2000', name: '历史记录', item_type: '角色', rank_type: '4', count: '1', time: '2025-12-31 23:59:59' }];
    }
    return { status: 200, text: JSON.stringify({ retcode: 0, data: { region: 'cn_gf01', region_time_zone: 8, list } }) };
  }
};
(0, eval)(readFileSync(new URL('../web/network.js', import.meta.url), 'utf8'));

const link = gachaModel.parseLink('https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=fake&auth_appid=webview_gacha&game_biz=hk4e_cn');
const bundle = await gachaNetwork.fetch(link, gachaModel.normalizeDataset(null, 'hk4e'));
assert.equal(bundle.account.uid, '100000001');
assert.equal(bundle.records.length, 21);
assert.ok(urls.some(url => url.searchParams.get('page') === '2'));
assert.ok(urls.some(url => url.pathname.endsWith('/getBeyondGachaLog')));
assert.deepEqual(new Set(bundle.completedPoolTypes), new Set(['2000', '1000']));
assert.match(gachaModel.requestUrl({ ...link, game: 'hkrpg' }, gachaModel.games.hkrpg.pools.find(item => item[0] === '21')).pathname, /getLdGachaLog$/);

console.log('Pagination, pool endpoints and completion markers: OK');
