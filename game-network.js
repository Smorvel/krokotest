/* MQTT subscriptions and room state handling. */
(function (G) {
  with (G) {
    function applyMeta() {
      if (!meta) return;
      if (room === K.DEFAULT_ROOM) meta.name = 'Общая';
      el.roomTitle.textContent = meta.name || room;
      renderTools();
    }
  
    function ensureMeta() {
      if (meta) return;
      var local = null;
      K.getRooms().forEach(function (r) { if (r.slug === room) local = r; });
      var dict = local && local.dictionary ? local.dictionary : fallbackDictionary();
      meta = {
        slug: room,
        name: room === K.DEFAULT_ROOM ? 'Общая' : (local ? local.name : room),
        creatorId: local ? (local.creatorId || '') : (room === K.DEFAULT_ROOM ? '' : myId),
        creatorName: local ? local.creatorName : profile.name,
        creatorFingerprint: local ? (local.creatorFingerprint || '') : (room === K.DEFAULT_ROOM ? '' : myFingerprint),
        dictionary: dict,
        dictionaryIds: local && Array.isArray(local.dictionaryIds) && local.dictionaryIds.length ? local.dictionaryIds : [dict.id],
        dictionaryPool: local && Array.isArray(local.dictionaryPool) && local.dictionaryPool.length
          ? local.dictionaryPool
          : (local && Array.isArray(local.dictionaryIds) && local.dictionaryIds.length
            ? dictionariesByIds(local.dictionaryIds)
            : [dict]),
        createdAt: local ? local.createdAt : Date.now()
      };
      if (client.connected) K.publish(client, K.topic(room, 'meta'), meta, true);
      applyMeta();
    }
  
    /* ---------- MQTT ---------- */
  
    var willMessage = {
      topic: K.topic(room, 'presence/' + myId),
      payload: JSON.stringify({ id: myId, name: profile.name, fingerprint: myFingerprint, online: false, ts: Date.now() }),
      qos: 1,
      retain: true
    };
  
    client = K.connect('play-' + room + '-' + myId, willMessage);
  
    client.on('connect', function () {
      if (sessionKicked) return;
      el.connection.textContent = 'онлайн';
      el.connection.classList.add('online');
      client.subscribe(K.topic(room, 'meta'), { qos: 1 });
      client.subscribe(K.topic(room, 'state'), { qos: 1 });
      client.subscribe(K.topic(room, 'presence/+'), { qos: 1 });
      client.subscribe(K.topic(room, 'draft/+'), { qos: 1 });
      subscribedAt = Date.now();
      presenceReadyAt = subscribedAt + 5000;
      publishPresence(true);
      scheduleInitialState();
      renderTools();
    });
  
    client.on('reconnect', function () {
      el.connection.textContent = 'переподключение...';
      el.connection.classList.remove('online');
    });
  
    client.on('offline', function () {
      el.connection.textContent = 'нет соединения';
      el.connection.classList.remove('online');
      renderTools();
    });
  
    client.on('error', function () {
      el.connection.textContent = 'нет соединения';
      el.connection.classList.remove('online');
    });
  
    client.on('message', function (topic, message) {
      if (sessionKicked) return;
      var data = K.parse(message);
      if (!data) return;
      var metaTopic = K.topic(room, 'meta');
  
      if (topic === metaTopic) {
        meta = data;
        applyMeta();
        return;
      }
  
      if (topic === K.topic(room, 'state')) {
        if (Number(data.v) < 2) return;
        stateSeen = true;
        if (state && Number(data.updatedAt) < Number(state.updatedAt || 0)) return;
        var previousRound = state ? state.round + ':' + state.wordIndex : null;
        var merged = mergeState(normalizeState(data), state);
        state = merged.state;
        Object.keys(remoteDrafts).forEach(function (id) {
          var draft = remoteDrafts[id];
          if (!draft) return;
          var committed = state.strokes.some(function (stroke) { return stroke.id === draft.id; });
          if (committed) delete remoteDrafts[id];
        });
        banned = isBannedMe();
  
        if (!banned && leavingRoom !== myId && state.queue.indexOf(myId) < 0) {
          state.queue.push(myId);
          publishState();
        }
        if (previousRound && previousRound !== state.round + ':' + state.wordIndex) {
          remoteDrafts = {};
          localDraft = null;
          drawing = false;
        }
        applyMeta();
        renderAll();
        if (state.reveal) scheduleRevealResolution(state.reveal);
        if (state.hitInfo) scheduleHitResolution(state.hitInfo);
        if (merged.changed) publishState();
        ensureDrawer();
        checkTimeout();
        return;
      }
  
      if (topic.indexOf(K.topic(room, 'presence/')) === 0) {
        if (!data.id) return;
        if (isPlayerBanned(data)) return;
        if (data.online === false) delete presence[data.id];
        else presence[data.id] = Object.assign({}, data, { ts: Number(data.ts) || 0 });
        renderPlayers();
        renderWord();
        renderTools();
        if (state) ensureDrawer();
        checkTimeout();
        return;
      }
  
      if (topic.indexOf(K.topic(room, 'draft/')) === 0) {
        if (!data.id || data.id === myId || isPlayerBanned(data)) return;
        if (data.stroke) {
          remoteDrafts[data.id] = data.stroke;
        } else if (remoteDrafts[data.id]) {
          remoteDrafts[data.id].pendingUntil = Date.now() + 1200;
        }
        scheduleDrafts();
      }
    });
  
    function createInitialState() {
      ensureMeta();
      var players = presentPlayers();
      var ids = players.map(function (p) { return p.id; });
      var drawer = ids[0] || myId;
      var dict = getDictionary();
  
      state = normalizeState({
        v: 3,
        round: 1,
        wordIndex: 0,
        drawer: drawer,
        queue: ids,
        bans: [],
        banRecords: [],
        reactions: {},
        dictionary: dict,
        dictionaryIds: meta && meta.dictionaryIds ? meta.dictionaryIds.slice() : [dict.id],
        dictionaryPool: availableDictionaries(),
        wordHistory: [],
        guessedWords: [],
        startedAt: Date.now(),
        roundMs: DEFAULT_ROUND_MS,
        strokes: [],
        messages: [],
        scores: {},
        bg: tool.bg || '#252932',
        bgBy: myId,
        hintSent: false,
        hintsDisabled: false,
        waitingForPlayers: false,
        expiredAt: 0
      });
      chooseNextWord();
      systemMessage('Комната «' + (meta ? meta.name : 'Общая') + '» готова. Удачи!');
      handledStart = 0;
      publishState();
      renderAll();
    }
  
    function scheduleInitialState() {
      if (initialStateTimer) clearTimeout(initialStateTimer);
      initialStateTimer = setTimeout(function () {
        if (state || stateSeen) return;
        if (!client.connected || !subscribedAt || Date.now() - subscribedAt < 4000) {
          scheduleInitialState();
          return;
        }
        createInitialState();
      }, 1000);
    }
  
    G.applyMeta = applyMeta;
    G.ensureMeta = ensureMeta;
    G.createInitialState = createInitialState;
    G.scheduleInitialState = scheduleInitialState;
  }
})(window.KROKO_GAME);
