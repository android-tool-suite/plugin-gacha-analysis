(() => {
  // The host owns exiting the tool; this controller only handles open local layers.
  function create({client, document, canBack = () => false, back = () => {}}) {
    let sent, disposed = false, pending = Promise.resolve(), layers = [];
    function openLayers() {
      const current = [...document.querySelectorAll('dialog[open]')];
      layers = layers.filter(dialog => current.includes(dialog));
      for(const dialog of current)if(!layers.includes(dialog))layers.push(dialog);
      return layers;
    }
    function sync() {
      if(disposed)return;
      const enabled = openLayers().length > 0 || !!canBack();
      if(enabled === sent)return;
      sent = enabled;
      // Preserve the order of open/close updates even if the bridge is temporarily busy.
      pending = pending.catch(()=>{}).then(()=>client.ready).then(()=>client.call('app.setBackNavigation',{enabled})).catch(()=>{if(sent===enabled)sent=undefined;});
    }
    function request() {
      const dialog = openLayers().at(-1);
      if(dialog) {
        const event = new Event('cancel',{cancelable:true});
        if(dialog.dispatchEvent(event))dialog.close();
      } else if(canBack())back();
      sync();
    }
    const unsubscribe = client.onEvent('app.backRequested',request);
    const observer = new MutationObserver(sync);
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
    document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',sync));
    sync();
    return {sync,request,dispose(){disposed=true;observer.disconnect();unsubscribe();}};
  }
  globalThis.createPluginBackNavigation = create;
})();
