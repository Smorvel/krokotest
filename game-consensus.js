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
      /* Подписанное исправление хода от живого художника должно догнать
         клиент, который успел себе назначить новый раунд с чужим ведущим. */
      var defense = turnDefense(incoming);
      if (defense && Number(incoming.rev) > Number(local.rev || 0)) return 1;
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
       ход посреди раунда. Защита работает и для «подозрительного» нового
       раунда: новый игрок с задержанным presence не вправе переводить ход без
       паузы и без подписи ушедшего художника. */
    function guardActiveDrawer(local, incoming, ctx) {
      if (!local || !incoming || !ctx || !ctx.visibleDrawer) return false;
      var localDrawer = String(local.drawer || '');
      if (!localDrawer || String(incoming.drawer || '') === localDrawer) return false;
      if (incoming.reveal || incoming.hitInfo) return false;
      var localRound = Number(local.round) || 0;
      var incomingRound = Number(incoming.round) || 0;
      var delta = incomingRound - localRound;
      if (delta === 0) return true;
      /* Новый раунд от самого художника (или банившего его создателя) —
         законная смена. Всё остальное — попытка перехвата хода. */
      if (delta === 1) {
        var author = String(incoming.updatedBy || incoming.drawer || '');
        if (author === localDrawer) return false;
        /* Пауза уже объявила лидера завершения: такой новый раунд законен,
           даже если его публикует не сам художник (скрытая вкладка ведущего
           не должна блокировать смену хода). */
        if (local.reveal && local.reveal.rotatedBy) return false;
        if (Array.isArray(incoming.bans) && incoming.bans.indexOf(localDrawer) >= 0) return false;
        return true;
      }
      return false;
    }

    function turnDefense(copy) {
      var defense = copy && copy.turnDefense;
      if (!defense || typeof defense !== 'object') return null;
      var round = Number(defense.round) || 0;
      var drawer = String(defense.drawer || '');
      if (!round || !drawer) return null;
      if (Number(copy.round) !== round || String(copy.drawer || '') !== drawer) return null;
      if (Number(copy.rev) < Number(defense.rev || 0)) return null;
      return { round: round, drawer: drawer, rev: Number(copy.rev) || 0 };
    }

    /* Подписанное исправление хода имеет право перебить даже более старый
       round: клиент-перехватчик мог успеть объявить новый раунд раньше, чем
       пришла поправка от настоящего ведущего. */
    function acceptsSignedDefense(local, incoming) {
      var defense = turnDefense(incoming);
      return !!defense && Number(incoming.rev) > Number((local && local.rev) || 0);
    }

    /* retained-state без свежего retained-presence не означает пустую комнату.
       fast-таймер в 900мс применяем только когда ведущий — мы сами, он явно
       ушёл или его presence уже получено в этой сессии. */
    function needsFullTurnGrace(local, ctx) {
      if (!local || !local.drawer || !ctx) return false;
      if (local.drawer === ctx.myId) return false;
      if (ctx.drawerOffline || ctx.drawerMissingSince) return false;
      if (ctx.drawerPresent || ctx.drawerLiveHere) return false;
      return true;
    }

    /* Часовые метки состояния пишутся часами автора. Если у одного игрока
       часы ушли вперёд на 30 секунд, он заканчивает раунд сразу после его
       старта и «Время вышло!» появляется снова и снова. Источник длительности
       — разница deadline - updatedAt внутри одной и той же копии: она не
       зависит от сдвига часов. При получении копии запоминаем её локальный
       момент, а затем все таймеры считаем уже по локальным часам. */
    /* Если метки автора уже давно не соответствуют локальным часам, их
       длительность больше нельзя использовать для запуска нового раунда. */
    var CLOCK_WINDOW_MS = 5 * 60 * 1000;
    var clockCache = {
      sig: '', deadlineAt: 0, usable: true,
      revealKey: '', revealUntil: 0, revealKnown: false
    };

    /* Ключ не включает rev/updatedAt: одна и та же пауза или один и тот же
       дедлайн могут быть переопубликованы позже другим игроком. Привязка к
       локальным часам должна сохраняться, иначе сдвиг вернётся. */
    function clockSignature(state) {
      if (!state) return '';
      return [
        Number(state.round) || 0,
        Number(state.wordIndex) || 0,
        Number(state.startedAt) || 0,
        Number(state.deadline) || 0
      ].join('|');
    }

    function revealKey(reveal) {
      if (!reveal || !Number(reveal.until)) return '';
      return String(reveal.id || '') + '|' + Number(reveal.until);
    }

    function noteStateClock(raw, retained) {
      if (!raw || typeof raw !== 'object') return;
      var sig = clockSignature(raw);
      if (!sig) return;
      var now = Date.now();
      var updatedAt = Number(raw.updatedAt) || 0;
      var age = updatedAt ? now - updatedAt : CLOCK_WINDOW_MS + 1;
      /* Слишком старая или слишком «будущая» копия не даёт права отсчитывать
         новый раунд: иначе задержанный retained-state снова показывает
         «Время вышло!» при каждом переподключении. Retained-копию принимаем
         только в узком окне: настоящая игра шлёт state без retain. */
      var window = retained ? 60 * 1000 : CLOCK_WINDOW_MS;
      var sameRound = sig === clockCache.sig;
      clockCache.usable = age >= -window && age <= window;
      if (!sameRound) {
        clockCache.sig = sig;
        var deadline = Number(raw.deadline) || 0;
        var span = deadline && updatedAt ? deadline - updatedAt : 0;
        clockCache.deadlineAt = clockCache.usable && span >= 0
          ? now + Math.min(span, 24 * 60 * 60 * 1000)
          : now;
      } else if (!clockCache.usable) {
        clockCache.deadlineAt = now;
      }
      var reveal = raw.reveal;
      var until = reveal && Number(reveal.until) || 0;
      var key = revealKey(reveal);
      var revealSpan = until && updatedAt ? until - updatedAt : 0;
      /* Ключ не включает updatedAt: одна и та же пауза может быть
         переопубликована позже. Возвращаем зафиксированное локальное время
         даже когда оно равно нулю — так просроченная пауза не оживает. */
      if (!key || !clockCache.revealKnown || key !== clockCache.revealKey) {
        clockCache.revealKey = key;
        clockCache.revealKnown = !!key;
        clockCache.revealUntil = clockCache.usable && key && revealSpan >= 0
          ? now + Math.min(revealSpan, 5000)
          : 0;
      } else if (!clockCache.usable) {
        clockCache.revealUntil = 0;
      }
    }

    function localDeadline(state) {
      if (!state) return 0;
      if (clockCache.sig === clockSignature(state)) return clockCache.deadlineAt || Date.now();
      return Number(state.deadline) || 0;
    }

    function localRevealUntil(state) {
      if (!state || !state.reveal) return 0;
      var key = revealKey(state.reveal);
      if (key && clockCache.revealKnown && key === clockCache.revealKey) {
        return clockCache.revealUntil;
      }
      return Number(state.reveal.until) || 0;
    }

    function clockKnown(state) {
      return !!state && !!clockCache.sig && clockCache.sig === clockSignature(state);
    }

    /* Возвращаем чужую копию в наш раунд, но сохраняем чат, очки и реакции.
       Если ход пытались перевести на новый раунд, восстанавливаем все поля,
       которые описывают текущий раунд, и ставим подпись защиты: она позволяет
       остальным клиентам принять исправление даже после чужих round+1. */
    function sanitizeDrawer(local, incoming) {
      var copy = Object.assign({}, incoming);
      var sameRound = Number(incoming.round) === Number(local.round) &&
        Number(incoming.wordIndex) === Number(local.wordIndex);
      copy.drawer = local.drawer;
      copy.queue = (local.queue || []).slice();
      copy.bg = local.bg;
      copy.bgBy = local.bgBy;
      if (!sameRound) {
        copy.round = Number(local.round) || 1;
        copy.wordIndex = Number(local.wordIndex) || 0;
        ['startedAt', 'deadline', 'remainingMs', 'roundMs', 'savedRoundMs',
          'pendingRoundMs', 'pendingRoundMsAt', 'pausedUntil', 'expiredAt',
          'hintStage', 'hintSent', 'hintsDisabled', 'waitingForPlayers'
        ].forEach(function (key) { copy[key] = local[key]; });
        copy.reveal = local.reveal ? Object.assign({}, local.reveal) : null;
        copy.hitInfo = local.hitInfo ? Object.assign({}, local.hitInfo) : null;
        copy.lastWord = local.lastWord ? Object.assign({}, local.lastWord) : null;
        copy.hintLetters = local.hintLetters ? Object.assign({}, local.hintLetters) : {};
      }
      copy.rev = Math.max(Number(incoming.rev) || 0, Number(local.rev) || 0) + 1;
      copy.updatedBy = String(local.updatedBy || local.drawer || '');
      copy.updatedAt = Date.now();
      copy.turnDefense = {
        round: Number(local.round) || 1,
        drawer: String(local.drawer || ''),
        rev: copy.rev,
        by: copy.updatedBy,
        at: copy.updatedAt
      };
      return copy;
    }

    G.consensusHash = hash32;
    G.consensusPick = pick;
    G.consensusWeightedDrawerId = weighted;
    G.consensusResolveDrawer = resolveDrawer;
    G.consensusCompareState = compareState;
    G.consensusGuardActiveDrawer = guardActiveDrawer;
    G.consensusSanitizeDrawer = sanitizeDrawer;
    G.consensusAcceptsSignedDefense = acceptsSignedDefense;
    G.consensusNeedsFullTurnGrace = needsFullTurnGrace;
    G.consensusNoteStateClock = noteStateClock;
    G.consensusLocalDeadline = localDeadline;
    G.consensusLocalRevealUntil = localRevealUntil;
    G.consensusClockKnown = clockKnown;
  }
})(window.KROKO_GAME);
