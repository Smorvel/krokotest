/* Permissions, bans, round state and turn transitions. */
(function (G) {
  with (G) {
    function isCreator() {
      return !!(meta && (
        (meta.creatorId && meta.creatorId === myId) ||
        (meta.creatorFingerprint && meta.creatorFingerprint === myFingerprint)
      ));
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
      return !!(state && state.pausedUntil && Date.now() < state.pausedUntil);
    }

    function normalizeReveal(raw) {
      if (!raw || typeof raw !== 'object') return null;
      var value = {
        id: String(raw.id || ''),
        word: String(raw.word || ''),
        round: Number(raw.round) || 0,
        until: Number(raw.until) || 0,
        reason: String(raw.reason || '')
      };
      if (!value.id || !value.word || !value.until) return null;
      if (!value.until || value.until <= Date.now()) return null;
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
      s.strokes = Array.isArray(s.strokes) ? s.strokes.filter(function (stroke) {
        return stroke && typeof stroke === 'object' &&
          ((stroke.tool === 'raster' && typeof stroke.image === 'string') || Array.isArray(stroke.points));
      }).map(migrateStroke).filter(Boolean) : [];
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
            acc[id] = { value: value };
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
  
    function presentPlayers() {
      var now = Date.now();
      var list = Object.keys(presence).map(function (id) { return presence[id]; }).filter(function (p) {
        return p && p.id !== leavingRoom && p.online !== false &&
          now - (Number(p.ts) || 0) < 60000 && !isPlayerBanned(p);
      });
      if (!isBannedMe() && !list.some(function (p) { return p.id === myId; })) {
        list.push({
          id: myId, name: profile.name, color: profile.color, avatar: profile.avatar, fingerprint: myFingerprint,
          joinedAt: sessionJoinedAt, ts: Date.now(), online: true
        });
      }
      return list.sort(function (a, b) { return (Number(a.joinedAt) || 0) - (Number(b.joinedAt) || 0); });
    }
  
    function isDrawer() {
      return !sessionKicked && !!state && state.drawer === myId && !isBannedMe();
    }
  
    function publishState() {
      if (sessionKicked || !state || !client || !client.connected) return;
      state.updatedAt = Date.now();
      state.updatedBy = myId;
      K.publish(client, K.topic(room, 'state'), state, true);
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
        ts: Date.now()
      }, true);
    }
  
    function publishDraft(stroke) {
      if (sessionKicked || !client || !client.connected) return;
      K.publish(client, K.topic(room, 'draft/' + myId), {
        id: myId,
        owner: myId,
        stroke: stroke ? {
          id: stroke.id, owner: stroke.owner, tool: stroke.tool,
          color: stroke.color, size: stroke.size, alpha: stroke.alpha,
          smooth: stroke.smooth, shapeMode: stroke.shapeMode,
          points: stroke.points.slice(0, 4000), bg: stroke.bg
        } : null,
        at: Date.now()
      }, true);
    }
  
    function systemMessage(text) {
      if (!state) return;
      state.messages.push({
        id: K.uid(), ownerId: '', name: 'система', text: text, system: true,
        round: state.round, at: Date.now()
      });
      state.messages = state.messages.slice(-50);
    }
  
    function rotateDrawer(reason) {
      if (!state) return;
      var players = presentPlayers();
      var ids = state.queue.filter(function (id) {
        return players.some(function (p) { return p.id === id; }) && !isIdBanned(id) && !isFingerprintBanned(presence[id] && presence[id].fingerprint);
      });
      var index = ids.indexOf(state.drawer);
      if (index >= 0) {
        ids.splice(index, 1);
        ids.push(state.drawer);
      }
      state.queue = ids;
      state.drawer = ids[0] || myId;
      var endingAt = state.startedAt;
      chooseNextWord();
      state.round += 1;
      state.startedAt = Date.now();
      Object.keys(rasterImages).forEach(function (id) { delete rasterImages[id]; });
      state.strokes = [];
      state.hitInfo = null;
      state.reveal = null;
      state.pausedUntil = 0;
      state.waitingForPlayers = false;
      state.expiredAt = 0;
      handledHitId = null;
      handledStart = endingAt;
      drawing = false;
      localDraft = null;
      remoteDrafts = {};
      publishDraft(null);
      scheduleBaseRedraw();
      scheduleDrafts();
      var next = players.filter(function (p) { return p.id === state.drawer; })[0];
      systemMessage(reason + ' Следующий художник: ' + (next ? next.name : 'вы') + '.');
    }
  
    function checkTimeout() {
      if (!state || state.reveal || isHitPaused() || state.roundMs === 0) return;
      var expired = Date.now() - state.startedAt >= state.roundMs;
      if (!expired) return;
      var guessers = presentPlayers().filter(function (p) { return p.id !== state.drawer; });
  
      if (!guessers.length) {
        if ((isDrawer() || isCreator()) && !state.waitingForPlayers) {
          state.waitingForPlayers = true;
          state.expiredAt = Date.now();
          handledStart = 0;
          systemMessage('Время вышло. Ждём игроков — раунд не заканчивается.');
          publishState();
          renderAll();
        }
        return;
      }
  
      if (!isDrawer() && !isCreator()) return;
  
      if (state.waitingForPlayers) {
        state.waitingForPlayers = false;
        state.expiredAt = 0;
        state.startedAt = Date.now() - state.roundMs + 60000;
        handledStart = 0;
        systemMessage('Игрок вошёл — раунд продлён на 60 секунд.');
        publishState();
        renderAll();
        return;
      }
  
      if (handledStart === state.startedAt) return;
      handledStart = state.startedAt;
      beginReveal('Время вышло!');
    }
  
    function issueHintIfNeeded() {
      if (!state || state.reveal || state.hintsDisabled || state.roundMs === 0 || state.hintSent || isHitPaused()) return;
      if (!isDrawer()) return;
      if (Date.now() - state.startedAt < state.roundMs * 0.9) return;
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
  
    function isRevealAuthority() {
      if (!state) return false;
      var players = presentPlayers();
      if (!players.length) return false;
      var drawerPresent = players.some(function (p) { return p.id === state.drawer; });
      if (drawerPresent) return isDrawer();
      if (isCreator()) return true;
      return players[0].id === myId;
    }

    function beginReveal(reason) {
      if (!state || state.reveal) return false;
      var currentWord = word();
      var reveal = {
        id: K.uid(),
        word: currentWord,
        round: state.round,
        until: Date.now() + REVEAL_MS,
        reason: reason || 'Раунд завершён'
      };
      state.reveal = reveal;
      state.hitInfo = null;
      state.pausedUntil = 0;
      drawing = false;
      localDraft = null;
      remoteDrafts = {};
      publishDraft(null);
      systemMessage('Загаданное слово: ' + currentWord + '.');
      publishState();
      scheduleRevealResolution(reveal);
      renderAll();
      return true;
    }

    function finishReveal(reveal) {
      if (!state || !state.reveal || state.reveal.id !== reveal.id) return;
      if (!isRevealAuthority()) return;
      rotateDrawer(reveal.reason || 'Раунд завершён.');
      publishState();
      renderAll();
    }

    function scheduleRevealResolution(reveal) {
      if (!reveal || !reveal.id || handledRevealId === reveal.id) return;
      handledRevealId = reveal.id;
      if (typeof renderReveal === 'function') renderReveal();
      setTimeout(function () {
        if (!state || !state.reveal || state.reveal.id !== reveal.id) return;
        finishReveal(reveal);
      }, Math.max(0, reveal.until - Date.now()) + 150);
    }

    function scheduleHitResolution(info) {
      if (!info || !info.id || handledHitId === info.id) return;
      handledHitId = info.id;
      showHitAnimation(info);
      var reason = (state && state.hitInfo && state.hitInfo.reason) || info.reason || 'Все слова угаданы!';
      beginReveal(reason);
    }

    function endRoundOnLeave() {
      if (!state || sessionKicked || !isDrawer()) return false;
      leavingRoom = myId;
      var endedWord = word();
      var reason = 'Художник вышел.';
      state.lastWord = {
        id: K.uid(),
        word: endedWord,
        round: state.round,
        until: Date.now() + REVEAL_MS,
        reason: reason
      };
      state.reveal = null;
      state.hitInfo = null;
      state.pausedUntil = 0;
      drawing = false;
      localDraft = null;
      remoteDrafts = {};
      publishDraft(null);
      systemMessage('Загаданное слово: ' + endedWord + '.');
      publishState();
      rotateDrawer(reason);
      publishState();
      renderAll();
      return true;
    }

    function ensureDrawer() {
      if (!state) return;
      if (presenceReadyAt && Date.now() < presenceReadyAt) return;
      if (state.reveal || state.lastWord) return;
      var players = presentPlayers();
      var ids = players.map(function (p) { return p.id; });
      if (ids.indexOf(state.drawer) >= 0) return;
      state.queue = ids;
      beginReveal('Художник вышел.');
    }
    G.isCreator = isCreator;
    G.isIdBanned = isIdBanned;
    G.isFingerprintBanned = isFingerprintBanned;
    G.isPlayerBanned = isPlayerBanned;
    G.isBannedMe = isBannedMe;
    G.isHitPaused = isHitPaused;
    G.normalizeState = normalizeState;
    G.presentPlayers = presentPlayers;
    G.isDrawer = isDrawer;
    G.publishState = publishState;
    G.publishPresence = publishPresence;
    G.publishDraft = publishDraft;
    G.systemMessage = systemMessage;
    G.rotateDrawer = rotateDrawer;
    G.checkTimeout = checkTimeout;
    G.issueHintIfNeeded = issueHintIfNeeded;
    G.showHitAnimation = showHitAnimation;
    G.isRevealAuthority = isRevealAuthority;
    G.beginReveal = beginReveal;
    G.finishReveal = finishReveal;
    G.scheduleRevealResolution = scheduleRevealResolution;
    G.scheduleHitResolution = scheduleHitResolution;
    G.endRoundOnLeave = endRoundOnLeave;
    G.ensureDrawer = ensureDrawer;
  }
})(window.KROKO_GAME);
