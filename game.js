/* Room startup: sync overlay, timers and initial render. */
(function (G) {
  with (G) {
    function markSynced() {
      if (syncDone || sessionKicked) return;
      syncDone = true;
      if (el.loadingOverlay) el.loadingOverlay.hidden = true;
      document.body.classList.remove('syncing');
    }

    G.markSynced = markSynced;

    setInterval(function () {
      if (sessionKicked) return;
      if (client && client.connected) publishPresence(true);
      /* Художник периодически рассылает полный холст: если отдельное событие
         штриха потерялось, следующий снимок всё равно восстановит его у всех. */
      if (state && isDrawer()) publishCanvasSnapshot();
      if (state && state.hitInfo) scheduleHitResolution(state.hitInfo);
      if (state && state.reveal && Number(state.reveal.until) <= Date.now()) finishReveal(state.reveal);
      if (state) ensureDrawer();
      checkTimeout();
      issueHintIfNeeded();
      renderTimer();
    }, 5000);

    setInterval(function () {
      if (sessionKicked) return;
      if (client && client.connected) renderTimer();
      if (state) {
        issueHintIfNeeded();
        renderWord();
        renderReveal();
      }
    }, 1000);

    el.nameInput.value = profile.named ? profile.name : '';
    if (!profile.named && !sessionKicked) el.nameModal.showModal();
    if (sessionKicked) return;
    renderToolsOnce();
    applyMeta();
    renderAll();
    if (client.connected && !subscribedAt) {
      subscribedAt = Date.now();
      presenceReadyAt = subscribedAt + 5000;
      scheduleInitialState();
    }
  }
})(window.KROKO_GAME);
