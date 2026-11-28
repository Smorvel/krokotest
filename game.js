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

    /* Панель живёт в собственной колонке сетки и липнет к верху. Холст
       уменьшается обычной шириной, а не трансформацией: поэтому он и панель
       всегда занимают своё место в потоке и не перекрывают палитру. */
    function railItems() {
      if (!el.toolRail) return [];
      return [].slice.call(el.toolRail.children).reduce(function (all, node) {
        if (node === el.toolGrid && getComputedStyle(node).display === 'contents') {
          return all.concat([].slice.call(node.children));
        }
        all.push(node);
        return all;
      }, []);
    }

    function alignToolRail() {
      if (!el.toolRail || !el.wrap) return;
      var items = railItems();
      if (!items.length) return;
      var railStyle = getComputedStyle(el.toolRail);
      var rowGap = parseFloat(railStyle.rowGap) || 6;
      var chrome = (parseFloat(railStyle.paddingTop) || 0) +
        (parseFloat(railStyle.paddingBottom) || 0) +
        (parseFloat(railStyle.borderTopWidth) || 0) +
        (parseFloat(railStyle.borderBottomWidth) || 0);

      function stackHeight(rows) {
        var height = chrome + rowGap * Math.max(0, rows - 1);
        for (var row = 0; row < rows; row += 1) {
          var tallest = items[row].offsetHeight || 0;
          var other = items[row + rows];
          if (other) tallest = Math.max(tallest, other.offsetHeight || 0);
          height += tallest;
        }
        return height;
      }

      /* Панель не должна быть выше холста: иначе она заходила бы на палитру.
         Двух столбцов достаточно, чтобы всё поместилось и на узком окне. */
      var available = Math.min(el.wrap.offsetHeight - 4, window.innerHeight - 16);
      var cols = 1;
      var rows = items.length;
      var height = stackHeight(rows);
      if (height > available && items.length > 1) {
        cols = 2;
        rows = Math.ceil(items.length / 2);
      }
      el.toolRail.style.setProperty('--rail-cols', cols);
      el.toolRail.style.setProperty('--rail-rows', rows);
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
      if (typeof refreshRoom !== 'function') return;
      var now = Date.now();
      if (now - lastVisibleRefreshAt < 1200) return;
      lastVisibleRefreshAt = now;
      refreshRoom();
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
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(alignToolRail).observe(el.wrap);
    renderAll();
    if (client.connected && !subscribedAt) {
      subscribedAt = Date.now();
      presenceReadyAt = subscribedAt + 15000;
      scheduleInitialState();
    }
  }
})(window.KROKO_GAME);
