/* Deterministic room consensus: one drawer id for every client.
   Pure helpers only; network/room call them through window.KROKO_GAME. */
(function (G) {
  with (G) {
    function hash32(value) {
      var text = String(value || '');
      var hash = 2166136261;
      for (var i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function addId(list, value) {
      if (typeof value !== 'string') return;
      var id = value.slice(0, 40);
      if (id && list.indexOf(id) < 0) list.push(id);
    }

    function sortedIds(values) {
      var list = [];
      (Array.isArray(values) ? values : []).forEach(function (value) { addId(list, value); });
      return list.sort();
    }

    function roundSeed(state) {
      return G.room + ':' + Number((state && state.round) || 1) + ':' +
        Number((state && state.wordIndex) || 0);
    }

    /* Один и тот же набор id и номер раунда даёт один и тот же выбор на всех
       клиентах: больше никаких Math.random() в выборе ведущего. */
    function pick(ids, seed) {
      var list = sortedIds(ids);
      if (!list.length) return '';
      return list[hash32(String(seed || '') + '|' + list.join('|')) % list.length];
    }

    /* Взвешенный, но детерминированный выбор: прошлый ведущий всё ещё имеет
       меньший вес, но результат одинаков у всех клиентов. */
    function weighted(ids, previousId, seed) {
      var list = sortedIds(ids);
      if (!list.length) return '';
      var weights = list.map(function (id) { return id === previousId ? 1 : 10; });
      var total = weights.reduce(function (sum, weight) { return sum + weight; }, 0);
      var ticket = hash32(String(seed || '') + '|' + list.join('|')) % total;
      for (var i = 0; i < list.length; i += 1) {
        ticket -= weights[i];
        if (ticket < 0) return list[i];
      }
      return list[list.length - 1];
    }

    function putFirst(queue, id) {
      var list = sortedIds(queue);
      var index = list.indexOf(id);
      if (index > 0) {
        list.splice(index, 1);
        list.unshift(id);
      } else if (index < 0) {
        list.unshift(id);
      }
      return list;
    }

    /* Если две копии состояния одного раунда называют разных ведущих,
       обе приводятся к одному детерминированному id. Не используем локальные
       myId/presence: их наборы у клиентов разные, а значит выбор снова разошёлся бы. */
    function resolveDrawer(local, incoming) {
      if (!local || !incoming || !local.round || !incoming.round) return false;
      if (Number(local.round) !== Number(incoming.round)) return false;
      var beforeLocal = String(local.drawer || '');
      var beforeIncoming = String(incoming.drawer || '');
      if (beforeLocal && beforeLocal === beforeIncoming) return false;

      var candidates = [];
      (local.queue || []).forEach(function (id) { addId(candidates, id); });
      (incoming.queue || []).forEach(function (id) { addId(candidates, id); });
      addId(candidates, beforeLocal);
      addId(candidates, beforeIncoming);
      addId(candidates, local.bgBy);
      addId(candidates, incoming.bgBy);
      if (!candidates.length) {
        if (beforeLocal && !beforeIncoming) incoming.drawer = beforeLocal;
        else if (beforeIncoming && !beforeLocal) local.drawer = beforeIncoming;
        return beforeLocal !== beforeIncoming;
      }

      var winner = pick(candidates, 'drawer:' + roundSeed(local));
      local.drawer = winner;
      incoming.drawer = winner;
      local.queue = putFirst(local.queue, winner);
      incoming.queue = putFirst(incoming.queue, winner);
      return beforeLocal !== winner || beforeIncoming !== winner;
    }

    /* Сравнение копий состояния без опоры на системные часы. Раньше свежесть
       решал локальный Date.now(): при разнице часов Китай/Россия каждая
       сторона отклоняла чужую копию и оставалась при своём ведущем. Теперь
       сначала сравнивается номер версии, затем детерминированный id автора. */
    function signature(state) {
      return [
        Number(state && state.round) || 0,
        Number(state && state.wordIndex) || 0,
        Number(state && state.rev) || 0,
        String((state && state.drawer) || ''),
        String((state && state.updatedBy) || ''),
        String((state && state.bgBy) || ''),
        Number(state && state.startedAt) || 0,
        Number(state && state.deadline) || 0,
        Array.isArray(state && state.messages) ? state.messages.length : 0,
        Array.isArray(state && state.queue) ? state.queue.join(',') : ''
      ].join('|');
    }

    /* 1 — incoming wins, -1 — local wins, 0 — копии эквивалентны. */
    function compareState(local, incoming) {
      if (!local) return 1;
      if (!incoming) return -1;
      var localRound = Number(local.round) || 0;
      var incomingRound = Number(incoming.round) || 0;
      if (incomingRound !== localRound) return incomingRound > localRound ? 1 : -1;
      var localRev = Number(local.rev) || 0;
      var incomingRev = Number(incoming.rev) || 0;
      if (incomingRev !== localRev) return incomingRev > localRev ? 1 : -1;
      var localBy = String(local.updatedBy || local.drawer || '');
      var incomingBy = String(incoming.updatedBy || incoming.drawer || '');
      if (incomingBy !== localBy) return incomingBy < localBy ? 1 : -1;
      var localHash = hash32(signature(local));
      var incomingHash = hash32(signature(incoming));
      if (incomingHash !== localHash) return incomingHash < localHash ? 1 : -1;
      return 0;
    }

    /* Пока настоящий художник виден и соединён, никто не может забрать у него
       ход посреди раунда. Законная смена приходит только с новым раундом или
       паузой/уходом; всё остальное — задержанная или чужая копия. */
    function guardActiveDrawer(local, incoming, ctx) {
      if (!local || !incoming || !ctx || !ctx.visibleDrawer) return false;
      var localDrawer = String(local.drawer || '');
      if (!localDrawer || String(incoming.drawer || '') === localDrawer) return false;
      if (Number(incoming.round) !== Number(local.round)) return false;
      if (incoming.reveal || incoming.hitInfo) return false;
      return true;
    }

    /* Возвращаем чужую копию в наш раунд, но сохраняем все остальные данные
       (чат, очки, реакции). Рев повышаем, чтобы эта копия победила у всех. */
    function sanitizeDrawer(local, incoming) {
      var copy = Object.assign({}, incoming);
      copy.drawer = local.drawer;
      copy.queue = (local.queue || []).slice();
      copy.bg = local.bg;
      copy.bgBy = local.bgBy;
      copy.rev = Math.max(Number(incoming.rev) || 0, Number(local.rev) || 0) + 1;
      copy.updatedBy = String(local.updatedBy || local.drawer || '');
      copy.updatedAt = Date.now();
      return copy;
    }

    G.consensusHash = hash32;
    G.consensusPick = pick;
    G.consensusWeightedDrawerId = weighted;
    G.consensusResolveDrawer = resolveDrawer;
    G.consensusCompareState = compareState;
    G.consensusGuardActiveDrawer = guardActiveDrawer;
    G.consensusSanitizeDrawer = sanitizeDrawer;
  }
})(window.KROKO_GAME);
