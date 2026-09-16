(() => {
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
  function records(snapshot, game, query, pool, rarity) {
    const search = query.trim().toLowerCase();
    return [...(snapshot?.records || [])].filter(item =>
      (!search || `${item.name} ${item.item_id} ${item.id} ${item.time}`.toLowerCase().includes(search)) &&
      (pool === 'all' || gachaModel.poolType(game, item.uigf_gacha_type || item.gacha_type) === pool) &&
      (!rarity || Number(item.rank_type) === rarity)
    ).sort((a, b) => -gachaModel.order(a, b));
  }
  window.gachaPresentation = {sourceKey, lossKey, selection, analysisOptions, records};
})();
