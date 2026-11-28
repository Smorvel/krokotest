/* MQTT subscriptions and room state handling. */
(function (G) {
  with (G) {
    var connectedOnce = false;
    var metaOwned = false;
    var lastResyncAt = 0;
    var skipOrphanUntil = 0;
    var ignoreRetainedCanvasUntil = 0;
    var ignoreRetainedPresenceUntil = 0;
    var resyncPending = false;
    var resyncStateSeen = false;
    var resyncStartedAt = 0;
    var resyncWatchTimer = null;

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
      /* Гость, пришедший по ссылке, не имеет комнаты в своём локальном списке.
         Он не должен объявлять себя создателем и перезаписывать retained-meta:
         иначе имя комнаты и права бана переходили к последнему вошедшему. */
      var owned = !!local || room === K.DEFAULT_ROOM;
      if (local && local.creatorId && local.creatorId !== myId &&
          !(local.creatorFingerprint && local.creatorFingerprint === myFingerprint)) {
        owned = false;
      }
      meta = {
        slug: room,
        name: room === K.DEFAULT_ROOM ? 'Общая' : (local ? local.name : room),
        creatorId: local ? (local.creatorId || '') : '',
        creatorName: local ? (local.creatorName || '') : '',
        creatorFingerprint: local ? (local.creatorFingerprint || '') : '',
        dictionary: dict,
        dictionaryIds: local && Array.isArray(local.dictionaryIds) && local.dictionaryIds.length ? local.dictionaryIds : [dict.id],
        dictionaryPool: local && Array.isArray(local.dictionaryPool) && local.dictionaryPool.length
          ? local.dictionaryPool
          : (local && Array.isArray(local.dictionaryIds) && local.dictionaryIds.length
            ? dictionariesByIds(local.dictionaryIds)
            : [dict]),
        createdAt: local ? local.createdAt : Date.now()
      };
      metaOwned = owned;
      /* Публикуем meta только настоящий создатель. Остальные ждут retained-
         сообщение и подставляют его словарь и имя. */
      if (client.connected && metaOwned) K.publish(client, K.topic(room, 'meta'), meta, true);
      applyMeta();
    }
  
    /* ---------- MQTT ---------- */
  
    var willMessage = {
      topic: K.topic(room, 'presence/' + myId),
      payload: JSON.stringify({ id: myId, name: profile.name, fingerprint: myFingerprint, online: false, ts: Date.now() }),
      qos: 1,
      retain: true
    };

    function roomTopics() {
      return [
        K.topic(room, 'meta'), K.topic(room, 'state'), K.topic(room, 'presence/+'),
        K.topic(room, 'draft/+'), K.topic(room, 'stroke/+'), K.topic(room, 'canvas/+'),
        K.topic(room, 'chat/+')
      ];
    }

    function subscribeRoomTopics() {
      client.subscribe(roomTopics(), { qos: 1 });
    }
  
    /* Отпечаток вкладки в clientId: одинаковый профиль на двух устройствах не
       должен выбивать соединение другого игрока. */
    client = K.connect('play-' + room + '-' + myId + '-' + (G.sessionTabId || K.uid()), willMessage);
  
    client.on('connect', function () {
      if (sessionKicked) return;
      var wasConnected = connectedOnce;
      connectedOnce = true;
      showConnectionOverlay('синхронизация', 'Подключаемся к комнате...');
      el.connection.textContent = 'онлайн';
      el.connection.classList.add('online');
      subscribeRoomTopics();
      subscribedAt = Date.now();
      /* Медленный канал (например, из Китая) может доставлять retained-сообщения
         много секунд. До истечения этого срока никто не объявляет художника
         «ушедшим» и не забирает у него ход. */
      presenceReadyAt = subscribedAt + 15000;
      publishPresence(true);
      /* Создатель восстанавливает свою meta после переподключения: раньше
         её мог перезаписать гость, не нашедший комнату в своём списке. */
      if (metaOwned) K.publish(client, K.topic(room, 'meta'), meta, true);
      if (wasConnected && state) {
        resyncRoom('переподключение');
      } else {
        scheduleInitialState();
        scheduleOrphanCheck();
      }
      /* Пустая комната должна начать рисунок быстро, но retained-presence
         успевает прийти: повторяем проверку хода после короткого окна. */
      setTimeout(function () {
        if (!sessionKicked && state) ensureDrawer();
      }, SOLO_GRACE_MS + 150);
      renderTools();
    });
  
    client.on('reconnect', function () {
      if (sessionKicked) return;
      showConnectionOverlay('переподключение', 'Связь с комнатой потеряна. Пробуем снова...');
      el.connection.textContent = 'переподключение...';
      el.connection.classList.remove('online');
    });

    client.on('offline', function () {
      if (sessionKicked) return;
      showConnectionOverlay('нет соединения', 'Вы не соединены с комнатой. Проверьте интернет.');
      el.connection.textContent = 'нет соединения';
      el.connection.classList.remove('online');
      renderTools();
    });

    client.on('error', function () {
      if (sessionKicked) return;
      showConnectionOverlay('нет соединения', 'Вы не соединены с комнатой. Проверьте интернет.');
      el.connection.textContent = 'нет соединения';
      el.connection.classList.remove('online');
    });

    client.on('close', function () {
      if (sessionKicked || leavingRoom === myId) return;
      showConnectionOverlay('нет соединения', 'Вы не соединены с комнатой. Проверьте интернет.');
      el.connection.textContent = 'нет соединения';
      el.connection.classList.remove('online');
    });
  
    function isSyncPending() {
      return resyncPending;
    }

    function finishResync() {
      if (!resyncPending) return;
      if (resyncWatchTimer) {
        clearTimeout(resyncWatchTimer);
        resyncWatchTimer = null;
      }
      resyncPending = false;
      if (typeof markSynced === 'function') markSynced();
    }

    function watchResync() {
      if (!resyncPending || !client.connected) return;
      /* Окно уходит, когда после повторной подписки пришло состояние комнаты.
         Дополнительный предел времени не даёт ему видеть вечно, если брокер
         задержал retained-сообщение или в комнате никто больше не публикует. */
      if (resyncStateSeen || (resyncStartedAt && Date.now() - resyncStartedAt > 8000)) {
        finishResync();
        return;
      }
      resyncWatchTimer = setTimeout(watchResync, 700);
    }

    /* Переподключение и возврат в вкладку не должны продолжать «свою игру».
       Заново подписываемся на retained-темы и принимаем более свежее состояние
       комнаты, сбрасывая локальные предохранители хода. */
    function resyncRoom(reason, quiet) {
      if (sessionKicked || !client || !client.connected) return;
      var now = Date.now();
      if (now - lastResyncAt < 1200) return;
      lastResyncAt = now;
      skipOrphanUntil = now + 15000;
      resyncPending = true;
      resyncStateSeen = false;
      resyncStartedAt = now;
      if (resyncWatchTimer) {
        clearTimeout(resyncWatchTimer);
        resyncWatchTimer = null;
      }
      if (!quiet) {
        if (typeof showConnectionOverlay === 'function') {
          showConnectionOverlay('синхронизация', 'Сверяем состояние комнаты...');
        }
        el.connection.textContent = 'синхронизация...';
        el.connection.classList.remove('online');
      }
      var topics = roomTopics();
      try { client.unsubscribe(topics); } catch (error) {}
      client.subscribe(topics, { qos: 1 });
      subscribedAt = Date.now();
      presenceReadyAt = subscribedAt + 15000;
      handledRotation = null;
      lastRotationAt = 0;
      drawerMissingSince = 0;
      drawerOfflineAt = 0;
      if (canvasSnapshotTimer) {
        clearTimeout(canvasSnapshotTimer);
        canvasSnapshotTimer = null;
      }
      publishPresence(true);
      scheduleInitialState();
      scheduleOrphanCheck();
      resyncWatchTimer = setTimeout(watchResync, 1500);
    }

    /* Возврат в уже подключённую вкладку не должен показывать окно
       синхронизации и создавать вторую игру. Просто переспрашиваем retained-
       темы и сразу рисуем то, что уже есть в памяти. */
    function refreshRoom() {
      if (sessionKicked || !client || !client.connected || !subscribedAt) return;
      try { subscribeRoomTopics(); } catch (error) {}
      publishPresence(true);
      flushPendingCanvas();
      flushFutureEvents();
      flushPendingStrokes();
      if (state) renderAll();
    }
  
    function flushPendingStrokes() {
      var pending = Object.keys(pendingStrokes).map(function (id) { return pendingStrokes[id]; });
      pendingStrokes = {};
      pending.sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
      pending.forEach(function (data) {
        if (applyStrokeEvent(data)) scheduleDrafts();
      });
    }

    /* События, пришедшие раньше состояния, ждут своего раунда. Удаления
       применяются первыми, чтобы задержавшийся штрих не воскрес после них. */
    function flushFutureEvents() {
      if (!state) return;
      var round = Number(state.round);
      Object.keys(futureDeletions).forEach(function (id) {
        var data = futureDeletions[id];
        if (Number(data.round) > round) return;
        delete futureDeletions[id];
        if (Number(data.round) === round) applyStrokeEvent(data);
      });
      Object.keys(futureStrokes).forEach(function (id) {
        var data = futureStrokes[id];
        if (Number(data.round) > round) return;
        delete futureStrokes[id];
        if (Number(data.round) === round && applyStrokeEvent(data)) scheduleDrafts();
      });
      Object.keys(pendingStrokes).forEach(function (id) {
        var data = pendingStrokes[id];
        if (Number(data.round) > round) {
          futureStrokes[id] = data;
          delete pendingStrokes[id];
        }
      });
    }

    function flushPendingCanvas() {
      var snapshot = pendingCanvas;
      if (!snapshot) return;
      if (!state || !snapshot.round || !snapshot.by ||
          Number(snapshot.round) !== Number(state.round) ||
          (state.drawer && snapshot.by !== state.drawer)) {
        /* Отложившийся снимок чужого раунда/ведущего больше не ждёт своей очереди. */
        pendingCanvas = null;
        return;
      }
      var minSeq = Number(state.canvasSeq) || 0;
      if (canvasRound === Number(snapshot.round)) minSeq = Math.max(minSeq, Number(canvasVersion) || 0);
      if (Number(snapshot.seq) < minSeq) {
        pendingCanvas = null;
        return;
      }
      if (applyCanvasSnapshot(snapshot)) pendingCanvas = null;
    }

    client.on('message', function (topic, message, packet) {
      if (sessionKicked) return;
      if (packet && packet.retain && message && message.length &&
          topic.indexOf(K.topic(room, '')) === 0) {
        retainedTopics[topic] = true;
      }
      var data = K.parse(message);
      if (!data) return;
      if (!guardIncoming(topic, data, packet)) return;
      var metaTopic = K.topic(room, 'meta');
  
      if (topic === metaTopic) {
        /* После очистки заброшенной комнаты старый retained-meta не должен
           вернуть чужого создателя раньше, чем создастся новое состояние. */
        if (packet && packet.retain && Date.now() < ignoreRetainedMetaUntil) return;
        meta = data;
        metaOwned = !!(meta.creatorId
          ? meta.creatorId === myId
          : (meta.creatorFingerprint && meta.creatorFingerprint === myFingerprint));
        applyMeta();
        return;
      }
  
      if (topic.indexOf(K.topic(room, 'canvas/')) === 0) {
        if (packet && packet.retain && Date.now() < ignoreRetainedCanvasUntil) return;
        if (!data || !Array.isArray(data.strokes) || !data.round || !data.by) return;
        if (isPlayerBanned({ id: data.by })) return;
        /* Снимок принимается только от художника текущего раунда. Иначе
           задержанная копия старого ведущего заменяет новый рисунок. */
        if (state && state.drawer && data.by !== state.drawer) return;
        canvasSeen = true;
        var snapshotRound = Number(data.round);
        var snapshotSeq = Number(data.seq) || 0;
        if (!state) {
          /* Состояние ещё не пришло: запоминаем самый свежий снимок. */
          if (!pendingCanvas || snapshotRound > Number(pendingCanvas.round) ||
              (snapshotRound === Number(pendingCanvas.round) &&
               snapshotSeq > Number(pendingCanvas.seq))) {
            pendingCanvas = data;
          }
          return;
        }
        if (snapshotRound !== Number(state.round)) {
          /* Снимок другого раунда не трогает текущий холст и ведущего. */
          if (snapshotRound > Number(state.round) &&
              (!pendingCanvas || snapshotRound > Number(pendingCanvas.round))) {
            pendingCanvas = data;
          }
          return;
        }
        /* Медленный канал может доставить старый снимок после нового штриха.
           Такой снимок нельзя применять: он стёр бы свежие штрихи. */
        var minSnapshotSeq = Number(state.canvasSeq) || 0;
        if (canvasRound === snapshotRound) minSnapshotSeq = Math.max(minSnapshotSeq, Number(canvasVersion) || 0);
        if (snapshotSeq < minSnapshotSeq) return;
        if (applyCanvasSnapshot(data)) {
          canvasRound = snapshotRound;
          canvasVersion = snapshotSeq;
          renderAll();
        }
        return;
      }

      if (topic === K.topic(room, 'state')) {
        if (Number(data.v) < 2 || !data.round) return;
        stateSeen = true;
        /* Сам факт получения state закрывает окно синхронизации, даже если
           эта копия старше локальной и будет отклонена ниже. Иначе скрытая
           вкладка висела в «синхронизации» до вечного таймаута. */
        if (resyncPending) resyncStateSeen = true;
        if (state && Number(data.round) < Number(state.round)) return;
        if (state && Number(data.round) > Number(state.round) + 1) return;
        /* Свежесть state определяется монотонной версией и детерминированным
           id автора, а не системными часами. Иначе при разнице часов два
           клиента навсегда остаются при разных ведущих. */
        var previousDrawer = state ? state.drawer : null;
        if (state) {
          var stateDecision = typeof consensusCompareState === 'function'
            ? consensusCompareState(state, data)
            : (Number(data.updatedAt || 0) > Number(state.updatedAt || 0) ? 1 : -1);
          if (stateDecision <= 0) return;
        }
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
        /* Забаненный не остаётся «наблюдателем»: его сразу возвращает на главную. */
        if (banned) {
          kickForBan();
          return;
        }
  
        if (!banned && leavingRoom !== myId && state.queue.indexOf(myId) < 0) {
          state.queue.push(myId);
          publishState();
        }
        if (previousRound && previousRound !== state.round + ':' + state.wordIndex) {
          handledRotation = null;
          lastRotationAt = 0;
          remoteDrafts = {};
          localDraft = null;
          drawing = false;
          /* Новый раунд начинает новую историю холста: старые снимки и
             задержанные события прошлого раунда больше не нужны. */
          canvasRound = 0;
          canvasVersion = 0;
          canvasOwner = '';
          pendingCanvas = null;
          pendingStrokes = {};
          futureStrokes = {};
          futureDeletions = {};
          deletedStrokes = {};
          seenChatIds = {};
          drawerMissingSince = 0;
          drawerOfflineAt = 0;
          if (isDrawer()) scheduleCanvasSnapshot(200);
        }
        if (previousDrawer && previousDrawer !== state.drawer) {
          /* Смена ведущего без смены раунда тоже обнуляет историю холста:
             иначе старый seq заставляет отклонять снимки нового художника. */
          handledRotation = null;
          lastRotationAt = 0;
          remoteDrafts = {};
          localDraft = null;
          drawing = false;
          canvasRound = 0;
          canvasVersion = 0;
          canvasOwner = '';
          pendingCanvas = null;
          pendingStrokes = {};
          futureStrokes = {};
          futureDeletions = {};
          deletedStrokes = {};
          drawerMissingSince = 0;
          drawerOfflineAt = 0;
          if (isDrawer()) scheduleCanvasSnapshot(200);
        }
        if (localDraft && !isDrawer()) {
          localDraft = null;
          drawing = false;
          publishDraft(null, true);
        }
        flushPendingCanvas();
        flushFutureEvents();
        flushPendingStrokes();
        applyMeta();
        renderAll();
        if (state.reveal) scheduleRevealResolution(state.reveal);
        if (state.hitInfo) scheduleHitResolution(state.hitInfo);
        if (merged.changed) publishState();
        if (clearAbandonedWaiting()) return;
        if (typeof resumeWaitingRound === 'function') resumeWaitingRound();
        ensureDrawer();
        checkTimeout();
        finishResync();
        return;
      }
  
      if (topic.indexOf(K.topic(room, 'presence/')) === 0) {
        if (packet && packet.retain && Date.now() < ignoreRetainedPresenceUntil) return;
        if (!data.id) return;
        if (isPlayerBanned(data)) return;
        /* Один profile.id на двух устройствах — не два игрока, а дубликат.
           Оставляем более свежую вкладку по тем же меткам, что и session guard. */
        if (data.id === myId && data.online !== false && data.sessionTabId &&
            G.sessionTabId && data.sessionTabId !== G.sessionTabId) {
          var sameIdAt = Number(data.sessionClaimAt) || Number(data.ts) || 0;
          var sameIdSeq = Number(data.sessionClaimSeq) || 0;
          var localIdAt = Number(G.sessionClaimAt) || 0;
          var localIdSeq = Number(G.sessionClaimSeq) || 0;
          var sameIdIsNewer = sameIdAt > localIdAt ||
            (sameIdAt === localIdAt && sameIdSeq > localIdSeq);
          if (sameIdIsNewer) kickForDuplicateSession();
          return;
        }
        /* Обычная и приватная вкладки одного браузера не обмениваются
           BroadcastChannel/localStorage, но имеют общий отпечаток. MQTT
           гарантирует, что останется только самая свежая вкладка. */
        if (data.online !== false && data.fingerprint && data.fingerprint === myFingerprint && data.id !== myId) {
          var incomingAt = Number(data.sessionClaimAt) || Number(data.ts) || 0;
          var incomingSeq = Number(data.sessionClaimSeq) || 0;
          var localAt = Number(G.sessionClaimAt) || 0;
          var localSeq = Number(G.sessionClaimSeq) || 0;
          var incomingIsNewer = incomingAt > localAt || (incomingAt === localAt && incomingSeq > localSeq);
          if (incomingIsNewer) {
            kickForDuplicateSession();
            return;
          }
          /* Более старую вкладку не показываем как живого игрока: она всё
             равно будет вытеснена, но её presence не должен менять ход. */
          return;
        }
        if (data.id === (state && state.drawer)) {
          if (data.online === false) {
            if (!drawerMissingSince) drawerMissingSince = Date.now();
            drawerOfflineAt = Date.now();
            /* Проверяем ход точно по истечении 5-секундного окна, а не только
               в очередном пятисекундном тике: вернувшийся ведущий успеет
               вернуть себе ход без смены раунда. */
            setTimeout(function () {
              if (!sessionKicked && state) ensureDrawer();
            }, DRAWER_OFFLINE_MS + 100);
          } else {
            drawerMissingSince = 0;
            drawerSeenAt = Date.now();
            drawerOfflineAt = 0;
          }
        }
        if (data.online === false) delete presence[data.id];
        else presence[data.id] = Object.assign({}, data, {
          ts: Number(data.ts) || 0,
          /* Время получения важнее времени отправки: медленный канал может
             доставить свежий presence с «старым» ts. Признак retained нужен,
             чтобы не принимать старого призрака за живого собеседника. */
          seenAt: Date.now(),
          receivedAt: Date.now(),
          retained: !!(packet && packet.retain)
        });
        renderPlayers();
        renderWord();
        renderTools();
        /* Новый игрок подписался на комнату: сразу отдаём ему полный холст,
          не дожидаясь очередного пятисекундного снимка. */
        if (data.online !== false && isDrawer()) scheduleCanvasSnapshot(200);
        if (state && typeof resumeWaitingRound === 'function') resumeWaitingRound();
        if (state) ensureDrawer();
        checkTimeout();
        return;
      }
  
      if (topic.indexOf(K.topic(room, 'draft/')) === 0) {
        if (!data.id || data.id === myId || isPlayerBanned(data)) return;
        if (state && state.drawer && data.id !== state.drawer) return;
        if (data.stroke) {
          remoteDrafts[data.id] = data.stroke;
        } else if (data.discard) {
          delete remoteDrafts[data.id];
        } else if (remoteDrafts[data.id]) {
          /* рисунок ещё не подтверждён состоянием — держим его видимым дольше */
          remoteDrafts[data.id].pendingUntil = Date.now() + 8000;
        }
        scheduleDrafts();
        return;
      }

      if (topic.indexOf(K.topic(room, 'chat/')) === 0) {
        if (!data || !data.message) return;
        if (isPlayerBanned(data.message)) return;
        applyChatEvent(data);
        return;
      }

      if (topic.indexOf(K.topic(room, 'stroke/')) === 0) {
        var eventId = String(data && (data.id || (data.stroke && data.stroke.id)) || '');
        if (!eventId || !data.round || !data.owner ||
            isPlayerBanned({ id: data.owner, fingerprint: data.fingerprint })) return;
        if (state && state.drawer && data.owner !== state.drawer) return;
        var eventRound = Number(data.round);
        if (!state) {
          if (data.deleted) futureDeletions[eventId] = data;
          else futureStrokes[eventId] = data;
          return;
        }
        if (eventRound > Number(state.round)) {
          if (data.deleted) futureDeletions[eventId] = data;
          else futureStrokes[eventId] = data;
          return;
        }
        if (eventRound !== Number(state.round)) return;
        if (data.deleted) futureDeletions[eventId] = data;
        if (applyStrokeEvent(data)) scheduleDrafts();
        return;
      }
    });
  
    /* Комната без живых игроков — не архив: retained-состояние, холст и слово
       от прошлой сессии должны исчезнуть, иначе пустая комната открывается
       со старым рисунком и старой плашкой слова. */
    function clearOrphanedRoom() {
      if (client && client.connected) {
        Object.keys(retainedTopics).forEach(function (topic) {
          client.publish(topic, '', { qos: 1, retain: true });
        });
      }
      retainedTopics = {};
      ignoreRetainedMetaUntil = Date.now() + 5000;
      /* Поздний retained-снимок старого ведущего не должен снова заблокировать
        создание свежего раунда после очистки «брошенного» ожидания. */
      ignoreRetainedCanvasUntil = Date.now() + 5000;
      ignoreRetainedPresenceUntil = Date.now() + 5000;
      state = null;
      meta = null;
      metaOwned = false;
      presence = {};
      stateSeen = false;
      canvasSeen = false;
      pendingCanvas = null;
      canvasRound = 0;
      canvasVersion = 0;
      canvasOwner = '';
      pendingStrokes = {};
      futureStrokes = {};
      futureDeletions = {};
      deletedStrokes = {};
      seenChatIds = {};
      remoteDrafts = {};
      localDraft = null;
      drawing = false;
      handledStart = 0;
      handledHitId = null;
      handledRotation = null;
      handledRevealId = null;
      drawerMissingSince = 0;
      drawerOfflineAt = 0;
      publishPresence(true);
      renderAll();
      scheduleInitialState();
    }

    /* «Ждём» от ушедшего ведущего не должно наследоваться новому игроку.
       Если в комнате нет живых собеседников, чистим старый рисунок и состояние,
       чтобы комната началась с нового раунда. */
    function clearAbandonedWaiting() {
      if (typeof abandonedWaitingRoom !== 'function' || !abandonedWaitingRoom()) return false;
      clearOrphanedRoom();
      return true;
    }

    function scheduleOrphanCheck() {
      if (orphanCheckTimer) clearTimeout(orphanCheckTimer);
      orphanCheckTimer = setTimeout(function () {
        orphanCheckTimer = null;
        if (sessionKicked || !client.connected || !subscribedAt) return;
        /* После переподключения/возврата в вкладку старое состояние комнаты
           ещё может быть живым: даём время прислать retained-обновления. */
        if (skipOrphanUntil && Date.now() < skipOrphanUntil) {
          scheduleOrphanCheck();
          return;
        }
        if (activePeers().length) return;
        /* Медленный брокер может прислать retained-состояние позже. Пока оно
           не пришло и окно синхронизации не закрылось, ждём. */
        if (!stateSeen && !canvasSeen && !pendingCanvas &&
            Date.now() - subscribedAt < 15000) {
          scheduleOrphanCheck();
          return;
        }
        var oldState = !!(state && Number(state.updatedAt) &&
          Number(state.updatedAt) < subscribedAt - 500);
        var oldCanvas = !state && (stateSeen || canvasSeen || !!pendingCanvas);
        if (!oldState && !oldCanvas) return;
        clearOrphanedRoom();
      }, 1000);
    }

    function createInitialState() {
      ensureMeta();
      /* Гость по ссылке не создаёт комнату от чужого имени: иначе его meta
         забирала права создателя у настоящего владельца комнаты. */
      if (!metaOwned && room !== K.DEFAULT_ROOM) return;
      var peers = activePeers();
      var self = {
        id: myId, name: profile.name, color: profile.color, avatar: profile.avatar,
        fingerprint: myFingerprint, joinedAt: sessionJoinedAt, ts: Date.now(),
        online: true, noDraw: !!noDraw,
        bgColor: tool.bg || profile.bgColor || '#252932'
      };
      var players = peers.concat(peers.some(function (p) { return p.id === myId; }) ? [] : [self])
        .sort(function (a, b) { return (Number(a.joinedAt) || 0) - (Number(b.joinedAt) || 0); });
      var ids = players.map(function (p) { return p.id; });
      /* Пустая комната начинает рисование сразу с первого реального игрока,
         а не с призрака из retained-presence. Кто поставил «не хочу рисовать»,
         в стартовом ходе участвует только если желающих больше нет. */
      var willingIds = ids.filter(function (id) {
        var player = players.filter(function (p) { return p.id === id; })[0];
        return !(player && player.noDraw);
      });
      var drawerPool = willingIds.length ? willingIds : ids;
      var drawer = (typeof consensusPick === 'function'
        ? consensusPick(drawerPool, room + ':init')
        : drawerPool[Math.floor(Math.random() * drawerPool.length)]) || myId;
      var drawerProfile = players.filter(function (p) { return p.id === drawer; })[0];
      var drawerBg = drawerProfile && (drawerProfile.bgColor ||
        (drawerProfile.avatar && drawerProfile.avatar.bg));
      if (!/^#[0-9a-f]{6}$/i.test(String(drawerBg || ''))) drawerBg = '#252932';
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
        bg: drawerBg,
        bgBy: drawer,
        hintSent: false,
        hintStage: 0,
        hintLetters: {},
        hintsDisabled: false,
        waitingForPlayers: false,
        expiredAt: 0
      });
      resetRoundTimer();
      chooseNextWord();
      handledStart = 0;
      publishState();
      renderAll();
      finishResync();
    }
  
    function scheduleInitialState() {
      if (initialStateTimer) clearTimeout(initialStateTimer);
      initialStateTimer = setTimeout(function () {
        if (state || stateSeen || canvasSeen || pendingCanvas) return;
        if (resyncPending) {
          scheduleInitialState();
          return;
        }
        if (!client.connected || !subscribedAt) {
          scheduleInitialState();
          return;
        }
        /* Retained-presence с прошедшим ts не считается живым игроком: иначе
           пустая комната ждёт 12 секунд и выбирает Drawer-призрака. */
        var peers = activePeers();
        /* Комнату создаёт самый ранний из присутствующих. Позже вошедший игрок
           ждёт дольше и не пересоздаёт чужую комнату: именно преждевременный
           createInitialState обнулял холст у ведущего. Заброшенную комнату
           вправе пересоздать первый пришедший игрок. */
        if (meta && !metaOwned && room !== K.DEFAULT_ROOM) return;
        if (peers.length && meta && (meta.creatorId || meta.creatorFingerprint) && !isCreator()) return;
        var first = !peers.length || peers.every(function (p) {
          return (Number(p.joinedAt) || 0) >= sessionJoinedAt;
        });
        var waited = Date.now() - subscribedAt;
        if (waited < (first ? SOLO_GRACE_MS : 12000)) {
          scheduleInitialState();
          return;
        }
        if (!first) return;
        createInitialState();
      }, 1000);
    }
  
    G.applyMeta = applyMeta;
    G.ensureMeta = ensureMeta;
    G.createInitialState = createInitialState;
    G.scheduleInitialState = scheduleInitialState;
    G.resyncRoom = resyncRoom;
    G.refreshRoom = refreshRoom;
    G.clearAbandonedWaiting = clearAbandonedWaiting;
    G.isSyncPending = isSyncPending;
    G.finishResync = finishResync;
    G.flushPendingCanvas = flushPendingCanvas;
    G.flushPendingStrokes = flushPendingStrokes;
    G.flushFutureEvents = flushFutureEvents;
  }
})(window.KROKO_GAME);
