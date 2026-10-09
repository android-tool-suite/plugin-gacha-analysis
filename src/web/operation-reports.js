(() => {
  const failureDetail = '未完成，请返回插件查看详情';
  // Every reporter belongs to one live Web session. Session release is handled by the host.
  function createOperationReporter(client) {
    const session = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let sequence = 0;
    function send(payload) {
      try {
        return Promise.resolve(client.call('app.reportOperation', payload, 5000))
          .then(result => typeof result?.taskId === 'string' && result.taskId.length > 0 && result.status === payload.status)
          .catch(() => false);
      } catch (_) { return Promise.resolve(false); }
    }
    return {
      start(label) {
        const id = `gacha-${session}-${++sequence}`;
        // Send immediately from the user action; reporting never delays the actual operation.
        const started = send({id, label, status:'running'});
        let terminal;
        function finish(status, detail) {
          if (terminal) return terminal;
          // The end of this operation cannot overtake its own start, including a failed report.
          terminal = started.then(() => send({id, label, status, detail}));
          return terminal;
        }
        return {
          id, started,
          success:(detail = '已完成') => finish('success', detail),
          fail:() => finish('failed', failureDetail),
          cancel:() => finish('cancelled', '操作已取消'),
        };
      },
    };
  }
  globalThis.createOperationReporter = createOperationReporter;
})();
