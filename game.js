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
      /* Повторная подписка после переподключения/возврата в вкладку ещё не
         закончена: renderAll не должен прятать окно просто потому, что старое
         состояние всё ещё лежит в памяти. */
      if (typeof isSyncPending === 'function' && isSyncPending()) return;
      if (el.loadingOverlay) el.loadingOverlay.hidden = true;
      document.body.classList.remove('syncing');
      syncDone = true;
    }

    /* Панель кистей больше не сжимается в два столбца. На широком экране это
       тонкая колонка слева от холста, на узком (<1100px) — горизонтальный ряд
       под холстом и прямо над нижней палитрой. Положение меняется только при
       пересечении порога, без постоянных чтений геометрии. */
    var railHorizontal = null;
    function alignToolRail() {
      if (!el.toolRail || !el.stage || !el.colorDock) return;
      var horizontal = window.innerWidth < 1100;
      if (horizontal === railHorizontal) return;
      railHorizontal = horizontal;
      el.toolRail.classList.toggle('rail-horizontal', horizontal);
      document.body.classList.toggle('rail-horizontal', horizontal);
      if (horizontal) {
        el.stage.insertBefore(el.toolRail, el.colorDock);
      } else {
        var shell = el.toolRail.closest('.game-shell') || el.stage.parentNode;
        shell.insertBefore(el.toolRail, shell.firstChild);
      }
    }

    G.showConnectionOverlay = showConnectionOverlay;
    G.markSynced = markSynced;
    G.alignToolRail = alignToolRail;

    var periodicTick = 0;
    setInterval(function () {
      if (sessionKicked) return;
      periodicTick += 1;
      if (client && client.connected) publishPresence(true);
      /* Скрытая вкладка не ведёт свою игру: таймеры и перевод хода возобновляются
         только после сверки с брокером при возврате в вкладку. */
      if (document.hidden) return;
      /* Художник периодически рассылает полный холст: если отдельное событие
         штриха потерялось, следующий снимок всё равно восстановит его у всех.
         Общее состояние шлём реже — оно не несёт рисунок и только дублирует
         уже доставленные события. */
      if (state && isDrawer() && !state.reveal && !state.lastWord && state.drawer === myId) {
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
      if (state && typeof resumeWaitingRound === 'function') resumeWaitingRound();
      if (state) ensureDrawer();
      checkTimeout();
      issueHintIfNeeded();
      renderTimer();
    }, 5000);

    setInterval(function () {
      if (sessionKicked) return;
      /* Страж работает и в скрытой вкладке: иначе замерший лидер мог бы
         заблокировать раунд для всех остальных. */
      guardTick();
      if (document.hidden) return;
      if (client && client.connected) renderTimer();
      if (state) {
        issueHintIfNeeded();
        renderWord();
        renderReveal();
        renderSystemFeed();
        if (typeof updateSounds === 'function') updateSounds();
        if (typeof clearAbandonedWaiting === 'function') clearAbandonedWaiting();
      }
    }, 1000);

    el.nameInput.value = profile.named ? profile.name : '';
    if (!profile.named && !sessionKicked) el.nameModal.showModal();
    if (sessionKicked) return;
    renderToolsOnce();
    applyMeta();
    alignToolRail();
    /* Возврат в видимую вкладку больше не показывает окно «синхронизация»:
       оно мигало при каждом переключении окна и мешало игре. Полный resync
       нужен только при настоящем переподключении; здесь мы просто переспра-
       шиваем retained-темы и обновляем presence с признаком видимости. */
    var lastVisibleRefreshAt = 0;
    function onVisible() {
      if (document.hidden || !client || !client.connected) return;
      if (typeof resyncRoom !== 'function') return;
      var now = Date.now();
      if (now - lastVisibleRefreshAt < 1200) return;
      lastVisibleRefreshAt = now;
      /* Возврат после сворачивания — тихая полная сверка: без неё клиент
         мог остаться при старом drawer и снова начать рисовать. */
      resyncRoom('возврат в вкладку', true);
      if (typeof clearAbandonedWaiting === 'function') clearAbandonedWaiting();
    }
    function onHidden() {
      if (client && client.connected) publishPresence(true);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) onHidden();
      else onVisible();
    });
    window.addEventListener('focus', function () {
      if (!document.hidden && client && client.connected) publishPresence(true);
    });
    window.addEventListener('pageshow', function (event) { if (event.persisted) onVisible(); });
    window.addEventListener('resize', alignToolRail);
    renderAll();
    if (client.connected && !subscribedAt) {
      subscribedAt = Date.now();
      presenceReadyAt = subscribedAt + 15000;
      scheduleInitialState();
    }
  }
})(window.KROKO_GAME);
