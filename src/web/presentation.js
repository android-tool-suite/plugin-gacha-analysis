(() => {
  function importPlan(datasets, bundles) {
    return ['hk4e','hkrpg'].filter(game => bundles.some(bundle => bundle.account.game === game)).map(game => {
      const candidate = JSON.parse(JSON.stringify(datasets[game]));
      const result = gachaModel.mergeDataset(candidate, bundles);
      return {game, candidate, ...result};
    });
  }
  const sourceKey = account => `banner-history-sources:${account.game}:${account.uid}`;
  const lossKey = account => `star-rail-loss-names:${account.uid}`;
  const preference = (settings, key, fallback) => settings.preferences?.[key]?.value ?? fallback;
  function selection(accounts, current, settings) {
    const wanted = current ? gachaModel.key(current) : preference(settings, 'selected-account', preference(settings, 'selected_account_key', ''));
    return accounts.find(account => gachaModel.key(account) === wanted) || accounts[0] || null;
  }
  function analysisOptions(settings, account) {
    const defaults = ['record-field', account.game === 'hk4e' ? 'paimon-moe' : 'star-rail-station', 'local-rules'];
    const sources = preference(settings, sourceKey(account), preference(settings, 'banner_history_sources', defaults));
    const losses = account.game === 'hkrpg' ? preference(settings, lossKey(account), preference(settings, 'starrail_custom_loss_names', [])) : [];
    return {sources: Array.isArray(sources) ? sources.map(value => String(value).toLowerCase().replaceAll('_', '-')) : defaults, losses: Array.isArray(losses) ? losses : []};
  }
  const recordIndexes=new WeakMap();
  function records(snapshot, game, query='', pool='all', rarity=0) {
    if(!snapshot)return [];
    let index=recordIndexes.get(snapshot);if(!index||index.records!==snapshot.records||index.length!==snapshot.records.length){index={records:snapshot.records,length:snapshot.records.length,sorted:[...snapshot.records].sort((a,b)=>-gachaModel.order(a,b)),filters:new Map()};recordIndexes.set(snapshot,index);}
    const search=query.trim().toLowerCase(),key=JSON.stringify([game,search,pool,rarity]);if(index.filters.has(key))return index.filters.get(key);
    const result=index.sorted.filter(item =>
      (!search || `${item.name} ${item.item_id} ${item.id} ${item.time}`.toLowerCase().includes(search)) &&
      (pool === 'all' || gachaModel.poolType(game, item.uigf_gacha_type || item.gacha_type) === pool) &&
      (!rarity || Number(item.rank_type) === rarity)
    );
    if(index.filters.size>=6)index.filters.delete(index.filters.keys().next().value);index.filters.set(key,result);return result;
  }
  function recordMonths(records) {
    const counts = new Map();
    for (const record of records) {
      const month = String(record.time || '').slice(0, 7);
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) counts.set(month, (counts.get(month) || 0) + 1);
    }
    return [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([month, count]) => ({month, count}));
  }
  function dateGroups(records) {
    const groups = [];
    for (const record of records) {
      const date = String(record.time || '').slice(0, 10) || '日期未知';
      if (groups.at(-1)?.date !== date) groups.push({date, records: []});
      groups.at(-1).records.push(record);
    }
    return groups;
  }
  function recordDetail(snapshot, game, identity) {
    const record = snapshot?.records.find(item => gachaModel.recordKey(game, item) === identity);
    if (!record) return null;
    const type = gachaModel.poolType(game, record.uigf_gacha_type || record.gacha_type);
    const pool = snapshot.stats.find(item => item.type === type);
    const pull = pool?.targetPulls.find(item => gachaModel.recordKey(game, item.record) === identity);
    return {record, pool, pull, pity: snapshot.pityByRecord[identity]};
  }
  function exportBundles(datasets, accounts, selectedKeys) {
    const selected = new Set(selectedKeys);
    return accounts.filter(account => selected.has(gachaModel.key(account))).map(account => ({
      account,
      records: datasets[account.game].records.filter(item => item.uid === account.uid),
      completedPoolTypes: [],
    }));
  }
  window.gachaPresentation = {importPlan, sourceKey, lossKey, selection, analysisOptions, records, recordMonths, dateGroups, recordDetail, exportBundles};
})();
