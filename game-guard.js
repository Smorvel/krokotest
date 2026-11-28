/* Room guard: validates MQTT payloads and recovers stuck rounds.
   All logic lives here; existing modules only call guardIncoming/guardTick. */
(function (G) {
  with (G) {
    var CLOCK_SKEW_MS = 3000;
    var HIT_WATCHDOG_MS = 4000;
    var REVEAL_MAX_FUTURE_MS = 5000;
    var REVEAL_HARD_GRACE_MS = 3000;
    var MAX_TEXT = 200;
    var MAX_CHAT_TEXT = 140;
    var MAX_STROKES = 2000;
    var MAX_STROKE_POINTS = 1200;
    var MAX_ARRAY_ITEMS = 200;

    var pauseKey = '';
    var pauseReactions = null;
    var liveChatAt = {};
    var seenReactions = {};

    function number(value, fallback, min, max) {
      var parsed = Number(value);
      if (!isFinite(parsed)) parsed = Number(fallback) || 0;
      return Math.max(min, Math.min(max, parsed));
    }

    function text(value, max) {
      return typeof value === 'string' ? value.slice(0, max) : '';
    }

    function copy(value) {
      try { return JSON.parse(JSON.stringify(value || {})); } catch (error) { return {}; }
    }

    function suffix(topic) {
      var prefix = K.topic(G.room, '');
      var full = String(topic || '');
      return full.indexOf(prefix) === 0 ? full.slice(prefix.length) : '';
    }

    function cleanMessage(raw, now) {
      if (!raw || typeof raw !== 'object' || !raw.id) return null;
      var item = {
        id: text(raw.id, 40),
        text: text(raw.text, MAX_CHAT_TEXT),
        at: number(raw.at, now, 0, now + CLOCK_SKEW_MS),
        round: Math.round(number(raw.round, 0, 0, 1000000))
      };
      if (!item.id || !item.text) return null;
      if (raw.ownerId) item.ownerId = text(raw.ownerId, 40);
      if (raw.name) item.name = text(raw.name, 40);
      if (raw.color) item.color = text(raw.color, 20);
      if (raw.hit) item.hit = true;
      if (raw.system) item.system = true;
      if (raw.avatar && typeof raw.avatar === 'object') {
        item.avatar = {
          body: text(raw.avatar.body, 20),
          eyes: text(raw.avatar.eyes, 20),
          mouth: text(raw.avatar.mouth, 20),
          bg: text(raw.avatar.bg, 20)
        };
      }
      return item;
    }

    function cleanHit(raw, now) {
      if (!raw || typeof raw !== 'object') return null;
      var hit = {
        id: text(raw.id, 60),
        at: number(raw.at, now, 0, now + CLOCK_SKEW_MS),
        reason: text(raw.reason, MAX_TEXT),
        text: text(raw.text, MAX_TEXT),
        guesserId: text(raw.guesserId, 40),
        guesserName: text(raw.guesserName, 40)
      };
      return hit.id ? hit : null;
    }

    function cleanReveal(raw, now) {
      if (!raw || typeof raw !== 'object') return null;
      var reveal = {
        id: text(raw.id, 60),
        word: text(raw.word, 120),
        round: Math.round(number(raw.round, 1, 1, 1000000)),
        /* Верхняя граница не даёт сломанному клиенту заморозить комнату
           раскрытием с «вечным» until. */
        until: number(raw.until, now, now - 30000, now + REVEAL_MAX_FUTURE_MS),
        reason: text(raw.reason, MAX_TEXT),
        guesserId: text(raw.guesserId, 40),
        guesserName: text(raw.guesserName, 40),
        leave: !!raw.leave,
        rotatedBy: text(raw.rotatedBy, 40)
      };
      return reveal.id && reveal.word ? reveal : null;
    }

    function cleanStringList(raw, max) {
      if (!Array.isArray(raw)) return [];
      return raw.slice(0, MAX_ARRAY_ITEMS).filter(function (item) {
        return typeof item === 'string' && item.length <= 40;
      });
    }

    function cleanState(raw, now) {
      var state = raw || {};
      now = now || Date.now();
      state.round = Math.round(number(state.round, 1, 1, 1000000));
      state.wordIndex = Math.round(number(state.wordIndex, 0, 0, 1000000));
      state.roundMs = number(state.roundMs, DEFAULT_ROUND_MS, 0, MAX_ROUND_MS);
      state.pendingRoundMs = number(state.pendingRoundMs, 0, 0, MAX_ROUND_MS);
      state.savedRoundMs = number(state.savedRoundMs, 0, 0, MAX_ROUND_MS);
      state.startedAt = number(state.startedAt, now, 0, now + CLOCK_SKEW_MS);
      state.deadline = number(state.deadline, 0, 0, now + state.roundMs + CLOCK_SKEW_MS);
      state.remainingMs = number(state.remainingMs, 0, 0, MAX_ROUND_MS + CLOCK_SKEW_MS);
      state.expiredAt = number(state.expiredAt, 0, 0, now + CLOCK_SKEW_MS);
      state.pausedUntil = number(state.pausedUntil, 0, 0, now + HIT_PAUSE_MS);
      state.updatedAt = number(state.updatedAt, now, 0, now);
      state.updatedBy = text(state.updatedBy, 40);
      state.rev = Math.round(number(state.rev, 0, 0, 1000000000));

      state.messages = Array.isArray(state.messages)
        ? state.messages.slice(-50).map(function (message) { return cleanMessage(message, now); }).filter(Boolean)
        : [];
      var messageIds = {};
      state.messages.forEach(function (message) { messageIds[message.id] = true; });

      var reactions = {};
      Object.keys(state.reactions && typeof state.reactions === 'object' ? state.reactions : {})
        .slice(0, MAX_ARRAY_ITEMS)
        .forEach(function (id) {
          if (!messageIds[id] || !state.reactions[id]) return;
          var raw = state.reactions[id];
          var value = raw.value === 'like' || raw.value === 'dislike' ? raw.value : '';
          var last = raw.lastValue === 'like' || raw.lastValue === 'dislike' ? raw.lastValue : value;
          reactions[id] = {
            value: value,
            lastValue: last,
            by: text(raw.by, 40),
            at: number(raw.at, now, 0, now + CLOCK_SKEW_MS)
          };
        });
      state.reactions = reactions;

      var scores = {};
      Object.keys(state.scores && typeof state.scores === 'object' ? state.scores : {})
        .slice(0, MAX_ARRAY_ITEMS)
        .forEach(function (name) {
          scores[text(name, 40)] = number(state.scores[name], 0, 0, 1000000000);
        });
      state.scores = scores;

      state.hitInfo = cleanHit(state.hitInfo, now);
      state.reveal = cleanReveal(state.reveal, now);
      state.lastWord = cleanReveal(state.lastWord, now);
      state.queue = cleanStringList(state.queue);
      state.bans = cleanStringList(state.bans);
      state.hintStage = Math.round(number(state.hintStage, 0, 0, 3));
      state.waitingForPlayers = !!state.waitingForPlayers;
      state.bg = text(state.bg, 20);
      state.bgBy = text(state.bgBy, 40);
      state.drawer = text(state.drawer, 40);

      state.systemEvents = Array.isArray(state.systemEvents)
        ? state.systemEvents.slice(-8).map(function (event) {
            if (!event || !event.id || !event.text) return null;
            var at = number(event.at, now, 0, now + CLOCK_SKEW_MS);
            if (at < now - SYSTEM_NOTICE_MS - 1000) return null;
            return { id: text(event.id, 40), text: text(event.text, MAX_TEXT), at: at };
          }).filter(Boolean)
        : [];

      if (Array.isArray(state.dictionaryPool)) state.dictionaryPool = state.dictionaryPool.slice(0, 20);
      if (Array.isArray(state.dictionaryIds)) state.dictionaryIds = state.dictionaryIds.slice(0, 20);
      return state;
    }

    function cleanStroke(raw, now) {
      if (!raw || typeof raw !== 'object') return null;
      var stroke = Object.assign({}, raw);
      stroke.id = text(raw.id, 40);
      stroke.seq = number(raw.seq, 0, 0, 1000000000);
      stroke.cw = number(raw.cw, 1000, 1, 5000);
      stroke.ch = number(raw.ch, 750, 1, 5000);
      stroke.size = number(raw.size, 12, 1, 200);
      stroke.alpha = number(raw.alpha, 1, 0, 1);
      if (Array.isArray(raw.points)) {
        stroke.points = raw.points.slice(0, MAX_STROKE_POINTS).map(function (point) {
          if (!point || typeof point !== 'object') return { x: 0, y: 0 };
          var clean = Object.assign({}, point);
          clean.x = number(point.x, 0, -100000, 100000);
          clean.y = number(point.y, 0, -100000, 100000);
          return clean;
        });
      }
      return stroke.id ? stroke : null;
    }

    function cleanCanvas(raw, now) {
      if (!raw || typeof raw !== 'object') return false;
      raw.round = Math.round(number(raw.round, 1, 1, 1000000));
      raw.seq = number(raw.seq, 0, 0, 1000000000);
      raw.by = text(raw.by, 40);
      raw.at = number(raw.at, now, 0, now + CLOCK_SKEW_MS);
      if (!Array.isArray(raw.strokes)) raw.strokes = [];
      raw.strokes = raw.strokes.slice(0, MAX_STROKES)
        .map(function (stroke) { return cleanStroke(stroke, now); }).filter(Boolean);
      return !!raw.by;
    }

    function cleanChat(raw, now) {
      if (!raw || typeof raw !== 'object') return false;
      raw.round = Math.round(number(raw.round, 0, 0, 1000000));
      raw.at = number(raw.at, now, 0, now + CLOCK_SKEW_MS);
      raw.message = cleanMessage(raw.message, now);
      if (!raw.message) return false;
      if (raw.hit && typeof raw.hit === 'object') {
        raw.hit.hitInfo = cleanHit(raw.hit.hitInfo, now);
        raw.hit.scoreName = text(raw.hit.scoreName, 40);
        raw.hit.score = number(raw.hit.score, 0, 0, 1000000000);
        raw.hit.guessedWords = cleanStringList(raw.hit.guessedWords);
        if (!raw.hit.hitInfo) delete raw.hit;
      }
      return true;
    }

    function cleanPresence(raw, topic, now) {
      if (!raw || typeof raw !== 'object') return false;
      var topicId = suffix(topic).slice('presence/'.length);
      if (topicId && raw.id && String(raw.id) !== topicId) return false;
      raw.id = text(raw.id || topicId, 40);
      if (!raw.id) return false;
      raw.name = text(raw.name, 40);
      raw.color = text(raw.color, 20);
      raw.fingerprint = text(raw.fingerprint, 60);
      raw.joinedAt = number(raw.joinedAt, now, 0, now + CLOCK_SKEW_MS);
      raw.ts = number(raw.ts, now, 0, now + CLOCK_SKEW_MS);
      raw.sessionClaimAt = number(raw.sessionClaimAt, 0, 0, now + CLOCK_SKEW_MS);
      raw.sessionClaimSeq = number(raw.sessionClaimSeq, 0, 0, 1000000000);
      raw.noDraw = !!raw.noDraw;
      raw.hidden = !!raw.hidden;
      raw.online = raw.online !== false;
      if (raw.bgColor && !/^#[0-9a-f]{6}$/i.test(String(raw.bgColor))) raw.bgColor = '#252932';
      if (raw.avatar && typeof raw.avatar === 'object') {
        raw.avatar.body = text(raw.avatar.body, 20);
        raw.avatar.eyes = text(raw.avatar.eyes, 20);
        raw.avatar.mouth = text(raw.avatar.mouth, 20);
        raw.avatar.bg = text(raw.avatar.bg, 20);
      }
      return true;
    }

    function cleanMeta(raw) {
      if (!raw || typeof raw !== 'object') return false;
      raw.name = text(raw.name, 80);
      raw.creatorId = text(raw.creatorId, 40);
      raw.creatorName = text(raw.creatorName, 40);
      raw.creatorFingerprint = text(raw.creatorFingerprint, 60);
      raw.createdAt = number(raw.createdAt, Date.now(), 0, Date.now() + CLOCK_SKEW_MS);
      if (Array.isArray(raw.dictionaryIds)) raw.dictionaryIds = raw.dictionaryIds.slice(0, 20);
      if (Array.isArray(raw.dictionaryPool)) raw.dictionaryPool = raw.dictionaryPool.slice(0, 20);
      return true;
    }

    /* Фиксируем реакции на момент начала паузы: пока слово раскрыто,
       менять лайки/дизлайки нельзя ни через UI, ни напрямую через MQTT. */
    function pauseIdentity(source) {
      if (!source) return '';
      if (source.hitInfo && source.hitInfo.id) return 'hit:' + source.hitInfo.id;
      if (source.reveal && source.reveal.id) return 'reveal:' + source.reveal.id;
      return '';
    }

    function syncPauseSnapshot(source) {
      /* При новой паузе, пришедшей из сети, снимок реакций берём именно из
         этого состояния: локальная копия может ещё не знать о паузе. */
      var origin = source && pauseIdentity(source) ? source
        : (state && pauseIdentity(state) ? state : null);
      var key = pauseIdentity(origin);
      if (!key) { pauseKey = ''; pauseReactions = null; return; }
      if (key !== pauseKey) {
        pauseKey = key;
        pauseReactions = copy(origin.reactions || {});
      }
    }

    function applyReactionLock(target) {
      if (!pauseReactions || !(target && (target.hitInfo || target.reveal))) return;
      target.reactions = copy(pauseReactions);
    }

    function paused() {
      return !!(state && (state.hitInfo || state.reveal));
    }

    function guardPublish(topic, value) {
      if (!value || typeof value !== 'object') return true;
      var kind = suffix(topic);
      var now = Date.now();
      syncPauseSnapshot();
      if (kind === 'state') {
        cleanState(value, now);
        applyReactionLock(value);
        return true;
      }
      if (kind === 'meta') return cleanMeta(value);
      if (kind.indexOf('presence/') === 0) return cleanPresence(value, topic, now);
      if (kind.indexOf('chat/') === 0) {
        var hasHit = !!(value.hit && value.hit.hitInfo);
        if (paused() && !hasHit) return false;
        return cleanChat(value, now);
      }
      if (kind.indexOf('canvas/') === 0) {
        if (paused()) return false;
        return cleanCanvas(value, now);
      }
      if (kind.indexOf('stroke/') === 0 || kind.indexOf('draft/') === 0) {
        if (paused() && value.stroke) return false;
        if (value.stroke && !cleanStroke(value.stroke, now)) return false;
        if (value.at) value.at = number(value.at, now, 0, now + CLOCK_SKEW_MS);
        return true;
      }
      return true;
    }

    function guardIncoming(topic, data, packet) {
      if (!data || typeof data !== 'object') return true;
      var kind = suffix(topic);
      if (!kind) return true;
      var now = Date.now();
      syncPauseSnapshot();
      var retained = !!(packet && packet.retain);

      if (kind === 'state') {
        cleanState(data, now);
        syncPauseSnapshot(data);
        applyReactionLock(data);
        /* Защита от спама реакциями: повтор того же значения не считается
           новым действием, а больше пяти действий в секунду отбрасывается. */
        var signatures = {};
        Object.keys(data.reactions || {}).forEach(function (id) {
          var reaction = data.reactions[id];
          var signature = id + '|' + reaction.value + '|' + reaction.at + '|' + reaction.by;
          if (seenReactions[signature]) return;
          seenReactions[signature] = now;
          var owner = reaction.by || id;
          var recent = (liveChatAt['r:' + owner] || []).filter(function (at) { return now - at < 1000; });
          if (recent.length >= 5) delete data.reactions[id];
          else {
            recent.push(now);
            liveChatAt['r:' + owner] = recent;
          }
          signatures[signature] = true;
        });
        return true;
      }
      if (kind === 'meta') return cleanMeta(data);
      if (kind.indexOf('presence/') === 0) return cleanPresence(data, topic, now);
      if (kind.indexOf('chat/') === 0) {
        if (!cleanChat(data, now)) return false;
        if (state && data.round && Number(data.round) < Number(state.round)) return false;
        var hasHit = !!(data.hit && data.hit.hitInfo);
        if (paused() && !hasHit) return false;
        if (!retained) {
          var owner = data.message.ownerId || data.message.name || 'guest';
          var recent = (liveChatAt['c:' + owner] || []).filter(function (at) { return now - at < 2000; });
          if (recent.length >= 5) return false;
          recent.push(now);
          liveChatAt['c:' + owner] = recent;
        }
        return true;
      }
      if (kind.indexOf('canvas/') === 0) {
        if (paused()) return false;
        return cleanCanvas(data, now);
      }
      if (kind.indexOf('stroke/') === 0 || kind.indexOf('draft/') === 0) {
        if (paused() && data.stroke) return false;
        if (data.stroke && !cleanStroke(data.stroke, now)) return false;
        if (data.at) data.at = number(data.at, now, 0, now + CLOCK_SKEW_MS);
        return true;
      }
      return true;
    }

    /* Аварийное завершение: работает даже если лидер замер в DevTools,
       а остальные игроки находятся в скрытых вкладках. */
    function guardTick() {
      if (!state || !client || !client.connected) return;
      var now = Date.now();
      syncPauseSnapshot();
      /* Проверяем очищенную копию, а не живое состояние: tick не должен
         менять таймеры и updatedAt и тем самым создавать лишний publish. */
      var safe = copy(state);
      cleanState(safe, now);
      applyReactionLock(state);

      var hit = safe.hitInfo;
      if (hit && !safe.reveal && now - Number(hit.at || now) > HIT_WATCHDOG_MS &&
          state.hitInfo && typeof scheduleHitResolution === 'function') {
        scheduleHitResolution(state.hitInfo);
      }

      var reveal = safe.reveal;
      if (reveal && state.reveal) {
        var until = Number(reveal.until) || now;
        if (now - until > REVEAL_HARD_GRACE_MS && !reveal.rotatedBy) {
          if (typeof finishReveal === 'function') finishReveal(state.reveal, true);
        }
      }

      if (typeof clearAbandonedWaiting === 'function') clearAbandonedWaiting();
      Object.keys(seenReactions).forEach(function (key) {
        if (now - Number(seenReactions[key]) > 60000) delete seenReactions[key];
      });
      Object.keys(liveChatAt).forEach(function (key) {
        var recent = (liveChatAt[key] || []).filter(function (at) { return now - at < 2000; });
        if (recent.length) liveChatAt[key] = recent;
        else delete liveChatAt[key];
      });
    }

    function systemNoticeKind(value) {
      var line = String(value || '').toLowerCase();
      if (line.indexOf('угадал') >= 0 || line.indexOf('угаданы') >= 0 ||
          line.indexOf('загаданное слово') >= 0) return 'reveal';
      if (line.indexOf('художник вышел') >= 0 || line.indexOf('время вышло') >= 0) return 'warning';
      return 'info';
    }

    var originalPublish = K.publish;
    K.publish = function (clientRef, topic, value, retain, qos) {
      if (typeof guardPublish === 'function' && !guardPublish(topic, value)) return false;
      return originalPublish.apply(K, arguments);
    };

    G.guardPublish = guardPublish;
    G.guardIncoming = guardIncoming;
    G.guardTick = guardTick;
    G.systemNoticeKind = systemNoticeKind;
    G.guardConstants = {
      hitWatchdogMs: HIT_WATCHDOG_MS,
      revealMaxFutureMs: REVEAL_MAX_FUTURE_MS,
      revealHardGraceMs: REVEAL_HARD_GRACE_MS
    };
  }
})(window.KROKO_GAME);
