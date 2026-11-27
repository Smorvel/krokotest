/* Room startup: sync overlay, timers and initial render. */
(function (G) {
  with (G) {
    /* Одно и то же окно используется и при первом подключении, и при потере
       соединения: игрок всегда видит, что с комнатой нет связи. */
    function showConnectionOverlay(title, hint) {
      if (sessionKicked) return;
      syncDone = false;
      if (el.loadingOverlayText) el.loadingOverlayText.textContent = title || 'подключение';
      if (el.loadingOverlayHint) el.loadingOverlayHint.textContent = hint || '';
      if (el.loadingOverlay) el.loadingOverlay.hidden = false;
      document.body.classList.add('syncing');
      renderSync();
    }

    function markSynced() {
      if (sessionKicked || !client || !client.connected) return;
      if (el.loadingOverlay) el.loadingOverlay.hidden = true;
      document.body.classList.remove('syncing');
      syncDone = true;
    }

    /* Ставим панель кистей точно напротив холста: она едет вместе с ним при
       прокрутке и не «уползает» вниз относительно рисунка. */
    function alignToolRail() {
      if (!el.toolRail || !el.wrap) return;
      el.toolRail.style.marginTop = '0px';
      var diff = el.wrap.getBoundingClientRect().top - el.toolRail.getBoundingClientRect().top;
      el.toolRail.style.marginTop = Math.max(0, Math.round(diff)) + 'px';
      var top = el.toolRail.getBoundingClientRect().top;
      el.toolRail.style.maxHeight = Math.max(140, Math.round(window.innerHeight - top - 18)) + 'px';
    }

    G.showConnectionOverlay = showConnectionOverlay;
    G.markSynced = markSynced;
    G.alignToolRail = alignToolRail;

    var periodicTick = 0;
    setInterval(function () {
      if (sessionKicked) return;
      periodicTick += 1;
      if (client && client.connected) publishPresence(true);
      /* Художник периодически рассылает полный холст: если отдельное событие
         штриха потерялось, следующий снимок всё равно восстановит его у всех.
         Общее состояние шлём реже — оно не несёт рисунок и только дублирует
         уже доставленные события. */
      if (state && isDrawer()) {
        publishCanvasSnapshot();
        if (periodicTick % 3 === 0) publishState();
      }
      /* Снимок или событие, пришедшие раньше состояния, применяются как только
       * раунд состояния догнал их. */
      if (state) {
        flushPendingCanvas();
        flushFutureEvents();
        flushPendingStrokes();
      }
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
    alignToolRail();
    window.addEventListener('resize', alignToolRail);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(alignToolRail).observe(el.wrap);
    renderAll();
    if (client.connected && !subscribedAt) {
      subscribedAt = Date.now();
      presenceReadyAt = subscribedAt + 15000;
      scheduleInitialState();
    }
  }
})(window.KROKO_GAME);
