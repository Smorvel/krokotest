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
      if (deadline) return deadline;
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

    function normalizeReveal(raw) {
      if (!raw || typeof raw !== 'object') return null;
      var value = {
        id: String(raw.id || ''),
        word: String(raw.word || ''),
        round: Number(raw.round) || 0,
        until: Number(raw.until) || 0,
        reason: String(raw.reason || ''),
        guesserId: String(raw.guesserId || ''),
        /* Явный выход ведущего: уход подтверждён, ждать его presence ещё раз
           не нужно, раунд завершается сразу после паузы со словом. */
        leave: !!raw.leave,
        /* Метка лидера, который завершает паузу. Без неё два видимых игрока
           могли одновременно перевести раунд после возврата вкладки. */
        rotatedBy: typeof raw.rotatedBy === 'string' ? raw.rotatedBy : ''
      };
      if (!value.id || !value.word || !value.until) return null;
      /* Просроченное раскрытие ещё нужно, чтобы завершить раунд. Раньше оно
       выбрасывалось сразу после until, поэтому состояние застывало на 0. */
      if (!value.until || value.until < Date.now() - 30000) return null;
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
      s.reveal = normalizeReveal(s.reveal);
      s.lastWord = normalizeReveal(s.lastWord);
      s.hintSent = !!s.hintSent;
      s.waitingForPlayers = !!s.waitingForPlayers;
      s.expiredAt = Number(s.expiredAt) || 0;
      s.updatedAt = Number(s.updatedAt) || 0;
      s.updatedBy = s.updatedBy || '';
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
        if (previous.reveal && Number(previous.reveal.until) > Date.now() - 30000 && !incoming.reveal) {
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
          hidden: !!document.hidden
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

    function publishState() {
      if (sessionKicked || !state || !client || !client.connected || !isStatePublisher()) return;
      state.updatedAt = Date.now();
      state.updatedBy = myId;
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
      if (!state) return;
      state.messages.push({
        id: K.uid(), ownerId: '', name: 'система', text: text, system: true,
        round: state.round, at: Date.now()
      });
      state.messages = state.messages.slice(-50);
    }
  
    function rotateDrawer(reason, nextDrawerId) {
      if (!state) return false;
      var rotationToken = Number(state.round) + ':' + Number(state.startedAt) + ':' +
        Number(state.wordIndex) + ':' + String(state.drawer || '');
      if (handledRotation === rotationToken) return false;
      /* Ход переводим только владелец хода или игрок, подтвердивший уход
         предыдущего художника. Завершение уже показанного слова — тоже
         законный повод: скрытая вкладка художника не должна блокировать раунд. */
      var revealReady = !!(state.reveal && Date.now() >= Number(state.reveal.until));
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
        hidden: !!document.hidden
      }]);
      /* Угадавший становится следующим художником всегда. Presence мог
         задержаться, поэтому добавляем его в список даже без свежего heartbeat. */
      if (nextDrawerId && !players.some(function (p) { return p.id === nextDrawerId; })) {
        var known = presence[nextDrawerId] || {};
        players.push({
          id: nextDrawerId,
          name: known.name || 'Игрок',
          color: known.color || profile.color,
          avatar: known.avatar || profile.avatar,
          fingerprint: known.fingerprint || '',
          noDraw: !!known.noDraw,
          hidden: !!known.hidden
        });
      }
      var activeIds = players.map(function (p) { return p.id; });
      var ids = state.queue.filter(function (id) {
        return activeIds.indexOf(id) >= 0 && !isIdBanned(id) && !isFingerprintBanned(presence[id] && presence[id].fingerprint);
      });
      if (nextDrawerId && ids.indexOf(nextDrawerId) < 0) ids.unshift(nextDrawerId);
      var willing = ids.filter(function (id) {
        var player = players.filter(function (p) { return p.id === id; })[0];
        return !(player && player.noDraw);
      });
      /* Обычный ход не возвращает художника того же раунда и не выбирает
         тех, кто поставил «не хочу рисовать». Если желающих нет — ход остаётся
         в общую очередь, иначе игра встала бы. */
      var pool = willing.filter(function (id) { return id !== state.drawer; });
      if (!pool.length) pool = ids.filter(function (id) { return id !== state.drawer; });
      if (!pool.length) pool = willing;
      if (!pool.length) pool = ids;
      var nextId = nextDrawerId && ids.indexOf(nextDrawerId) >= 0
        ? nextDrawerId
        : (pool.length ? pool[Math.floor(Math.random() * pool.length)] : myId);
      var index = ids.indexOf(nextId);
      if (index > 0) {
        ids.splice(index, 1);
        ids.unshift(nextId);
      } else if (index < 0) {
        ids.unshift(nextId);
      }
      state.queue = ids;
      state.drawer = nextId;
      var endingAt = state.startedAt;
      chooseNextWord();
      state.round += 1;
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
      var next = players.filter(function (p) { return p.id === state.drawer; })[0];
      systemMessage(reason + ' Следующий художник: ' + (next ? next.name : 'вы') + '.');
      return true;
    }

    function checkTimeout() {
      if (document.hidden || !state || state.reveal || isHitPaused() || state.roundMs === 0) return;
      var deadline = roundDeadline();
      if (!deadline || Date.now() < deadline) return;
      /* Конец времени определяется общим state.deadline, а не правом «взять
         ход»: скрытый художник не должен блокировать таймер у остальных. */
      if (handledStart === state.startedAt) return;

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
  
    function issueHintIfNeeded() {
      if (document.hidden || !state || state.reveal || state.hintsDisabled || state.roundMs === 0 || state.hintSent || isHitPaused()) return;
      if (!isDrawer()) return;
      if (roundDeadline() - Date.now() > state.roundMs * 0.1) return;
      state.hintSent = true;
      systemMessage('Подсказка: ' + maskPhrase(word()));
      publishState();
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
      var reveal = {
        id: hitId || K.uid(),
        word: currentWord,
        round: state.round,
        until: Date.now() + (Number(durationMs) > 0 ? Number(durationMs) : REVEAL_MS),
        reason: label,
        guesserId: String((state.hitInfo && state.hitInfo.guesserId) || ''),
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
      systemMessage(label + ' Загаданное слово: ' + currentWord + '.');
      publishState();
      scheduleRevealResolution(reveal);
      renderAll();
      return true;
    }

    function finishReveal(reveal) {
      if (!state || !state.reveal || state.reveal.id !== reveal.id) return;
      if (Date.now() < Number(reveal.until)) return;
      /* Сначала объявляем всем, кто берёт паузу, и только потом меняем раунд.
         Так два видимых игрока не переведут ход дважды. */
      if (state.reveal.rotatedBy) return;
      var leader = isRevealLeader();
      /* Если признак скрытой вкладки пришёл с задержкой, через 3 секунды после
         паузы завершить может любой видимый игрок. */
      var fallback = visiblePresentPlayers().some(function (p) { return p.id === myId; }) &&
        Date.now() >= Number(reveal.until) + 3000;
      if (!leader && !fallback) return;
      state.reveal.rotatedBy = myId;
      publishState();
      setTimeout(function () {
        if (!state || !state.reveal || state.reveal.id !== reveal.id) return;
        if (state.reveal.rotatedBy !== myId) return;
        if (!leader && !isRevealLeader() && Date.now() < Number(reveal.until) + 3000) return;
        rotateDrawer(reveal.reason || 'Раунд завершён.', reveal.guesserId);
        publishState();
        renderAll();
      }, 250);
    }

    function scheduleRevealResolution(reveal) {
      if (!reveal || !reveal.id || handledRevealId === reveal.id) return;
      handledRevealId = reveal.id;
      if (typeof renderReveal === 'function') renderReveal();
      var wait = Math.max(0, reveal.until - Date.now());
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
      if (document.hidden || !state) return;
      var solo = soloRoom();
      /* В компании ждём медленный retained-presence. В одиночке — только
         короткий срок доставки, после чего ход берётся сразу. */
      var graceUntil = solo && subscribedAt
        ? Math.min(presenceReadyAt || Infinity, subscribedAt + SOLO_GRACE_MS)
        : presenceReadyAt;
      if (state.drawer && graceUntil && Date.now() < graceUntil) return;
      if (!isTurnAuthority()) return;
      var active = activePeers();
      var players = active.concat(active.some(function (p) { return p.id === myId; })
        ? []
        : [{ id: myId, name: profile.name, color: profile.color, avatar: profile.avatar, noDraw: !!noDraw,
            hidden: !!document.hidden }]);
      var ids = players.map(function (p) { return p.id; });
      var drawerPresent = !!state.drawer && (state.drawer === myId ||
        active.some(function (p) { return p.id === state.drawer; }));

      if (state.reveal || state.lastWord) return;
      if (solo) {
        if (drawerPresent && state.drawer === myId) return;
        /* Если ведущий был жив в этой сессии и ушёл, показываем слово и даём
           короткую паузу. Унаследованную пустую комнату запускаем сразу. */
        var info = state.drawer && presence[state.drawer];
        var seenHere = info && (Number(info.receivedAt) || Number(info.seenAt) || 0) > subscribedAt;
        var sawLeave = state.drawer && state.drawer !== myId &&
          (drawerSeenAt > subscribedAt || seenHere || drawerOfflineAt > subscribedAt ||
            drawerMissingSince > subscribedAt);
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
    G.rotateDrawer = rotateDrawer;
    G.checkTimeout = checkTimeout;
    G.issueHintIfNeeded = issueHintIfNeeded;
    G.showHitAnimation = showHitAnimation;
    G.isTurnAuthority = isTurnAuthority;
    G.isRevealAuthority = isRevealAuthority;
    G.isRevealLeader = isRevealLeader;
    G.activePeers = activePeers;
    G.soloRoom = soloRoom;
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
