(() => {
  const APP_VERSION = '2.109.0';
  const X4_SALT = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs';
  const LK2_SALT = 'd9200c846b10886e8c874fc33c8f308b';
  const TOKEN_API = 'https://api-takumi.mihoyo.com/auth/api/getMultiTokenByLoginTicket';
  const COOKIE_TOKEN_API = 'https://passport-api.mihoyo.com/account/auth/api/getCookieAccountInfoBySToken';
  const QR_CREATE_API = 'https://passport-api.mihoyo.com/account/ma-cn-passport/app/createQRLogin';
  const QR_STATUS_API = 'https://passport-api.mihoyo.com/account/ma-cn-passport/app/queryQRLoginStatus';
  const ROLE_API = 'https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie';
  const AUTHKEY_API = 'https://api-takumi.miyoushe.com/binding/api/genAuthKey';

  function randomHex(length) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('').slice(0, length);
  }

  function randomAlphaNumeric(length) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, value => alphabet[value % alphabet.length]).join('');
  }

  function md5(input) {
    const bytes = new TextEncoder().encode(input);
    const total = (((bytes.length + 8) >> 6) + 1) * 64;
    const data = new Uint8Array(total);
    data.set(bytes);
    data[bytes.length] = 128;
    new DataView(data.buffer).setUint32(total - 8, bytes.length * 8, true);
    const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0);
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const view = new DataView(data.buffer);
    for (let offset = 0; offset < total; offset += 64) {
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let index = 0; index < 64; index += 1) {
        let f;
        let word;
        if (index < 16) {
          f = (b & c) | (~b & d);
          word = index;
        } else if (index < 32) {
          f = (d & b) | (~d & c);
          word = (5 * index + 1) % 16;
        } else if (index < 48) {
          f = b ^ c ^ d;
          word = (3 * index + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          word = (7 * index) % 16;
        }
        const sum = (a + f + constants[index] + view.getUint32(offset + word * 4, true)) >>> 0;
        const shift = shifts[Math.floor(index / 16) * 4 + index % 4];
        const next = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
        a = d;
        d = c;
        c = b;
        b = next;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }
    return [a0, b0, c0, d0]
      .map(value => [0, 8, 16, 24].map(shift => ((value >>> shift) & 255).toString(16).padStart(2, '0')).join(''))
      .join('');
  }

  function parseCookie(raw) {
    const result = {};
    String(raw || '').replaceAll('\n', ';').split(';').forEach(entry => {
      const separator = entry.indexOf('=');
      if (separator < 1) return;
      const key = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      if (key && value) result[key] = value;
    });
    if (!Object.keys(result).length) throw new Error('没有读取到米游社登录信息');
    return result;
  }

  function cookieText(values) {
    return Object.entries(values)
      .filter(([key, value]) => key && value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  function query(values) {
    return Object.entries(values).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  }

  function createDs(method, queryValues = {}, body = '', salt = X4_SALT, signOnly = false, options = {}) {
    const timestamp = options.timestamp || Math.floor(Date.now() / 1000);
    const random = options.random || (signOnly ? randomAlphaNumeric(6) : String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 100001));
    const sortedQuery = Object.entries(queryValues).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('&');
    const source = signOnly
      ? `salt=${salt}&t=${timestamp}&r=${random}`
      : `salt=${salt}&t=${timestamp}&r=${random}&b=${String(method).toUpperCase() === 'GET' ? '' : body}&q=${sortedQuery}`;
    return `${timestamp},${random},${md5(source)}`;
  }

  function check(response, action) {
    let root;
    try {
      root = response.text ? JSON.parse(response.text) : {};
    } catch (_) {
      throw new Error(`${action}返回了无法识别的数据（HTTP ${response.status}）`);
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`${action}失败（HTTP ${response.status}）`);
    if (Number(root.retcode) !== 0) throw new Error(`${action}失败（${root.retcode}）：${root.message || '未知错误'}`);
    return root;
  }

  function qrHeaders(deviceId) {
    return {
      'User-Agent': 'HYPContainer/1.3.3.182',
      'x-rpc-device_id': deviceId,
      'x-rpc-app_id': 'ddxf5dufpuyo',
      'x-rpc-client_type': '3'
    };
  }

  function requestHeaders(cookies, options = {}) {
    const method = options.method || 'GET';
    const body = options.body || '';
    const queryValues = options.query || {};
    return {
      Cookie: cookieText(cookies),
      DS: createDs(method, queryValues, body, options.salt || X4_SALT, Boolean(options.signOnly)),
      Referer: 'https://webstatic.mihoyo.com',
      'User-Agent': `Mozilla/5.0 (Linux; Android 13) miHoYoBBS/${APP_VERSION}`,
      'x-rpc-app_version': APP_VERSION,
      'x-rpc-client_type': '5',
      'x-requested-with': 'com.mihoyo.hyperion',
      'x-rpc-device_id': options.deviceId,
      'x-rpc-device_fp': options.deviceFp
    };
  }

  async function createQrSession() {
    const deviceId = randomHex(32);
    const response = await ats.request(QR_CREATE_API, { method: 'POST', headers: qrHeaders(deviceId) });
    const data = check(response, '创建米游社登录二维码').data || {};
    if (!data.ticket || !data.url) throw new Error('米游社未返回完整二维码');
    return { ticket: data.ticket, loginUrl: data.url, deviceId, expiresAt: Date.now() + 300000 };
  }

  async function pollQrSession(session) {
    if (Date.now() >= session.expiresAt) throw new Error('米游社登录二维码已过期，请重新扫码');
    const body = JSON.stringify({ ticket: session.ticket });
    const response = await ats.request(QR_STATUS_API, {
      method: 'POST',
      headers: { ...qrHeaders(session.deviceId), 'Content-Type': 'application/json; charset=UTF-8' },
      body
    });
    const data = check(response, '查询米游社扫码状态').data || {};
    if (data.status !== 'Confirmed') return { status: data.status || 'Created' };
    const user = data.user_info || {};
    const token = (data.tokens || []).find(item => item && item.token);
    if (!user.aid || !token?.token) throw new Error('米游社扫码登录未返回完整凭据');
    return {
      status: 'Confirmed',
      cookie: cookieText({
        stoken: token.token,
        stuid: user.aid,
        account_id: user.aid,
        account_id_v2: user.aid,
        mid: user.mid,
        account_mid_v2: user.mid
      })
    };
  }

  async function loadRoles(rawCookie) {
    const cookies = parseCookie(rawCookie);
    const deviceId = randomHex(32);
    const deviceFp = randomHex(13);
    let accountId = cookies.account_id || cookies.account_id_v2 || cookies.stuid || cookies.login_uid || cookies.ltuid_v2;
    if (!accountId) throw new Error('登录信息缺少账号 ID，请重新登录后再试');
    if (!cookies.stoken && !cookies.stoken_v2) {
      if (!cookies.login_ticket) throw new Error('当前登录信息不能换取账号令牌，请重新扫码登录');
      const values = { login_ticket: cookies.login_ticket, token_types: '3', uid: accountId };
      const response = await ats.request(`${TOKEN_API}?${query(values)}`, { headers: requestHeaders({}, { query: values, deviceId, deviceFp }) });
      const root = check(response, '换取账号令牌');
      const item = (root.data?.list || []).find(value => String(value.name).toLowerCase() === 'stoken') || root.data?.list?.[0];
      if (!item?.token) throw new Error('米游社未返回账号令牌');
      cookies.stoken = item.token;
    }
    const stoken = cookies.stoken || cookies.stoken_v2;
    const mid = cookies.mid || cookies.account_mid_v2 || cookies.ltmid_v2;
    if (!stoken || !mid) throw new Error('米游社登录信息不完整，请重新扫码登录');

    const refreshCookieToken = async () => {
      const values = { stoken };
      const response = await ats.request(`${COOKIE_TOKEN_API}?${query(values)}`, {
        headers: requestHeaders({ stoken, mid }, { query: values, deviceId, deviceFp })
      });
      const data = check(response, '换取访问令牌').data || {};
      if (!data.cookie_token) throw new Error('米游社未返回访问令牌');
      accountId = data.uid || accountId;
      cookies.cookie_token = data.cookie_token;
    };
    if (!cookies.cookie_token) await refreshCookieToken();
    cookies.account_id = accountId;
    cookies.stuid ||= accountId;
    cookies.mid ||= mid;

    const requestRoleList = async () => ats.request(ROLE_API, {
      headers: requestHeaders({ account_id: accountId, cookie_token: cookies.cookie_token }, { deviceId, deviceFp })
    });
    let response = await requestRoleList();
    let root;
    try {
      root = check(response, '读取游戏角色');
    } catch (error) {
      await refreshCookieToken();
      response = await requestRoleList();
      root = check(response, '读取游戏角色');
    }
    const roles = (root.data?.list || []).flatMap(item => {
      const game = item.game_biz?.startsWith('hk4e_') ? 'hk4e' : item.game_biz?.startsWith('hkrpg_') ? 'hkrpg' : null;
      return game ? [{
        game,
        uid: String(item.game_uid || ''),
        region: item.region || '',
        regionName: item.region_name || '',
        level: Number(item.level || 0),
        nickname: item.nickname || '',
        gameBiz: item.game_biz
      }] : [];
    });
    if (!roles.length) throw new Error('该米游社账号没有绑定原神或星穹铁道角色');
    return { cookie: cookieText(cookies), roles };
  }

  async function generateLink(rawCookie, role) {
    if (role.game !== 'hk4e') throw new Error('星穹铁道暂不支持通过米游社登录状态生成抽卡链接');
    const cookies = parseCookie(rawCookie);
    const stoken = cookies.stoken || cookies.stoken_v2;
    const mid = cookies.mid || cookies.account_mid_v2 || cookies.ltmid_v2;
    if (!stoken || !mid) throw new Error('米游社登录信息不完整，请重新扫码登录');
    const body = JSON.stringify({ game_biz: role.gameBiz, game_uid: role.uid, region: role.region, auth_appid: 'webview_gacha' });
    const response = await ats.request(AUTHKEY_API, {
      method: 'POST',
      headers: {
        ...requestHeaders({ stoken, mid }, { method: 'POST', body, salt: LK2_SALT, signOnly: true, deviceId: randomHex(32), deviceFp: randomHex(13) }),
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body
    });
    const data = check(response, '生成抽卡链接').data || {};
    if (!data.authkey) throw new Error('米游社未返回抽卡访问凭据');
    const parameters = {
      authkey_ver: data.authkey_ver || '1', sign_type: data.sign_type || '2', auth_appid: 'webview_gacha',
      win_mode: 'fullscreen', timestamp: String(Math.floor(Date.now() / 1000)), region: role.region,
      default_gacha_type: '301', lang: 'zh-cn', authkey: data.authkey, game_biz: role.gameBiz,
      os_system: 'Android', device_model: 'Android Tool Suite', plat_type: 'android'
    };
    return { game: 'hk4e', parameters, overseas: false, uidHint: role.uid };
  }

  window.mihoyo = { createQrSession, pollQrSession, loadRoles, generateLink, md5, createDs, parseCookie };
})();
