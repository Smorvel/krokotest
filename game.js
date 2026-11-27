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

    /* На узком экране квадрат уменьшается на месте. Никакого translateY:
       трансформация не меняет поток документа, поэтому сдвинутый холст
       перекрывал бы палитру и чат при прокрутке. */
    var compactQuery = window.matchMedia ? window.matchMedia('(max-width: 820px)') : null;
    function compactCanvasScale() {
      if (!el.wrap) return 1;
      el.wrap.style.transform = '';
      if (!compactQuery || !compactQuery.matches) return 1;
      var maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      var progress = maxScroll > 0 ? Math.min(1, window.scrollY / maxScroll) : 0;
      var scale = 1 - 0.18 * progress;
      el.wrap.style.transform = 'scale(' + scale.toFixed(3) + ')';
      return scale;
    }

    function layoutBox(node) {
      var left = 0;
      var top = 0;
      for (var current = node; current; current = current.offsetParent) {
        left += current.offsetLeft || 0;
        top += current.offsetTop || 0;
      }
      return {
        left: left - (window.scrollX || 0),
        top: top - (window.scrollY || 0),
        width: node.offsetWidth,
        height: node.offsetHeight
      };
    }

    /* Ширина панели фиксированная — 118px. Если кнопки не помещаются по
       высоте, они раскладываются ровно во второй столбец. Скроллбара и
       обрезанных кнопок нет. За высоту берём собственную высоту содержимого,
       а не высоту квадрата холста. */
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
      compactCanvasScale();
      var box = layoutBox(el.wrap);
      var railWidth = el.toolRail.offsetWidth || 118;
      var available = Math.max(120, window.innerHeight - 16);
      var items = railItems();
      var railStyle = getComputedStyle(el.toolRail);
      var rowGap = parseFloat(railStyle.rowGap) || 6;
      var chrome = (parseFloat(railStyle.paddingTop) || 0) +
        (parseFloat(railStyle.paddingBottom) || 0) +
        (parseFloat(railStyle.borderTopWidth) || 0) +
        (parseFloat(railStyle.borderBottomWidth) || 0);
      if (!items.length) return;

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

      var cols = 1;
      var rows = items.length;
      var height = stackHeight(rows);
      if (height > available && items.length > 1) {
        cols = 2;
        rows = Math.ceil(items.length / 2);
        height = stackHeight(rows);
      }
      el.toolRail.style.setProperty('--rail-cols', cols);
      el.toolRail.style.setProperty('--rail-rows', rows);
      height = Math.max(120, Math.round(height));
      el.toolRail.style.left = Math.max(4, Math.round(box.left - railWidth - 8)) + 'px';
      el.toolRail.style.top = Math.round(height > available ? 8 : box.top) + 'px';
      el.toolRail.style.height = height + 'px';
      el.toolRail.style.maxHeight = 'none';
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
