import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;

const calls = [];
const replies = [
  { retcode: 0, data: { ticket: 'ticket-fixture', url: 'https://user.mihoyo.com/qr/fixture' } },
  {
    retcode: 0,
    data: {
      status: 'Confirmed',
      user_info: { aid: '100000001', mid: '200000001' },
      tokens: [{ name: 'stoken', token: 'stoken_fixture_only' }]
    }
  },
  {
    retcode: 0,
    data: {
      list: [{ game_biz: 'hk4e_cn', game_uid: '123456789', region: 'cn_gf01', region_name: '天空岛', level: 60, nickname: '测试角色' }]
    }
  },
  { retcode: 0, data: { authkey: 'authkey_fixture_only', authkey_ver: '1', sign_type: '2' } }
];

globalThis.ats = {
  request: async (url, options = {}) => {
    calls.push({ url, options });
    return { status: 200, text: JSON.stringify(replies.shift()) };
  }
};

(0, eval)(readFileSync(new URL('../web/mihoyo.js', import.meta.url), 'utf8'));

assert.equal(mihoyo.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
assert.equal(
  mihoyo.createDs('GET', { b: '2', a: '1' }, '', 'salt', false, { timestamp: 1, random: '100000' }),
  '1,100000,d2aab39d82f24d19bd107cbea1e02566'
);

const qr = await mihoyo.createQrSession();
assert.equal(qr.ticket, 'ticket-fixture');
assert.match(calls[0].url, /createQRLogin$/);
assert.equal(calls[0].options.headers['x-rpc-app_id'], 'ddxf5dufpuyo');

const confirmed = await mihoyo.pollQrSession(qr);
assert.equal(confirmed.status, 'Confirmed');
assert.match(confirmed.cookie, /stoken=stoken_fixture_only/);
assert.doesNotMatch(JSON.stringify(qr), /stoken_fixture_only/);

const account = await mihoyo.loadRoles(`${confirmed.cookie}; cookie_token=cookie_fixture_only`);
assert.equal(account.roles.length, 1);
assert.equal(account.roles[0].game, 'hk4e');
assert.equal(account.roles[0].uid, '123456789');
assert.match(calls[2].options.headers.Cookie, /cookie_token=cookie_fixture_only/);

const link = await mihoyo.generateLink(account.cookie, account.roles[0]);
assert.equal(link.game, 'hk4e');
assert.equal(link.parameters.authkey, 'authkey_fixture_only');
assert.equal(calls[3].options.method, 'POST');
assert.match(calls[3].options.headers.Cookie, /stoken=stoken_fixture_only/);
assert.doesNotMatch(calls[3].options.body, /stoken_fixture_only|cookie_fixture_only/);

console.log('Mihoyo QR, role and temporary link fixtures: OK');
