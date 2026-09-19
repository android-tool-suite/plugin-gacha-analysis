(function (root) {
  function preferredGame(settings) {
    const preferences = settings.preferences || {};
    const key = preferences['selected-account']?.value ?? preferences.selected_account_key?.value ?? '';
    return String(key).startsWith('hkrpg:') ? 'hkrpg' : 'hk4e';
  }
  function createLoader(read, apply) {
    const loaded = new Set(), pending = new Map(), failed = new Set();
    function ensure(game) {
      if (loaded.has(game)) return Promise.resolve();
      if (!pending.has(game)) {failed.delete(game);pending.set(game, Promise.resolve()
        .then(()=>read(game==='hk4e'?'genshin-records':'starrail-records'))
        .then(bytes=>apply(game, bytes)).then(()=>{loaded.add(game);})
        .catch(error=>{failed.add(game);throw error;})
        .finally(()=>pending.delete(game)));}
      return pending.get(game);
    }
    return {ensure, has:game=>loaded.has(game), failed:game=>failed.has(game), all:()=>Promise.all(['hk4e','hkrpg'].map(ensure))};
  }
  root.gachaInitialLoad = {preferredGame, createLoader};
})(globalThis);
