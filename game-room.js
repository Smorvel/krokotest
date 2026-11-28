/* Permissions, bans, round state and turn transitions. */
(function (G) {
  with (G) {
    function isCreator() {
      if (!meta) return false;
      /* Если в комнате сохранён ID создателя, следующий за него отпечаток
         браузера прав не даёт: иначе приватная вкладка того же браузера
         считала бы себя создателем и создавала вторую игру. */
      if (meta.creatorId) return meta.creatorId === myId;
      return !!(meta.creatorFingerprint && meta.creatorFingerprint === myFingerprint);
    }
  
    function isIdBanned(id) {
      return K.isBanned(state, id);
    }
  
    function isFingerprintBanned(fingerprint) {
      if (!fingerprint) return false;
      var records = state && Array.isArray(state.banRecords) ? state.banRecords : [];
      return records.some(function (record) { return record && record.fingerprint && record.fingerprint === fingerprint; });
    }
  
    function isPlayerBanned(player) {
      if (!player) return false;
      return isIdBanned(player.id) || isFingerprintBanned(player.fingerprint);
    }
  
    function isBannedMe() {
      if (isCreator()) return false;
      return isIdBanned(myId) || isFingerprintBanned(myFingerprint);
    }
  
    function isHitPaused() {
      return !!(state && (state.hitInfo || (state.pausedUntil && Date.now() < state.pausedUntil)));
    }

    /* Единые часы раунда. Пока идёт игра, источник времени — абсолютный
       deadline из state. На паузе/раскрытии оставшееся время фиксируется в
       remainingMs, поэтому таймер не убегает вперёд и не зависит от локально
       выбранного startedAt. */
    function roundDeadline() {
      if (!state) return 0;
      var deadline = Number(state.deadline) || 0;
      if (deadline) {
        if (typeof consensusLocalDeadline === 'function') {
          var localDeadlineAt = consensusLocalDeadline(state);
          if (localDeadlineAt) return localDeadlineAt;
        }
        return deadline;
      }
      if (!Number(state.roundMs)) return 0;
      return (Number(state.startedAt) || 0) + Number(state.roundMs);
    }

    function remainingRoundMs() {
      if (!state || !Number(state.roundMs)) return 0;
      if (state.reveal || isHitPaused()) return Math.max(0, Number(state.remainingMs) || 0);
      var deadline = roundDeadline();
      return deadline ? Math.max(0, deadline - Date.now()) : 0;
    }

    function resetRoundTimer() {
      if (!state) return;
      state.startedAt = Date.now();
      state.deadline = Number(state.roundMs) ? state.startedAt + Number(state.roundMs) : 0;
      state.remainingMs = 0;
      state.pausedUntil = 0;
    }

    function pauseRoundTimer() {
      if (!state) return;
      var left = remainingRoundMs();
      state.remainingMs = left;
      state.deadline = 0;
      state.pausedUntil = 0;
    }

    function normalizeReveal(raw, state) {
      if (!raw || typeof raw !== 'object') return null;
      var value = {
        id: String(raw.id || ''),
        word: String(raw.word || ''),
        round: Number(raw.round) || 0,
        until: Number(raw.until) || 0,
        reason: String(raw.reason || ''),
        guesserId: String(raw.guesserId || ''),
        guesserName: String(raw.guesserName || ''),
        /* Явный выход ведущего: уход подтверждён, ждать его presence ещё раз
           не нужно, раунд завершается сразу после паузы со словом. */
        leave: !!raw.leave,
        /* Метка лидера, который завершает паузу. Без неё два видимых игрока
           могли одновременно перевести раунд после возврата вкладки. */
        rotatedBy: typeof raw.rotatedBy === 'string' ? raw.rotatedBy : ''
      };
      if (!value.id || !value.word || !value.until) return null;
      /* Просроченное раскрытие ещё нужно, чтобы завершить раунд. Раньше оно
       выбрасывалось сразу после until, поэтому состояние застывало на 0.
       При сдвиге часов until может быть «давним», хотя пауза только началась:
       сверяемся с локальной привязкой из consensus. */
      var mapped = 0;
      if (typeof consensusLocalRevealUntil === 'function' && state) {
        mapped = consensusLocalRevealUntil({
          reveal: { id: value.id, until: value.until },
          updatedAt: Number(state.updatedAt) || 0
        });
      }
      var known = typeof consensusClockKnown === 'function' && consensusClockKnown(state);
      if (!value.until) return null;
      if (!mapped && known) return null;
      if (mapped && mapped < Date.now() - 30000 && value.until < Date.now() - 30000) return null;
      return value;
    }

    function migrateStroke(stroke) {
      if (!stroke || typeof stroke !== 'object') return null;
      var sw = Number(stroke.cw) || 1000;
      var sh = Number(stroke.ch) || 750;
      if (sw === canvas.width && sh === canvas.height) {
        stroke.cw = sw;
        stroke.ch = sh;
        return stroke;
      }
      var scale = Math.min(canvas.width / sw, canvas.height / sh);
      var dx = (canvas.width - sw * scale) / 2;
      var dy = (canvas.height - sh * scale) / 2;
      if (Array.isArray(stroke.points)) {
        stroke.points = stroke.points.map(function (point) {
          if (!point || typeof point !== 'object') return point;
          return Object.assign({}, point, {
            x: (Number(point.x) || 0) * scale + dx,
            y: (Number(point.y) || 0) * scale + dy
          });
        });
      }
      stroke.cw = canvas.width;
      stroke.ch = canvas.height;
      stroke.migratedFrom = sw + 'x' + sh;
      return stroke;
    }

    function normalizeState(data) {
      var s = data || {};
      var dictionary = s.dictionary && Array.isArray(s.dictionary.words) && s.dictionary.words.length
        ? s.dictionary
        : getDictionary();
      s.v = 3;
      s.round = Number(s.round) || 1;
      s.wordIndex = Number(s.wordIndex) || 0;
      s.startedAt = Number(s.startedAt) || Date.now();
      var roundMs = Number(s.roundMs);
      s.roundMs = isFinite(roundMs) && roundMs >= 0 && roundMs <= MAX_ROUND_MS ? roundMs : DEFAULT_ROUND_MS;
      /* Смена длительности в настройках вступает в силу только со следующего
         раунда: текущий таймер и подсказки живут по старому значению. */
      var pendingRoundMs = Number(s.pendingRoundMs);
      s.pendingRoundMs = isFinite(pendingRoundMs) && pendingRoundMs >= 0 && pendingRoundMs <= MAX_ROUND_MS
        ? pendingRoundMs : 0;
      s.pendingRoundMsAt = Number(s.pendingRoundMsAt) || 0;
      var savedRoundMs = Number(s.savedRoundMs);
      s.savedRoundMs = isFinite(savedRoundMs) && savedRoundMs >= 0 && savedRoundMs <= MAX_ROUND_MS ? savedRoundMs : 0;
      s.deadline = Number(s.deadline) || 0;
      s.remainingMs = Number(s.remainingMs) || 0;
      /* Общее состояние никогда не несёт рисунок и его версию. Источник
         холста — только canvas/<round> и stroke/<id>. */
      s.strokes = [];
      s.canvasSeq = 0;
      s.messages = Array.isArray(s.messages) ? s.messages.slice(-50) : [];
      s.scores = s.scores && typeof s.scores === 'object' ? s.scores : {};
      s.reactions = s.reactions && typeof s.reactions === 'object'
        ? Object.keys(s.reactions).reduce(function (acc, id) {
            var raw = s.reactions[id] || {};
            var value = raw.value === 'like' || raw.value === 'dislike'
              ? raw.value
              : (Array.isArray(raw.likes) && raw.likes.length
                ? 'like'
                : (Array.isArray(raw.dislikes) && raw.dislikes.length ? 'dislike' : ''));
            var previous = raw.lastValue === 'like' || raw.lastValue === 'dislike' ? raw.lastValue : value;
            acc[id] = {
              value: value,
              lastValue: previous,
              by: typeof raw.by === 'string' ? raw.by : '',
              at: Number(raw.at) || 0
            };
            return acc;
          }, {})
        : {};
      s.hintsDisabled = !!s.hintsDisabled;
      s.queue = Array.isArray(s.queue) ? s.queue.filter(function (id) { return typeof id === 'string'; }) : [];
      s.bans = Array.isArray(s.bans) ? s.bans.filter(function (id) { return typeof id === 'string'; }) : [];
      s.banRecords = Array.isArray(s.banRecords) ? s.banRecords.filter(function (r) { return r && r.id; }) : [];
      s.dictionaryIds = Array.isArray(s.dictionaryIds) && s.dictionaryIds.length
        ? s.dictionaryIds.filter(function (id) { return typeof id === 'string'; })
        : [dictionary.id];
      if (!s.dictionaryIds.length) s.dictionaryIds = [dictionary.id];
      s.dictionaryPool = Array.isArray(s.dictionaryPool)
        ? s.dictionaryPool.filter(function (dict) {
            return dict && dict.id && dict.name && Array.isArray(dict.words) && dict.words.length;
          }).map(function (dict) {
            return { id: dict.id, name: dict.name, words: dict.words.slice(0, K.MAX_DICTIONARY_WORDS) };
          })
        : [];
      if (!s.dictionaryPool.length) {
        s.dictionaryPool = dictionariesByIds(s.dictionaryIds).map(function (dict) {
          return { id: dict.id, name: dict.name, words: dict.words.slice(0, K.MAX_DICTIONARY_WORDS) };
        });
      }
      s.wordHistory = Array.isArray(s.wordHistory) ? s.wordHistory.slice(-HISTORY_LIMIT) : [];
      s.guessedWords = Array.isArray(s.guessedWords) ? s.guessedWords : [];
      s.dictionary = { id: dictionary.id, name: dictionary.name, words: dictionary.words.slice(0, K.MAX_DICTIONARY_WORDS) };
      s.bg = typeof s.bg === 'string' ? s.bg : (tool.bg || '#252932');
      s.bgBy = typeof s.bgBy === 'string' ? s.bgBy : '';
      s.drawer = typeof s.drawer === 'string' ? s.drawer : '';
      s.pausedUntil = Number(s.pausedUntil) || 0;
      s.hitInfo = s.hitInfo && typeof s.hitInfo === 'object' ? s.hitInfo : null;
      s.reveal = normalizeReveal(s.reveal, s);
      s.lastWord = normalizeReveal(s.lastWord, s);
      s.hintSent = !!s.hintSent;
      var hintStage = Number(s.hintStage);
      s.hintStage = isFinite(hintStage) ? Math.max(0, Math.min(3, Math.round(hintStage))) : 0;
      var rawHints = s.hintLetters && typeof s.hintLetters === 'object' ? s.hintLetters : {};
      s.hintLetters = {};
      Object.keys(rawHints).forEach(function (key) {
        if (Array.isArray(rawHints[key])) {
          s.hintLetters[key] = rawHints[key]
            .map(function (value) { return Number(value) || 0; })
            .filter(function (value) { return value > 0; });
        }
      });
      s.systemEvents = Array.isArray(s.systemEvents)
        ? s.systemEvents.filter(function (event) {
            return event && event.id && event.text && (Number(event.at) || 0) > Date.now() - SYSTEM_NOTICE_MS - 1000;
          }).slice(-8).map(function (event) {
            return { id: String(event.id), text: String(event.text), at: Number(event.at) || 0 };
          })
        : [];
      s.waitingForPlayers = !!s.waitingForPlayers;
      s.expiredAt = Number(s.expiredAt) || 0;
      s.updatedAt = Number(s.updatedAt) || 0;
      s.updatedBy = s.updatedBy || '';
      /* Монотонный номер публикации: в отличие от updatedAt, не зависит от
         системных часов и позволяет всем клиентам выбрать одну копию state. */
      s.rev = Math.max(0, Math.floor(Number(s.rev) || 0));
      return s;
    }

    function strokeIds(strokes) {
      return (strokes || []).map(function (stroke) { return String(stroke && stroke.id || ''); });
    }

    /* Состояние от другого игрока может быть основано на устаревшей копии.
       Сливаем события, чтобы сообщения и раскрытие слова не исчезали. */
    function mergeState(incoming, previous) {
      var changed = false;
      if (!previous) return { state: incoming, changed: false };
      /* Задержанные копии отсекаются сетевым обработчиком по updatedAt.
         Здесь мы берём более свежую публикацию как источник комнаты: два
         рассинхронизированных клиента должны сходиться на одном состоянии,
         а не каждый возвращать себе «своего» художника. */
      var sameRound = Number(incoming.round) === Number(previous.round) &&
        Number(incoming.wordIndex) === Number(previous.wordIndex);

      var byId = {};
      var messages = [];
      (incoming.messages || []).slice().sort(function (a, b) { return (Number(b.at) || 0) - (Number(a.at) || 0); })
        .concat((previous.messages || []).slice().sort(function (a, b) { return (Number(b.at) || 0) - (Number(a.at) || 0); }))
        .forEach(function (message) {
          if (!message || !message.id || byId[message.id]) return;
          byId[message.id] = true;
          messages.push(message);
        });
      messages.sort(function (a, b) { return (Number(a.at) || 0) - (Number(b.at) || 0); });
      var oldMessageIds = (incoming.messages || []).map(function (m) { return m.id; }).sort().join(',');
      incoming.messages = messages.slice(-50);
      if (oldMessageIds !== incoming.messages.map(function (m) { return m.id; }).sort().join(',')) changed = true;

      var reactions = incoming.reactions || {};
      Object.keys(previous.reactions || {}).forEach(function (id) {
        var old = previous.reactions[id];
        var current = reactions[id];
        /* value:'' — осознанное снятие реакции, а не отсутствие данных.
           Такую запись нельзя «восстановить» старой копией состояния. */
        if (old && old.value && !current) {
          reactions[id] = old;
          changed = true;
        }
      });
      incoming.reactions = reactions;

      /* Системные подсказки живут очень коротко, но не должны теряться из-за
         задержанной копии состояния. */
      var seenNoticeIds = {};
      var systemEvents = [];
      (incoming.systemEvents || []).concat(previous.systemEvents || [])
        .slice()
        .sort(function (a, b) { return (Number(b && b.at) || 0) - (Number(a && a.at) || 0); })
        .forEach(function (event) {
          if (!event || !event.id || seenNoticeIds[event.id]) return;
          if ((Number(event.at) || 0) < Date.now() - SYSTEM_NOTICE_MS - 1000) return;
          seenNoticeIds[event.id] = true;
          systemEvents.push(event);
        });
      systemEvents.reverse();
      if (systemEvents.length > 8) systemEvents = systemEvents.slice(-8);
      incoming.systemEvents = systemEvents;

      var scores = incoming.scores || {};
      Object.keys(previous.scores || {}).forEach(function (name) {
        if ((Number(previous.scores[name]) || 0) > (Number(scores[name]) || 0)) {
          scores[name] = previous.scores[name];
          changed = true;
        }
      });
      incoming.scores = scores;

      /* Версия и штрихи живут только в canvas/<round> и stroke/<id>.
         В пределах раунда копия state сохраняет локальный холст. Новый раунд
         обнуляет его сразу, иначе старый снимок с высоким seq заблокирует
         свежий пустой холст с seq=0. */
      if (Number(incoming.round) === Number(previous.round)) {
        incoming.strokes = (previous.strokes || []).slice();
        incoming.canvasSeq = Number(previous.canvasSeq) || 0;
      } else {
        incoming.strokes = [];
        incoming.canvasSeq = 0;
        changed = true;
      }

      /* Художник и номер раунда приходят из более свежей публикации.
         Раньше локальная копия возвращала себе старого ведущего, из-за чего
         два клиента навсегда расходились и каждый рисовал свою игру. */

      /* Фон задаёт текущий художник: чужие устаревшие копии его не перебивают. */
      if (sameRound && previous.bgBy && incoming.drawer === previous.bgBy &&
          incoming.updatedBy !== previous.bgBy && incoming.bgBy !== previous.bgBy &&
          incoming.bg !== previous.bg) {
        incoming.bg = previous.bg;
        incoming.bgBy = previous.bgBy;
        changed = true;
      }

      if (sameRound) {
        var guesses = (incoming.guessedWords || []).slice();
        (previous.guessedWords || []).forEach(function (key) {
          if (guesses.indexOf(key) < 0) { guesses.push(key); changed = true; }
        });
        incoming.guessedWords = guesses;

        var restoredPause = false;
        var previousUntil = typeof consensusLocalRevealUntil === 'function'
          ? (consensusLocalRevealUntil(previous) || 0)
          : 0;
        if (!previousUntil && previous.reveal) previousUntil = Number(previous.reveal.until) || 0;
        if (previous.reveal && previousUntil > Date.now() - 30000 && !incoming.reveal) {
          incoming.reveal = previous.reveal;
          incoming.hitInfo = null;
          restoredPause = true;
          changed = true;
        }
        if (!incoming.reveal && previous.hitInfo && !incoming.hitInfo &&
            Number(previous.hitInfo.at) > Number(incoming.hitInfo && incoming.hitInfo.at)) {
          incoming.hitInfo = previous.hitInfo;
          restoredPause = true;
          changed = true;
        }
        if (!incoming.reveal) {
          var paused = Math.max(Number(incoming.pausedUntil) || 0, Number(previous.pausedUntil) || 0);
          if (paused !== (Number(incoming.pausedUntil) || 0)) {
            incoming.pausedUntil = paused;
            restoredPause = true;
            changed = true;
          }
        }
        /* Часы раунда — часть общего состояния. На паузе держим локальный
           остаток; в обычном ходе берём более свежий deadline, чтобы задержанная
           копия не вернула секунды назад. */
        if (restoredPause && (previous.reveal || previous.hitInfo || previous.pausedUntil)) {
          incoming.remainingMs = Number(previous.remainingMs) || 0;
          incoming.deadline = Number(previous.deadline) || 0;
          changed = true;
        } else if (!incoming.reveal && !incoming.hitInfo && !previous.reveal && !previous.hitInfo &&
                   Number(incoming.roundMs)) {
          var incomingDeadline = Number(incoming.deadline) || 0;
          var previousDeadline = Number(previous.deadline) || 0;
          var usePrevious = previousDeadline && (!incomingDeadline ||
            Number(previous.updatedAt) > Number(incoming.updatedAt));
          if (usePrevious) {
            incoming.deadline = previousDeadline;
            incoming.remainingMs = Number(previous.remainingMs) || 0;
            changed = true;
          }
        }
        /* Отложенная смена длительности — часть настроек комнаты. Берём её
           только с более свежей меткой, иначе задержанный state отбросит
           настройку создателя. */
        var pendingAt = Number(incoming.pendingRoundMsAt) || 0;
        var previousPendingAt = Number(previous.pendingRoundMsAt) || 0;
        if (previousPendingAt > pendingAt) {
          incoming.pendingRoundMs = Number(previous.pendingRoundMs) || 0;
          incoming.pendingRoundMsAt = previousPendingAt;
          changed = true;
        }
      }
      return { state: incoming, changed: changed };
    }

    function isPlayerHidden(id) {
      if (id === myId) return !!document.hidden;
      var info = presence[id];
      return !!(info && info.hidden);
    }

    function presentPlayers() {
      var list = activePeers().slice();
      if (!isBannedMe() && !list.some(function (p) { return p.id === myId; })) {
        list.push({
          id: myId, name: profile.name, color: profile.color, avatar: profile.avatar, fingerprint: myFingerprint,
          joinedAt: sessionJoinedAt, ts: Date.now(), online: true, noDraw: !!noDraw,
          bgColor: tool.bg || profile.bgColor || '#252932', hidden: !!document.hidden
        });
      }
      return list.sort(function (a, b) { return (Number(a.joinedAt) || 0) - (Number(b.joinedAt) || 0); });
    }

    function visiblePresentPlayers() {
      return presentPlayers().filter(function (p) { return !isPlayerHidden(p.id); });
    }

    /* Живые собеседники отличаются от retained-призраков: обычный heartbeat
       считается свежим 15 секунд, а удержанное сообщение — только если его
       собственная метка времени ещё не устарела. */
    function activePeers() {
      var now = Date.now();
      return Object.keys(presence).map(function (id) { return presence[id]; }).filter(function (p) {
        if (!p || p.id === myId || p.id === leavingRoom || p.online === false || isPlayerBanned(p)) return false;
        if (now - (Number(p.receivedAt) || Number(p.seenAt) || 0) >= 15000) return false;
        if (p.retained && now - (Number(p.ts) || 0) > PRESENCE_TS_TTL_MS) return false;
        return true;
      });
    }

    function soloRoom() {
      return activePeers().length === 0;
    }

    /* Унаследованное «ждём» без ведущего — не живое ожидание, а оставшийся
       retained-след ушедшего игрока. Такую комнату надо начать заново, а не
       показывать чужой рисунок с вечным таймером ожидания. Retained-presence
       живого ведущего обновляется каждые 5 секунд, поэтому один только флаг
       retain не означает, что игрок ушёл: иначе гость стирал комнату при входе. */
    function abandonedWaitingRoom() {
      if (!state || !state.waitingForPlayers || state.reveal || isHitPaused() || document.hidden) return false;
      if (state.drawer === myId) return false;
      if ((typeof isSyncPending === 'function' && isSyncPending()) ||
          (presenceReadyAt && Date.now() < presenceReadyAt)) return false;
      return activePeers().length === 0;
    }
  
    function isDrawer() {
      return !sessionKicked && !!state && state.drawer === myId && !isBannedMe();
    }

    /* Ход, создатель и лидер завершения раунда ведут общее состояние.
       Обычный игрок не пересылает чужие копии state обратно: именно эти
       эхо-публикации создавали вечный ping-pong с новым updatedAt. */
    function isStatePublisher() {
      if (!state) return true;
      if (isDrawer() || isCreator()) return true;
      /* Раскрытие слова — общее событие: его должен опубликовать и тот, кто
         заметил окончание времени, даже если художник в скрытой вкладке. */
      if (state.reveal) return true;
      return !state.drawer;
    }

    /* Реакции идут отдельным retained-событием: иначе лайк/дизлайк ждёт,
       пока держатель state решит опубликовать очередь, и на медленном канале
       выглядит как «ужасно опаздывает». */
    function publishReactionEvent(id, value, previous) {
      if (sessionKicked || !state || !client || !client.connected || !id) return;
      var next = value === 'like' || value === 'dislike' ? value : '';
      K.publish(client, K.topic(room, 'reaction/' + id), {
        id: String(id),
        value: next,
        lastValue: next || (previous === 'like' || previous === 'dislike' ? previous : ''),
        by: myId,
        at: Date.now(),
        round: Number(state.round) || 1
      }, true);
    }

    function applyReactionEvent(data) {
      if (!state || !data || !data.id) return false;
      if (state.hitInfo || state.reveal) return false;
      var id = String(data.id);
      var value = data.value === 'like' || data.value === 'dislike' ? data.value : '';
      var at = Number(data.at) || 0;
      var old = state.reactions[id];
      if (old && Number(old.at) > at) return false;
      var last = value ||
        (data.lastValue === 'like' || data.lastValue === 'dislike' ? data.lastValue : '') ||
        (old && (old.lastValue || old.value)) || '';
      state.reactions[id] = {
        value: value,
        lastValue: last,
        by: typeof data.by === 'string' ? data.by : '',
        at: at || Date.now()
      };
      if (typeof renderMessages === 'function') renderMessages(true);
      return true;
    }

    function publishState(force) {
      /* Лидер завершения паузы может не быть ни художником, ни создателем.
         После перевода хода он теряет обычное право публикации, но последнюю
         публикацию нового раунда всё равно должен разослать: иначе остальные
         останутся на старом раунде с уже показанным словом. */
      if (sessionKicked || !state || !client || !client.connected || (!force && !isStatePublisher())) return;
      /* Пока идёт тихая сверка после возврата в вкладку, старый локальный
         художник не имеет права рассылать состояние и «отбирать» ход. */
      if (typeof isSyncPending === 'function' && isSyncPending()) return;
      state.rev = (Number(state.rev) || 0) + 1;
      state.updatedAt = Date.now();
      state.updatedBy = myId;
      /* Каждая публикация подписывает текущий раунд и его ведущего. Тогда
         задержанная подпись прошлого раунда не сможет вернуть ход ушедшему
         художнику после законной смены. */
      state.turnDefense = {
        round: Number(state.round) || 1,
        drawer: String(state.drawer || ''),
        rev: state.rev,
        by: myId,
        at: state.updatedAt
      };
      if (typeof consensusNoteStateClock === 'function') consensusNoteStateClock(state);
      /* Общее состояние НИКОГДА не несёт рисунок. Единственный источник
         холста — canvas/<round> и stroke/<id>. Раньше задержанная копия
         state от другого игрока могла обнулить штрихи и раунд. */
      var payload = Object.assign({}, state, { strokes: [], canvasSeq: 0 });
      K.publish(client, K.topic(room, 'state'), payload, true);
      if (typeof renderSync === 'function') renderSync();
    }

    /* Сообщение чата и факт угадывания публикуются отдельно от общего
       состояния: их нельзя потерять из-за устаревшей копии state. */
    function publishChatEvent(message, hit) {
      if (sessionKicked || !state || !client || !client.connected || !message || !message.id) return;
      K.publish(client, K.topic(room, 'chat/' + message.id), {
        round: state.round,
        message: message,
        hit: hit || null,
        at: Date.now()
      }, true);
    }

    function applyChatEvent(data) {
      if (!state || !data || !data.message || !data.message.id) return false;
      if (data.round && Number(data.round) !== Number(state.round)) return false;
      var changed = false;
      var id = data.message.id;
      if (seenChatIds[id]) return false;
      seenChatIds[id] = true;
      if (!state.messages.some(function (m) { return m.id === id; })) {
        state.messages.push(data.message);
        state.messages = state.messages.slice(-50);
        changed = true;
      }
      var hit = data.hit;
      if (hit) {
        (hit.guessedWords || []).forEach(function (key) {
          if (state.guessedWords.indexOf(key) < 0) {
            state.guessedWords.push(key);
            changed = true;
          }
        });
        if (hit.scoreName && hit.score) {
          var current = Number(state.scores[hit.scoreName]) || 0;
          if (Number(hit.score) > current) {
            state.scores[hit.scoreName] = Number(hit.score);
            changed = true;
          }
        }
        if (hit.hitInfo && !state.hitInfo) {
          state.hitInfo = hit.hitInfo;
          scheduleHitResolution(hit.hitInfo);
          changed = true;
        }
      }
      if (changed) {
        renderAll();
        if (isDrawer()) publishState();
      }
      return changed;
    }

    function publishPresence(online) {
      if (sessionKicked || !client || !client.connected) return;
      K.publish(client, K.topic(room, 'presence/' + myId), {
        id: myId,
        name: profile.name,
        color: profile.color,
        avatar: profile.avatar,
        fingerprint: myFingerprint,
        joinedAt: sessionJoinedAt,
        online: online !== false,
        noDraw: !!noDraw,
        bgColor: tool.bg || profile.bgColor || '#252932',
        hidden: !!document.hidden,
        ts: Date.now(),
        sessionTabId: G.sessionTabId || '',
        sessionClaimAt: Number(G.sessionClaimAt) || 0,
        sessionClaimSeq: Number(G.sessionClaimSeq) || 0
      }, true);
    }
  
    function publishDraft(stroke, discard) {
      if (sessionKicked || !client || !client.connected) return;
      var points = [];
      if (stroke && Array.isArray(stroke.points)) {
        /* Живой предпросмотр не должен забивать медленный канал: шлём не
           весь массив точек, а равномерно прореженный след. */
        var maxPoints = 120;
        var step = Math.max(1, Math.ceil(stroke.points.length / maxPoints));
        for (var i = 0; i < stroke.points.length; i += step) {
          points.push(stroke.points[i]);
        }
        var last = stroke.points[stroke.points.length - 1];
        if (last && points[points.length - 1] !== last) points.push(last);
        if (points.length > maxPoints) points = points.slice(-maxPoints);
      }
      K.publish(client, K.topic(room, 'draft/' + myId), {
        id: myId,
        owner: myId,
        stroke: stroke ? {
          id: stroke.id, owner: stroke.owner, tool: stroke.tool,
          color: stroke.color, size: stroke.size, alpha: stroke.alpha,
          smooth: stroke.smooth, shapeMode: stroke.shapeMode,
          points: points, bg: stroke.bg,
          cw: stroke.cw, ch: stroke.ch
        } : null,
        discard: !!discard,
        at: Date.now()
      }, true, 0);
    }

    /* Каждый завершённый штрих публикуется отдельно, но НЕ с retain: иначе
       на публичном брокере копятся тысячи тем и медленный канал залипает на
       старой истории. Новый игрок получает рисунок из retained canvas/<round>. */
    function publishStroke(stroke, seq) {
      if (sessionKicked || !state || !client || !client.connected || !stroke || !stroke.id) return;
      K.publish(client, K.topic(room, 'stroke/' + stroke.id), {
        round: state.round,
        seq: Number(seq) || Number(state.canvasSeq) || 0,
        owner: myId,
        stroke: stroke,
        at: Date.now()
      }, false);
    }

    function publishStrokeDeletion(id, seq) {
      if (sessionKicked || !state || !client || !client.connected || !id) return;
      K.publish(client, K.topic(room, 'stroke/' + id), {
        round: state.round,
        seq: Number(seq) || Number(state.canvasSeq) || 0,
        owner: myId,
        id: id,
        deleted: true,
        at: Date.now()
      }, false);
    }

    function applyStrokeEvent(data) {
      if (!state || !data) return false;
      if (!data.round || Number(data.round) !== Number(state.round)) return false;
      /* Штрихи и удаления принимаются только от текущего художника. Это
         главная защита от задержанного игрока, который рисует поверх нового. */
      if (state.drawer && data.owner !== state.drawer) return false;
      var seq = Number(data.seq) || 0;
      var id = String(data.id || (data.stroke && data.stroke.id) || '');
      if (!id) return false;
      var currentSeq = Number(state.canvasSeq) || 0;

      if (data.deleted) {
        deletedStrokes[id] = Math.max(Number(deletedStrokes[id]) || 0, seq);
        var before = state.strokes.length;
        state.strokes = state.strokes.filter(function (item) { return item.id !== id; });
        Object.keys(remoteDrafts).forEach(function (owner) {
          if (remoteDrafts[owner] && remoteDrafts[owner].id === id) delete remoteDrafts[owner];
        });
        if (pendingStrokes[id]) delete pendingStrokes[id];
        state.canvasSeq = Math.max(currentSeq, seq);
        if (state.strokes.length !== before) scheduleBaseRedraw();
        if (typeof renderSync === 'function') renderSync();
        return true;
      }

      if (!data.stroke || data.stroke.id !== id) return false;
      /* Задержанное сообщение об удалённом штрихе не должно вернуть его на
         холст после более свежего снимка или compaction. */
      if ((Number(deletedStrokes[id]) || 0) >= seq) return false;
      /* Завышенный seq в устаревшей копии состояния не должен заставлять
         клиент пропустить штрих. Повторное применение безопасно: штрихи
         уникальны по id и уже имеющиеся игнорируются ниже. */
      if (state.strokes.some(function (item) { return item.id === id; })) {
        state.canvasSeq = Math.max(currentSeq, seq);
        if (typeof renderSync === 'function') renderSync();
        return false;
      }
      var normalized = normalizeStroke(Object.assign({}, data.stroke));
      if (!normalized) return false;
      state.strokes.push(normalized);
      state.canvasSeq = Math.max(currentSeq, seq);
      Object.keys(remoteDrafts).forEach(function (owner) {
        if (remoteDrafts[owner] && remoteDrafts[owner].id === id) delete remoteDrafts[owner];
      });
      if (pendingStrokes[id]) delete pendingStrokes[id];
      scheduleBaseRedraw();
      if (typeof renderSync === 'function') renderSync();
      return true;
    }

    /* Полный упорядоченный снимок холста. Его публикует только художник,
       поэтому у всех игроков рано или поздно оказывается один и тот же набор
       штрихов, даже если отдельное событие штриха не дошло. */
    function publishCanvasSnapshot(force) {
      if (sessionKicked || !state || !client || !client.connected) return;
      if (!force && !isDrawer()) return;
      var seq = Number(state.canvasSeq) || 0;
      canvasRound = Number(state.round);
      canvasVersion = seq;
      canvasOwner = myId;
      K.publish(client, K.topic(room, 'canvas/' + state.round), {
        round: state.round,
        seq: seq,
        by: myId,
        strokes: state.strokes,
        at: Date.now()
      }, true);
      if (typeof renderSync === 'function') renderSync();
    }

    /* Полный снимок после каждого изменения: раз отдельные штрихи больше не
       retain, именно он гарантирует, что опоздавший игрок увидит весь рисунок.
       Небольшая задержка склеивает несколько быстрых штрихов в одну публикацию. */
    function scheduleCanvasSnapshot(delay) {
      if (sessionKicked || !state) return;
      if (canvasSnapshotTimer) clearTimeout(canvasSnapshotTimer);
      canvasSnapshotTimer = setTimeout(function () {
        canvasSnapshotTimer = null;
        publishCanvasSnapshot();
      }, Number(delay) || 400);
    }

    function applyCanvasSnapshot(data) {
      if (!state || !data || !Array.isArray(data.strokes)) return false;
      var round = Number(data.round) || 0;
      if (!round || round !== Number(state.round)) return false;
      var seq = Number(data.seq) || 0;
      if (isPlayerBanned({ id: data.by })) return false;
      /* Снимок подтверждает художника, но не назначает его заново: состояние
         всё равно остаётся единственным источником хода. Иначе задержанный
         retained-снимок мог вернуть рисование старому ведущему. */
      if (data.by) {
        if (canvasOwner && canvasOwner !== data.by) return false;
        canvasOwner = data.by;
        if (!state.drawer) state.drawer = data.by;
        var at = state.queue.indexOf(data.by);
        if (at > 0) { state.queue.splice(at, 1); state.queue.unshift(data.by); }
        else if (at < 0) state.queue.unshift(data.by);
      }
      /* Снимок публикует только ведущий, и он является окончательным
         источником холста. Но старый снимок, пришедший позже нового, обязан
         проигрывать — иначе он стирает свежие штрихи. */
      var minSeq = Number(state.canvasSeq) || 0;
      if (canvasRound === round) minSeq = Math.max(minSeq, Number(canvasVersion) || 0);
      if (seq < minSeq) return false;
      var strokes = data.strokes.filter(function (stroke) {
        var id = String(stroke && stroke.id || '');
        if (!id) return true;
        /* Штрих отсутствует в снимке, только если удаление произошло не позже
           этого снимка. Отсутствующая запись об удалении — штрих жив. */
        var deletedAt = Number(deletedStrokes[id]) || 0;
        return !deletedAt || deletedAt > seq;
      }).map(function (stroke) {
        return normalizeStroke(Object.assign({}, stroke));
      }).filter(Boolean);
      state.strokes = strokes;
      state.canvasSeq = seq;
      canvasRound = round;
      canvasVersion = seq;
      var ids = {};
      strokes.forEach(function (stroke) { ids[stroke.id] = true; });
      Object.keys(remoteDrafts).forEach(function (owner) {
        var draft = remoteDrafts[owner];
        if (draft && ids[draft.id]) delete remoteDrafts[owner];
      });
      scheduleBaseRedraw();
      scheduleDrafts();
      if (typeof renderSync === 'function') renderSync();
      return true;
    }
  
    function systemMessage(text) {
      if (!state || !text) return;
      var event = { id: K.uid(), text: String(text), at: Date.now() };
      state.systemEvents = (state.systemEvents || []).concat(event).slice(-8);
      if (typeof renderSystemFeed === 'function') renderSystemFeed();
    }

    /* Фон нового раунда задаёт сам художник, а не предыдущий ведущий. */
    function playerBackground(player) {
      var bg = player && (player.bgColor || (player.avatar && player.avatar.bg));
      return /^#[0-9a-f]{6}$/i.test(String(bg || '')) ? String(bg) : '#252932';
    }

    /* Случайный выбор с небольшим, но не нулевым шансом для только что
       рисовавшего: он не исключается из очереди, но не доминирует в ней. */
    function weightedDrawerId(ids, previousId, seed) {
      if (!ids.length) return '';
      var pool = ids.filter(function (id) { return !isIdBanned(id); });
      if (!pool.length) pool = ids.slice();
      if (typeof consensusWeightedDrawerId === 'function') {
        return consensusWeightedDrawerId(pool, previousId, seed);
      }
      var weights = pool.map(function (id) { return id === previousId ? 1 : 10; });
      var total = weights.reduce(function (sum, weight) { return sum + weight; }, 0);
      var ticket = Math.random() * total;
      for (var i = 0; i < pool.length; i += 1) {
        ticket -= weights[i];
        if (ticket < 0) return pool[i];
      }
      return pool[pool.length - 1];
    }
  
    function rotateDrawer(reason, nextDrawerId) {
      if (!state) return false;
      var rotationToken = Number(state.round) + ':' + Number(state.startedAt) + ':' +
        Number(state.wordIndex) + ':' + String(state.drawer || '');
      if (handledRotation === rotationToken) return false;
      /* Клиент, который только что переподключился, не переводит чужой ход
         посреди раунда: иначе свёрнутый iPhone забирал рисование у автора. */
      if (state.drawer && !isDrawer() && !state.reveal &&
          G.turnLockUntil && Date.now() < G.turnLockUntil) return false;
      /* Ход переводим только владелец хода или игрок, подтвердивший уход
         предыдущего художника. Завершение уже показанного слова — тоже
         законный повод: скрытая вкладка художника не должна блокировать раунд. */
      var revealUntil = typeof consensusLocalRevealUntil === 'function'
        ? (consensusLocalRevealUntil(state) || 0)
        : 0;
      if (!revealUntil && state.reveal) revealUntil = Number(state.reveal.until) || 0;
      var revealReady = !!(state.reveal && Date.now() >= revealUntil);
      if (state.drawer && !isDrawer() && !(state.reveal && state.reveal.leave) &&
          !revealReady && !drawerConfirmedGone(state.drawer)) return false;
      if (Date.now() - (Number(lastRotationAt) || 0) < 1500) return false;
      handledRotation = rotationToken;
      lastRotationAt = Date.now();
      if (canvasSnapshotTimer) {
        clearTimeout(canvasSnapshotTimer);
        canvasSnapshotTimer = null;
      }
      if (localDraft && isDrawer()) {
        commitStroke(localDraft);
        localDraft = null;
      }
      var active = activePeers();
      var players = active.concat(active.some(function (p) { return p.id === myId; }) ? [] : [{
        id: myId, name: profile.name, color: profile.color, avatar: profile.avatar, noDraw: !!noDraw,
        bgColor: tool.bg || profile.bgColor || '#252932', hidden: !!document.hidden
      }]);
      /* Угадавший становится следующим художником, только если он хочет
         рисовать. Иначе ход определяется случайно по общей очереди. Игрока
         без свежего presence не добавляем: по нему нельзя узнать, поставил
         ли он «не хочу рисовать». */
      var activeIds = players.map(function (p) { return p.id; });
      var ids = state.queue.filter(function (id) {
        return activeIds.indexOf(id) >= 0 && !isIdBanned(id) && !isFingerprintBanned(presence[id] && presence[id].fingerprint);
      });
      if (nextDrawerId && activeIds.indexOf(nextDrawerId) >= 0 && ids.indexOf(nextDrawerId) < 0) {
        ids.push(nextDrawerId);
      }
      var willing = ids.filter(function (id) {
        var player = players.filter(function (p) { return p.id === id; })[0];
        return !(player && player.noDraw);
      });
      var guesserWantsDraw = !!nextDrawerId && willing.indexOf(nextDrawerId) >= 0;
      var pool = willing.length ? willing : ids;
      var rotationSeed = state.round + ':' + state.startedAt + ':' + state.wordIndex;
      var nextId = guesserWantsDraw ? nextDrawerId : weightedDrawerId(pool, state.drawer, rotationSeed);
      if (!nextId) nextId = myId;
      var index = ids.indexOf(nextId);
      if (index > 0) {
        ids.splice(index, 1);
        ids.unshift(nextId);
      } else if (index < 0) {
        ids.unshift(nextId);
      }
      state.queue = ids;
      state.drawer = nextId;
      var nextPlayer = players.filter(function (p) { return p.id === nextId; })[0];
      state.bg = playerBackground(nextPlayer);
      state.bgBy = nextId;
      var endingAt = state.startedAt;
      chooseNextWord();
      state.round += 1;
      /* Ожидание второго игрока давало только минуту; следующий раунд снова
         живёт по обычной настройке комнаты. */
      if (Number(state.savedRoundMs)) {
        state.roundMs = Number(state.savedRoundMs);
        state.savedRoundMs = 0;
      }
      /* Настройка длительности, сделанная во время раунда, применяется здесь:
         новый раунд начинается уже с новым временем у всех игроков. */
      if (Number(state.pendingRoundMsAt)) {
        state.roundMs = Number(state.pendingRoundMs) || 0;
        state.pendingRoundMs = 0;
        state.pendingRoundMsAt = 0;
      }
      resetRoundTimer();
      Object.keys(rasterImages).forEach(function (id) { delete rasterImages[id]; });
      Object.keys(rasterBgCache).forEach(function (id) { delete rasterBgCache[id]; });
      rasterBgCacheKeys.length = 0;
      Object.keys(pendingStrokes).forEach(function (id) { delete pendingStrokes[id]; });
      /* Новый раунд — новый пустой холст, номер синхронизации начинается с нуля. */
      var clearSeq = 0;
      /* Чистим retained-мусор прошлого раунда прямо на брокере. Пустой payload
         удаляет тему, поэтому при переподключении клиент не скачивает старые
         штрихи и снимки — это главная причина медленной синхронизации. */
      if (client && client.connected) {
        state.strokes.forEach(function (stroke) {
          if (stroke && stroke.id) {
            client.publish(K.topic(room, 'stroke/' + stroke.id), '', { qos: 1, retain: true });
          }
        });
        var oldRound = Number(state.round) - 1;
        if (oldRound > 0) {
          client.publish(K.topic(room, 'canvas/' + oldRound), '', { qos: 1, retain: true });
        }
      }
      state.strokes = [];
      state.canvasSeq = clearSeq;
      canvasRound = 0;
      canvasVersion = 0;
      canvasOwner = '';
      pendingCanvas = null;
      futureStrokes = {};
      futureDeletions = {};
      deletedStrokes = {};
      seenChatIds = {};
      drawerMissingSince = 0;
      drawerOfflineAt = 0;
      state.hitInfo = null;
      state.reveal = null;
      state.lastWord = null;
      state.pausedUntil = 0;
      state.waitingForPlayers = false;
      state.expiredAt = 0;
      handledHitId = null;
      handledStart = endingAt;
      drawing = false;
      localDraft = null;
      remoteDrafts = {};
      publishDraft(null, true);
      scheduleBaseRedraw();
      scheduleDrafts();
      /* Пустой снимок нового раунда публикует только новый художник. Иначе
         снимок от старого ведущего назначил бы его художником всем игрокам. */
      if (state.drawer === myId) publishCanvasSnapshot(true);
      else {
        canvasRound = Number(state.round);
        canvasVersion = 0;
        canvasOwner = state.drawer;
      }
      return true;
    }

    function checkTimeout() {
      if (document.hidden || !state || state.reveal || isHitPaused() || state.roundMs === 0) return;
      var deadline = roundDeadline();
      if (!deadline || Date.now() < deadline) return;
      /* Конец времени определяется общим state.deadline, а не правом «взять
         ход»: скрытый художник не должен блокировать таймер у остальных. */
      if (handledStart === state.startedAt) return;

      /* В одиночке время не завершает раунд: игрок ждёт собеседника. Слово и
       рисунок остаются на месте, а счётчик показывает «0:00 · ждём». */
      if (soloRoom()) {
        handledStart = state.startedAt;
        state.waitingForPlayers = true;
        state.savedRoundMs = Number(state.roundMs) || 0;
        state.remainingMs = 0;
        state.deadline = 0;
        state.expiredAt = Date.now();
        publishState(true);
        renderAll();
        return;
      }

      /* Таймаут — такой же конец раунда, как угадывание: слово показывается
       всем, рисунок сохраняется, затем обычный переход к следующему ходу. */
      handledStart = state.startedAt;
      state.waitingForPlayers = false;
      state.expiredAt = 0;
      state.lastWord = null;
      state.hitInfo = null;
      beginReveal('Время вышло!',
        'timeout-' + state.round + ':' + state.startedAt, TIMEOUT_REVEAL_MS);
    }
  
    /* Возобновление раунда, который ждал второго игрока. Даём ровно минуту
       независимо от настройки длительности: так раунд не пропадает впустую. */
    function resumeWaitingRound() {
      if (!state || !state.waitingForPlayers || document.hidden) return;
      /* Retained-presence от уже ушедшего игрока не считаем приходом: раунд
         продолжается только когда в комнате действительно появился собеседник. */
      if (!activePeers().some(function (p) { return !p.retained; })) return;
      state.waitingForPlayers = false;
      state.expiredAt = 0;
      /* Новый отрезок ровно минута — подсказки отсчитываются заново. */
      state.roundMs = 60000;
      state.deadline = Date.now() + 60000;
      state.remainingMs = 0;
      state.hintStage = 0;
      state.hintLetters = {};
      state.hintSent = false;
      handledStart = 0;
      publishState(true);
      renderAll();
    }

    /* Псевдослучайный, но одинаковый у всех клиентов выбор буквы: иначе два
       видимых игрока могли бы открыть разные буквы и разойтись. */
    function hintPick(candidates, key, stage) {
      var seed = 2166136261;
      var input = String(key) + ':' + Number(state.round) + ':' +
        Number(state.wordIndex) + ':' + Number(stage);
      for (var i = 0; i < input.length; i += 1) {
        seed ^= input.charCodeAt(i);
        seed = (seed * 16777619) >>> 0;
      }
      return candidates[seed % candidates.length];
    }

    function revealHintStage(stage) {
      var revealed = state.hintLetters || (state.hintLetters = {});
      var seen = {};
      String(word() || '').split(/(\s+)/).forEach(function (part) {
        if (!part.trim()) return;
        var key = normToken(part);
        if (!key || seen[key]) return;
        seen[key] = true;
        var positions = (revealed[key] || []).slice();
        var candidates = [];
        for (var i = 0; i < part.length; i += 1) {
          if (!/[a-zа-яё0-9]/i.test(part.charAt(i))) continue;
          if (stage === 3) {
            if (i === 0 && positions.indexOf(i) < 0) candidates.push(i);
          } else if (i > 0 && positions.indexOf(i) < 0) {
            candidates.push(i);
          }
        }
        if (!candidates.length) return;
        var pick = stage === 3 ? candidates[0] : hintPick(candidates, key, stage);
        positions.push(pick);
        revealed[key] = positions;
      });
    }

    function issueHintIfNeeded() {
      if (document.hidden || !state || state.reveal || state.hintsDisabled ||
          state.waitingForPlayers || !state.roundMs || isHitPaused()) return;
      var left = remainingRoundMs();
      var ratio = left / Number(state.roundMs);
      var due = ratio <= 0.05 ? 3 : (ratio <= 0.20 ? 2 : (ratio <= 0.35 ? 1 : 0));
      var current = Number(state.hintStage) || 0;
      if (due <= current) return;
      for (var stage = current + 1; stage <= due; stage += 1) revealHintStage(stage);
      state.hintStage = due;
      state.hintSent = true;
      publishState(true);
      renderWord();
    }
  
    function showHitAnimation(info) {
      if (!info || !el.hitToast) return;
      el.hitToast.textContent = info.text || 'Угадали! +10 очков';
      el.hitToast.hidden = false;
      el.wrap.classList.remove('celebrate');
      void el.wrap.offsetWidth;
      el.wrap.classList.add('celebrate');
      if (hitTimer) clearTimeout(hitTimer);
      hitTimer = setTimeout(function () {
        el.hitToast.hidden = true;
        el.wrap.classList.remove('celebrate');
      }, HIT_PAUSE_MS);
    }
  
    /* «Нет presence» в медленном канале — ещё не значит «ушёл». В компании
       ход можно забрать только после подтверждённого отсутствия художника.
       В одиночку живущего ведущего быть не может, поэтому пустой раунд
       начинается сразу — иначе комната оставалась нерисуемой. */
    function drawerConfirmedGone(drawerId) {
      var id = drawerId || (state && state.drawer);
      if (!state || !id) return true;
      if (id === myId && isDrawer()) return false;
      /* Явный обрыв (завещание MQTT) — подтверждённый сигнал. Даже в одиночке
         ждём 5 секунд: ведущий мог просто обновить страницу и вернуться. */
      if (id === state.drawer && drawerOfflineAt) {
        return Date.now() - drawerOfflineAt >= DRAWER_OFFLINE_MS;
      }
      /* В одиночке ждём только короткий срок доставки retained-presence.
         Полный 15-секундный срок нужен лишь при живых собеседниках. */
      if (soloRoom()) {
        if (id === state.drawer && subscribedAt &&
            Date.now() - subscribedAt < SOLO_GRACE_MS) return false;
        return true;
      }
      if (presenceReadyAt && Date.now() < presenceReadyAt) return false;
      var present = activePeers().some(function (p) { return p.id === id; });
      if (present) {
        drawerMissingSince = 0;
        drawerSeenAt = Date.now();
        return false;
      }
      var info = presence[id];
      if (info && info.online === false) {
        if (!drawerMissingSince) drawerMissingSince = Date.now();
        return Date.now() - drawerMissingSince >= 5000;
      }
      if (!drawerMissingSince) drawerMissingSince = Date.now();
      return Date.now() - drawerMissingSince >= DRAWER_MISSING_GRACE_MS;
    }

    /* Если ведущий действительно пропал, ход берёт любой присутствующий игрок,
       а не только создатель. Иначе «пустой» раунд висел без художника. */
    function isTurnAuthority() {
      if (!state) return false;
      if (isDrawer()) return true;
      /* Сверка после переподключения/возврата в вкладку не даёт прав на ход. */
      if (G.turnLockUntil && Date.now() < G.turnLockUntil) return false;
      if (typeof isSyncPending === 'function' && isSyncPending()) return false;
      if (state.reveal && state.reveal.leave) return true;
      if (!drawerConfirmedGone()) return false;
      return presentPlayers().some(function (p) { return p.id === myId; });
    }

    /* Завершение паузы со словом не зависит от «живости» художника: им может
       заниматься любой видимый игрок. Один ведущий выбирается ниже, чтобы
       раунд не переводили дважды. */
    function isRevealAuthority() {
      return !!state && !sessionKicked && !document.hidden &&
        presentPlayers().some(function (p) { return p.id === myId; });
    }

    /* Пока художник сам в видимой вкладке, паузу завершает он. Если он скрыт,
       ведущим становится самый младший id среди видимых игроков — состояние
       presence теперь передаёт признак скрытой вкладки, поэтому все клиенты
       выбирают одного и того же игрока. */
    function isRevealLeader() {
      if (!isRevealAuthority()) return false;
      if (isDrawer()) return true;
      if (state && state.drawer && !isPlayerHidden(state.drawer) &&
          activePeers().some(function (p) { return p.id === state.drawer; })) return false;
      var ids = visiblePresentPlayers().map(function (p) { return p.id; }).sort();
      return ids.length > 0 && ids[0] === myId;
    }

    function beginReveal(reason, hitId, durationMs, leave) {
      if (!state || state.reveal) return false;
      if (localDraft && isDrawer()) {
        commitStroke(localDraft);
        localDraft = null;
      }
      var currentWord = word();
      var label = reason || 'Раунд завершён';
      var guesserId = String((state.hitInfo && state.hitInfo.guesserId) || '');
      var guesserName = String((state.hitInfo && state.hitInfo.guesserName) ||
        (presence[guesserId] && presence[guesserId].name) || '');
      var reveal = {
        id: hitId || K.uid(),
        word: currentWord,
        round: state.round,
        until: Date.now() + (Number(durationMs) > 0 ? Number(durationMs) : REVEAL_MS),
        reason: label,
        guesserId: guesserId,
        guesserName: guesserName,
        leave: !!leave
      };
      pauseRoundTimer();
      state.reveal = reveal;
      state.lastWord = null;
      state.hitInfo = null;
      drawing = false;
      localDraft = null;
      remoteDrafts = {};
      publishDraft(null, true);
      if (leave) systemMessage('Художник вышел.');
      else if (!guesserId) systemMessage(label);
      systemMessage('Загаданное слово: ' + currentWord + '.');
      if (!leave && guesserId) {
        systemMessage('Угадал игрок ' + (guesserName || 'Игрок') + '!');
      }
      publishState();
      scheduleRevealResolution(reveal);
      renderAll();
      return true;
    }

    function finishReveal(reveal, force) {
      if (!state || !state.reveal || state.reveal.id !== reveal.id) return;
      var until = typeof consensusLocalRevealUntil === 'function'
        ? (consensusLocalRevealUntil(state) || Number(reveal.until) || 0)
        : (Number(reveal.until) || 0);
      if (!force && Date.now() < until) return;
      /* Сначала объявляем всем, кто берёт паузу, и только потом меняем раунд.
         Так два видимых игрока не переведут ход дважды. */
      if (state.reveal.rotatedBy) return;
      var leader = !force && isRevealLeader();
      /* Если признак скрытой вкладки пришёл с задержкой, через 3 секунды после
         паузы завершить может любой видимый игрок. Страж-room может завершить
         застрявшую паузу принудительно, даже если все остальные скрыты. */
      var fallback = force || (visiblePresentPlayers().some(function (p) { return p.id === myId; }) &&
        Date.now() >= until + 3000);
      if (!leader && !fallback) return;
      state.reveal.rotatedBy = myId;
      publishState();
      setTimeout(function () {
        if (!state || !state.reveal || state.reveal.id !== reveal.id) return;
        if (state.reveal.rotatedBy !== myId) return;
        if (!force && !leader && !isRevealLeader() && Date.now() < until + 3000) return;
        rotateDrawer(reveal.reason || 'Раунд завершён.', reveal.guesserId);
        publishState(true);
        renderAll();
      }, 250);
    }

    function scheduleRevealResolution(reveal) {
      if (!reveal || !reveal.id || handledRevealId === reveal.id) return;
      handledRevealId = reveal.id;
      if (typeof renderReveal === 'function') renderReveal();
      var adjustedUntil = typeof consensusLocalRevealUntil === 'function'
        ? (consensusLocalRevealUntil(state) || Number(reveal.until) || 0)
        : (Number(reveal.until) || 0);
      var wait = Math.max(0, adjustedUntil - Date.now());
      setTimeout(function () {
        if (!state || !state.reveal || state.reveal.id !== reveal.id) return;
        finishReveal(reveal);
      }, wait + 150);
      /* Повтор нужен, если лидер оказался в скрытой вкладке и не завершил
         паузу вовремя: его заменяет видимый игрок по общему состоянию. */
      setTimeout(function () {
        if (!state || !state.reveal || state.reveal.id !== reveal.id) return;
        finishReveal(reveal);
      }, wait + 3500);
    }

    function scheduleHitResolution(info) {
      if (!info || !info.id || handledHitId === info.id) return;
      handledHitId = info.id;
      showHitAnimation(info);
      var reason = (state && state.hitInfo && state.hitInfo.reason) || info.reason || 'Все слова угаданы!';
      beginReveal(reason, info.id);
    }

    function endRoundOnLeave() {
      if (!state || sessionKicked || !isDrawer()) return false;
      leavingRoom = myId;
      drawerOfflineAt = Date.now();
      return beginReveal('Художник вышел.',
        'leave-' + state.round + ':' + state.startedAt, LEAVE_REVEAL_MS, true);
    }

    function ensureDrawer() {
      if (document.hidden || !state || state.waitingForPlayers) return;
      if (!isDrawer() && G.turnLockUntil && Date.now() < G.turnLockUntil) return;
      if (!isDrawer() && typeof isSyncPending === 'function' && isSyncPending()) return;
      var solo = soloRoom();
      var active = activePeers();
      var players = active.concat(active.some(function (p) { return p.id === myId; })
        ? []
        : [{ id: myId, name: profile.name, color: profile.color, avatar: profile.avatar, noDraw: !!noDraw,
            bgColor: tool.bg || profile.bgColor || '#252932', hidden: !!document.hidden }]);
      var ids = players.map(function (p) { return p.id; });
      var drawerPresent = !!state.drawer && (state.drawer === myId ||
        active.some(function (p) { return p.id === state.drawer; }));
      var drawerRecord = presence[state.drawer];
      var drawerLiveHere = !!drawerRecord && !drawerRecord.retained &&
        (Number(drawerRecord.receivedAt) || Number(drawerRecord.seenAt) || 0) > subscribedAt;
      /* В компании ждём медленный retained-presence. Короткий solo-таймер
         нельзя применять к унаследованному чужому ходу, иначе второй игрок
         заберёт рисование у ведущего ещё до доставки его presence. */
      var fastGrace = solo && subscribedAt
        ? Math.min(presenceReadyAt || Infinity, subscribedAt + SOLO_GRACE_MS)
        : presenceReadyAt;
      var graceUntil = typeof consensusNeedsFullTurnGrace === 'function' &&
        consensusNeedsFullTurnGrace(state, {
          myId: myId,
          drawerPresent: drawerPresent,
          drawerLiveHere: drawerLiveHere,
          drawerOffline: !!drawerOfflineAt,
          drawerMissingSince: drawerMissingSince
        }) ? presenceReadyAt : fastGrace;
      if (state.drawer && graceUntil && Date.now() < graceUntil) return;
      if (!isTurnAuthority()) return;

      if (state.reveal || state.lastWord) return;
      if (solo) {
        if (drawerPresent && state.drawer === myId) return;
        /* Если ведущий был жив в этой сессии и ушёл, показываем слово и даём
           короткую паузу. Унаследованную пустую комнату запускаем сразу. */
        /* Задержанный retained online:true — не уход. Уход подтверждается
           только завещанием MQTT или таймаутом отсутствия. */
        var sawLeave = state.drawer && state.drawer !== myId &&
          (drawerOfflineAt > subscribedAt || drawerMissingSince > subscribedAt);
        state.queue = ids;
        state.hitInfo = null;
        state.waitingForPlayers = false;
        if (sawLeave) {
          /* Обновление страницы: сначала даём ведущему 5 секунд на возврат. */
          if (state.drawer !== myId && drawerOfflineAt &&
              Date.now() - drawerOfflineAt < DRAWER_OFFLINE_MS) return;
          beginReveal('Художник вышел.',
            'leave-' + state.round + ':' + state.startedAt, LEAVE_REVEAL_MS, true);
          return;
        }
        rotateDrawer('Новый раунд');
        publishState();
        renderAll();
        return;
      }

      if (drawerPresent) {
        drawerMissingSince = 0;
        return;
      }
      /* Забираем ход только после подтверждённого ухода и с паузой со словом. */
      if (!drawerConfirmedGone()) return;
      state.queue = ids;
      beginReveal('Художник вышел.',
        'leave-' + state.round + ':' + state.startedAt, LEAVE_REVEAL_MS, true);
    }
    G.isCreator = isCreator;
    G.isIdBanned = isIdBanned;
    G.isFingerprintBanned = isFingerprintBanned;
    G.isPlayerBanned = isPlayerBanned;
    G.isBannedMe = isBannedMe;
    G.isHitPaused = isHitPaused;
    G.normalizeState = normalizeState;
    G.mergeState = mergeState;
    G.normalizeStroke = migrateStroke;
    G.presentPlayers = presentPlayers;
    G.isPlayerHidden = isPlayerHidden;
    G.visiblePresentPlayers = visiblePresentPlayers;
    G.isDrawer = isDrawer;
    G.publishState = publishState;
    G.publishChatEvent = publishChatEvent;
    G.applyChatEvent = applyChatEvent;
    G.publishPresence = publishPresence;
    G.publishDraft = publishDraft;
    G.publishStroke = publishStroke;
    G.publishStrokeDeletion = publishStrokeDeletion;
    G.publishCanvasSnapshot = publishCanvasSnapshot;
    G.scheduleCanvasSnapshot = scheduleCanvasSnapshot;
    G.applyCanvasSnapshot = applyCanvasSnapshot;
    G.applyStrokeEvent = applyStrokeEvent;
    G.systemMessage = systemMessage;
    G.publishReactionEvent = publishReactionEvent;
    G.applyReactionEvent = applyReactionEvent;
    G.rotateDrawer = rotateDrawer;
    G.checkTimeout = checkTimeout;
    G.resumeWaitingRound = resumeWaitingRound;
    G.issueHintIfNeeded = issueHintIfNeeded;
    G.showHitAnimation = showHitAnimation;
    G.isTurnAuthority = isTurnAuthority;
    G.isRevealAuthority = isRevealAuthority;
    G.isRevealLeader = isRevealLeader;
    G.activePeers = activePeers;
    G.soloRoom = soloRoom;
    G.abandonedWaitingRoom = abandonedWaitingRoom;
    G.drawerConfirmedGone = drawerConfirmedGone;
    G.beginReveal = beginReveal;
    G.finishReveal = finishReveal;
    G.scheduleRevealResolution = scheduleRevealResolution;
    G.scheduleHitResolution = scheduleHitResolution;
    G.endRoundOnLeave = endRoundOnLeave;
    G.ensureDrawer = ensureDrawer;
    G.isStatePublisher = isStatePublisher;
    G.roundDeadline = roundDeadline;
    G.remainingRoundMs = remainingRoundMs;
    G.resetRoundTimer = resetRoundTimer;
    G.pauseRoundTimer = pauseRoundTimer;
  }
})(window.KROKO_GAME);
