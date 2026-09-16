function createDatasetCounter() {
  let inString = false;
  let escaped = false;
  let token = '';
  let lastString = '';
  let awaitingArray = '';
  let target = '';
  let bracketDepth = 0;
  let objectDepth = 0;
  const counts = {accounts: 0, records: 0};

  function accept(bytes) {
    for (const byte of bytes) {
      const char = String.fromCharCode(byte);
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
          lastString = token;
        } else if (token.length < 16 && byte < 128) {
          token += char;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        token = '';
        continue;
      }
      if (!target) {
        if (char === ':' && (lastString === 'accounts' || lastString === 'records')) {
          awaitingArray = lastString;
          lastString = '';
        } else if (char === '[' && awaitingArray) {
          target = awaitingArray;
          awaitingArray = '';
          bracketDepth = 1;
          objectDepth = 0;
        } else if (!/\s/.test(char) && char !== ':') {
          awaitingArray = '';
          if (char !== ',') lastString = '';
        }
        continue;
      }
      if (char === '[') bracketDepth += 1;
      else if (char === ']') {
        bracketDepth -= 1;
        if (bracketDepth === 0) target = '';
      } else if (char === '{') {
        if (bracketDepth === 1 && objectDepth === 0) counts[target] += 1;
        objectDepth += 1;
      } else if (char === '}') {
        objectDepth = Math.max(0, objectDepth - 1);
      }
    }
  }

  return {accept, counts};
}

async function datasetStats(ats, datasetId, maxBytes) {
  const opened = await ats.call('storage.dataset.openRead', {datasetId});
  if (!opened.found) return {accounts: 0, records: 0};
  if (Number(opened.size) > maxBytes) {
    await ats.call('storage.dataset.abort', {handle: opened.handle}).catch(() => {});
    throw Object.assign(new Error('Dataset exceeds worker limit'), {code: 'RESOURCE_LIMIT'});
  }
  const counter = createDatasetCounter();
  let offset = 0;
  try {
    while (true) {
      const part = await ats.call('storage.dataset.read', {
        handle: opened.handle,
        offset,
        maxBytes: Math.min(131072, maxBytes - offset)
      });
      const bytes = ats.decodeBase64(part.bytes);
      counter.accept(bytes);
      offset += bytes.length;
      if (part.eof) break;
    }
  } finally {
    await ats.call('storage.dataset.abort', {handle: opened.handle}).catch(() => {});
  }
  return counter.counts;
}

globalThis.atsWorkerMain = async function (input, ats) {
  const [genshin, starrail] = await Promise.all([
    datasetStats(ats, 'genshin-records', 268435456),
    datasetStats(ats, 'starrail-records', 268435456)
  ]);
  const records = genshin.records + starrail.records;
  const accounts = genshin.accounts + starrail.accounts;
  const result = {
    title: accounts ? `${accounts} 个账号` : '尚无账号',
    detail: records ? `原神 ${genshin.records} · 星铁 ${starrail.records}` : '导入或同步抽卡记录',
    value: records,
    state: records ? 'ready' : 'empty'
  };
  if (input?.kind === 'capability' && input?.method === 'gacha.summary.get') return result;
  return {status: 'succeeded', accounts, records};
};
