/* Room startup: timers and initial render. */
(function (G) {
  with (G) {
    setInterval(function () {
      if (client && client.connected) publishPresence(true);
      if (state) ensureDrawer();
      checkTimeout();
      issueHintIfNeeded();
      renderTimer();
    }, 5000);
  
    setInterval(function () {
      if (client && client.connected) renderTimer();
      if (state) {
        issueHintIfNeeded();
        renderWord();
      }
    }, 1000);
  
    el.nameInput.value = profile.named ? profile.name : '';
    if (!profile.named) el.nameModal.showModal();
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
