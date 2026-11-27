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

    /* На узком экране холст ведёт себя как на croch.ru: при прокрутке вниз
       он пропорционально уменьшается к своему нижнему краю, освобождая место
       для чата. Сначала сбрасываем transform, чтобы измерить исходный размер. */
    var compactQuery = window.matchMedia ? window.matchMedia('(max-width: 820px)') : null;
    function compactCanvasScale() {
      if (!el.wrap) return 1;
      el.wrap.style.transform = '';
      if (!compactQuery || !compactQuery.matches) return 1;
      var top = el.wrap.getBoundingClientRect().top + window.scrollY;
      var passed = Math.max(0, window.scrollY - Math.max(0, Math.round(top - 8)));
      var scale = Math.max(0.22, Math.min(1, 1 - passed / 650));
      if (scale < 0.999) el.wrap.style.transform = 'scale(' + scale.toFixed(3) + ')';
      return scale;
    }

    /* Панель кистей фиксируется по фактическим координатам холста: она всегда
       остаётся сбоку, даже когда страница прокручена или холст уменьшен. */
    function alignToolRail() {
      if (!el.toolRail || !el.wrap) return;
      compactCanvasScale();
      var rect = el.wrap.getBoundingClientRect();
      var railWidth = el.toolRail.offsetWidth || 54;
      var top = Math.round(rect.top);
      var height = Math.max(48, Math.min(Math.round(rect.height), window.innerHeight + 8));
      el.toolRail.style.left = Math.max(4, Math.round(rect.left - railWidth - 8)) + 'px';
      el.toolRail.style.top = top + 'px';
      el.toolRail.style.height = height + 'px';
      el.toolRail.style.maxHeight = height + 'px';
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
    window.addEventListener('scroll', alignToolRail, { passive: true });
    if (compactQuery && compactQuery.addEventListener) compactQuery.addEventListener('change', alignToolRail);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(alignToolRail).observe(el.wrap);
    renderAll();
    if (client.connected && !subscribedAt) {
      subscribedAt = Date.now();
      presenceReadyAt = subscribedAt + 15000;
      scheduleInitialState();
    }
  }
})(window.KROKO_GAME);
