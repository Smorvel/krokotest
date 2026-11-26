/* Онлайн-комната Кроко: кисти, словари-фразы, синхронизация через MQTT. */
(function () {
  'use strict';

  var K = window.KROKO;
  if (!K || !window.mqtt) return;

  var params = new URLSearchParams(location.search);
  var room = params.get('room') || K.DEFAULT_ROOM;
  var profile = K.getProfile();
  var myId = profile.id;
  var myFingerprint = profile.fingerprint || K.getFingerprint();
  var sessionJoinedAt = Date.now();

  var DEFAULT_ROUND_MS = 5 * 60 * 1000;
  var MAX_ROUND_MS = 60 * 60 * 1000;
  var HIT_PAUSE_MS = 2400;
  var HISTORY_LIMIT = 30;

  var PRESET_COLORS = [
    '#111827', '#ffffff', '#ef4444', '#f97316', '#fbbf24', '#a3e635',
    '#34d399', '#22d3ee', '#38bdf8', '#6366f1', '#a78bfa', '#f472b6'
  ];

  var SHAPE_LABELS = { square: 'квадрат', circle: 'круг', stripe: 'полоса' };

  var TOOLS = [
    { id: 'brush', name: 'Стандартная кисть', icon: '<path d="M4 18c2.2.6 4-.2 5-2 .8-1.5 1-3 2.5-4.5L16 7l3 3-5.5 5.5C12 16 10.5 16.2 9 17c-1.5 1-3.3 1.8-5 1Z"/>' },
    { id: 'soft', name: 'Мягкая кисть', icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>' },
    { id: 'tablet', name: 'Кисть для планшета', icon: '<path d="M4 19c2-6 3-9 5-9s2 7 4 7 2-9 4-9 2 6 3 11"/><path d="M8 4h8l1 3H7l1-3Z"/>' },
    { id: 'shape', name: 'Фигуры', icon: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 12h8"/>' },
    { id: 'fill', name: 'Заливка', icon: '<path d="m12 3 8 8-8 8-8-8 8-8Z"/><path d="M20 11c-2 2-3 3-3 4a2 2 0 0 0 4 0c0-1-1-2-1-4Z"/>' },
    { sep: true },
    { id: 'eraser', name: 'Ластик', icon: '<path d="m4 16 7-7 7 7-4 4H8l-4-4Z"/><path d="m8 12 5 5"/>' }
  ];

  var state = null;
  var meta = null;
  var stateSeen = false;
  var subscribedAt = 0;
  var presenceReadyAt = 0;
  var initialStateTimer = null;
  var presence = {};
  var remoteDrafts = {};
  var localDraft = null;
  var drawing = false;
  var lastDraftPublish = 0;
  var handledStart = null;
  var banned = false;
  var client = null;
  var activePanel = 'chat';
  var editingInlineDict = null;
  var handledHitId = null;
  var hitTimer = null;
  var wasHitPaused = false;
  var previousTool = 'brush';
  var draftFrame = null;
  var knobDrag = null;
  var stampCache = {};
  var smoothPoint = null;
  var lastCursorEvent = null;

  var tool = {
    current: 'brush',
    size: Number(profile.brushSize) || 18,
    alpha: Number(profile.brushAlpha) || 100,
    color: profile.inkColor || '#111827',
    bg: profile.bgColor || '#ffffff',
    smooth: profile.smoothing === true,
    shapeMode: SHAPE_LABELS[profile.shapeMode] ? profile.shapeMode : 'square'
  };

  var canvas = document.getElementById('drawCanvas');
  var draftCanvas = document.getElementById('draftCanvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var draftCtx = draftCanvas.getContext('2d');

  var el = {
    roomTitle: document.getElementById('roomTitle'),
    roomBadge: document.getElementById('roomBadge'),
    online: document.getElementById('onlineCount'),
    connection: document.getElementById('connectionText'),
    toolRail: document.getElementById('toolRail'),
    toolGrid: document.getElementById('toolGrid'),
    sizeKnob: document.getElementById('sizeKnob'),
    alphaKnob: document.getElementById('alphaKnob'),
    pipetteBtn: document.getElementById('pipetteBtn'),
    smoothBtn: document.getElementById('smoothBtn'),
    undo: document.getElementById('undoBtn'),
    clear: document.getElementById('clearBtn'),
    wordSourceLabel: document.getElementById('wordSourceLabel'),
    word: document.getElementById('wordText'),
    drawer: document.getElementById('drawerName'),
    round: document.getElementById('roundText'),
    timer: document.getElementById('timerText'),
    wrap: document.getElementById('canvasWrap'),
    cursor: document.getElementById('brushCursor'),
    hitToast: document.getElementById('hitToast'),
    inkBlobs: document.getElementById('inkBlobs'),
    bgSquare: document.getElementById('bgSquare'),
    colorEditorBtn: document.getElementById('colorEditorBtn'),
    colorEditor: document.getElementById('colorEditor'),
    inkColorInputs: document.querySelectorAll('.ink-color-input'),
    inkHexInputs: document.querySelectorAll('.ink-hex-input'),
    bgColorInputs: document.querySelectorAll('.bg-color-input'),
    bgHexInputs: document.querySelectorAll('.bg-hex-input'),
    editorRecent: document.getElementById('editorRecent'),
    palettePopover: document.getElementById('palettePopover'),
    popoverColorInput: document.getElementById('popoverColorInput'),
    popoverHexInput: document.getElementById('popoverHexInput'),
    palettePopoverClose: document.getElementById('palettePopoverClose'),
    status: document.getElementById('statusText'),
    sync: document.getElementById('syncText'),
    panelTabs: document.getElementById('panelTabs'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    players: document.getElementById('playersList'),
    playersCount: document.getElementById('playersCount'),
    banList: document.getElementById('banList'),
    messages: document.getElementById('messages'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    settingsRoomName: document.getElementById('settingsRoomName'),
    dictCheckList: document.getElementById('dictCheckList'),
    dictNote: document.getElementById('dictNote'),
    roundMinInput: document.getElementById('roundMinInput'),
    disableHintsInput: document.getElementById('disableHintsInput'),
    settingsNote: document.getElementById('settingsNote'),
    settingsName: document.getElementById('settingsName'),
    settingsNameSave: document.getElementById('settingsNameSave'),
    settingsSaved: document.getElementById('settingsSaved'),
    settingsDictList: document.getElementById('settingsDictList'),
    settingsDictName: document.getElementById('settingsDictName'),
    settingsDictWords: document.getElementById('settingsDictWords'),
    settingsDictSave: document.getElementById('settingsDictSave'),
    settingsDictDelete: document.getElementById('settingsDictDelete'),
    settingsDictNew: document.getElementById('settingsDictNew'),
    nameModal: document.getElementById('nameModal'),
    nameInput: document.getElementById('nameInput'),
    nameForm: document.getElementById('nameForm')
  };

  /* ---------- Словари и фразы ---------- */

  function fallbackDictionary() {
    return K.BUILTIN_DICTIONARIES[0];
  }

  function getDictionary() {
    if (state && state.dictionary && Array.isArray(state.dictionary.words) && state.dictionary.words.length) return state.dictionary;
    if (meta && meta.dictionary && Array.isArray(meta.dictionary.words) && meta.dictionary.words.length) return meta.dictionary;
    return fallbackDictionary();
  }

  function word() {
    var words = getDictionary().words;
    var index = ((state && state.wordIndex) || 0) % words.length;
    return words[index];
  }

  function normToken(token) {
    return String(token || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/gi, '');
  }

  function normPhrase(text) {
    return phraseWords(text).join(' ');
  }

  function phraseWords(text) {
    return String(text || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]+/gi) || [];
  }

  function phraseTargets() {
    var seen = {};
    var result = [];
    phraseWords(word()).forEach(function (token) {
      if (!token || seen[token]) return;
      seen[token] = true;
      result.push({ key: token, display: token });
    });
    return result;
  }

  function maskPhrase(text) {
    return displayCharacters(text, true).map(function (item) { return item.char; }).join('');
  }

  function displayCharacters(text, forceGuesser) {
    var guessed = {};
    (state && state.guessedWords || []).forEach(function (key) { guessed[key] = true; });
    var drawerView = !forceGuesser && isDrawer();
    var hintDue = !!(state && !state.hintsDisabled && state.roundMs > 0 &&
      Date.now() - state.startedAt >= state.roundMs * 0.9);
    var hintLeft = hintDue && !drawerView;
    var parts = String(text || '').split(/(\s+)/);
    var result = [];
    parts.forEach(function (part) {
      if (!part.trim()) {
        result.push({ char: part, space: true });
        return;
      }
      var key = normToken(part);
      var revealAll = drawerView || (key && guessed[key]);
      for (var i = 0; i < part.length; i++) {
        var ch = part.charAt(i);
        var isLetter = /[a-zа-яё0-9]/i.test(ch);
        if (!isLetter) {
          result.push({ char: ch, plain: true });
        } else if (revealAll || hintLeft) {
          if (hintLeft && !revealAll) hintLeft = false;
          result.push({ char: ch, revealed: true });
        } else {
          result.push({ char: '•', masked: true });
        }
      }
    });
    return result;
  }

  function reactionValue(id) {
    var reaction = state && state.reactions && state.reactions[id];
    if (!reaction) return '';
    if (reaction.value === 'like' || reaction.value === 'dislike') return reaction.value;
    if (Array.isArray(reaction.likes) && reaction.likes.length) return 'like';
    if (Array.isArray(reaction.dislikes) && reaction.dislikes.length) return 'dislike';
    return '';
  }

  function reactionIcon(value) {
    return value === 'like' ? '👍' : (value === 'dislike' ? '👎' : '');
  }

  function selectedDictionaryIds() {
    if (state && Array.isArray(state.dictionaryIds) && state.dictionaryIds.length) return state.dictionaryIds.slice();
    if (meta && Array.isArray(meta.dictionaryIds) && meta.dictionaryIds.length) return meta.dictionaryIds.slice();
    return [getDictionary().id];
  }

  function dictionariesByIds(ids) {
    var result = [];
    ids.forEach(function (id) {
      var dict = K.findDictionary(id);
      if (dict && dict.id === id && Array.isArray(dict.words) && dict.words.length && !result.some(function (d) { return d.id === dict.id; })) {
        result.push(dict);
      }
    });
    return result.length ? result : [fallbackDictionary()];
  }

  function availableDictionaries() {
    var source = null;
    if (state && Array.isArray(state.dictionaryPool) && state.dictionaryPool.length) source = state.dictionaryPool;
    else if (meta && Array.isArray(meta.dictionaryPool) && meta.dictionaryPool.length) source = meta.dictionaryPool;
    if (source) {
      var pool = source.filter(function (dict) {
        return dict && dict.id && dict.name && Array.isArray(dict.words) && dict.words.length;
      }).map(function (dict) {
        return { id: dict.id, name: dict.name, words: dict.words.slice(0, 500) };
      });
      if (pool.length) return pool;
    }
    return dictionariesByIds(selectedDictionaryIds());
  }

  function chooseNextWord() {
    if (!state) return;
    var dicts = availableDictionaries();
    var history = Array.isArray(state.wordHistory) ? state.wordHistory.slice() : [];
    var current = normPhrase(word());
    var pool = [];
    var all = [];

    dicts.forEach(function (dict) {
      dict.words.slice(0, 500).forEach(function (phrase, index) {
        var full = normPhrase(phrase);
        if (!full) return;
        var item = { dict: dict, index: index, full: full };
        all.push(item);
        if (full !== current && history.indexOf(full) < 0) pool.push(item);
      });
    });

    var choices = pool.length ? pool : (all.length ? all : [{ dict: fallbackDictionary(), index: 0, full: normPhrase(fallbackDictionary().words[0]) }]);
    var pick = choices[Math.floor(Math.random() * choices.length)];
    state.dictionary = { id: pick.dict.id, name: pick.dict.name, words: pick.dict.words.slice(0, 500) };
    state.wordIndex = pick.index;
    state.wordHistory = history.concat(pick.full).slice(-HISTORY_LIMIT);
    state.guessedWords = [];
    state.hintSent = false;
  }

  /* ---------- Бан: ID + отпечаток браузера ---------- */

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
    s.strokes = Array.isArray(s.strokes) ? s.strokes.slice(-80) : [];
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
          return { id: dict.id, name: dict.name, words: dict.words.slice(0, 500) };
        })
      : [];
    if (!s.dictionaryPool.length) {
      s.dictionaryPool = dictionariesByIds(s.dictionaryIds).map(function (dict) {
        return { id: dict.id, name: dict.name, words: dict.words.slice(0, 500) };
      });
    }
    s.wordHistory = Array.isArray(s.wordHistory) ? s.wordHistory.slice(-HISTORY_LIMIT) : [];
    s.guessedWords = Array.isArray(s.guessedWords) ? s.guessedWords : [];
    s.dictionary = { id: dictionary.id, name: dictionary.name, words: dictionary.words.slice(0, 500) };
    s.bg = typeof s.bg === 'string' ? s.bg : '#ffffff';
    s.drawer = typeof s.drawer === 'string' ? s.drawer : '';
    s.pausedUntil = Number(s.pausedUntil) || 0;
    s.hitInfo = s.hitInfo && typeof s.hitInfo === 'object' ? s.hitInfo : null;
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
      return p && p.online !== false && now - (Number(p.ts) || 0) < 60000 && !isPlayerBanned(p);
    });
    if (!isBannedMe() && !list.some(function (p) { return p.id === myId; })) {
      list.push({
        id: myId, name: profile.name, color: profile.color, fingerprint: myFingerprint,
        joinedAt: sessionJoinedAt, ts: Date.now(), online: true
      });
    }
    return list.sort(function (a, b) { return (Number(a.joinedAt) || 0) - (Number(b.joinedAt) || 0); });
  }

  function isDrawer() {
    return !!state && state.drawer === myId && !isBannedMe();
  }

  function publishState() {
    if (!state || !client || !client.connected) return;
    state.updatedAt = Date.now();
    state.updatedBy = myId;
    K.publish(client, K.topic(room, 'state'), state, true);
  }

  function publishPresence(online) {
    if (!client || !client.connected) return;
    K.publish(client, K.topic(room, 'presence/' + myId), {
      id: myId,
      name: profile.name,
      color: profile.color,
      fingerprint: myFingerprint,
      joinedAt: sessionJoinedAt,
      online: online !== false,
      ts: Date.now()
    }, true);
  }

  function publishDraft(stroke) {
    if (!client || !client.connected) return;
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
    state.strokes = [];
    state.hitInfo = null;
    state.pausedUntil = 0;
    state.waitingForPlayers = false;
    state.expiredAt = 0;
    handledHitId = null;
    handledStart = endingAt;
    drawing = false;
    localDraft = null;
    remoteDrafts = {};
    publishDraft(null);
    redrawBase();
    scheduleDrafts();
    var next = players.filter(function (p) { return p.id === state.drawer; })[0];
    systemMessage(reason + ' Следующий художник: ' + (next ? next.name : 'вы') + '.');
  }

  function checkTimeout() {
    if (!state || isHitPaused() || state.roundMs === 0) return;
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
    rotateDrawer('Время вышло!');
    publishState();
  }

  function issueHintIfNeeded() {
    if (!state || state.hintsDisabled || state.roundMs === 0 || state.hintSent || isHitPaused()) return;
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

  function scheduleHitResolution(info) {
    if (!info || !info.id || handledHitId === info.id) return;
    handledHitId = info.id;
    showHitAnimation(info);
    setTimeout(function () {
      if (!state || !state.hitInfo || state.hitInfo.id !== info.id) return;
      var drawerPresent = presentPlayers().some(function (p) { return p.id === state.drawer; });
      if (!isDrawer() && !(isCreator() && !drawerPresent)) return;
      rotateDrawer(state.hitInfo.reason || 'Все слова угаданы!');
      publishState();
    }, HIT_PAUSE_MS);
  }

  function ensureDrawer() {
    if (!state) return;
    if (presenceReadyAt && Date.now() < presenceReadyAt) return;
    var players = presentPlayers();
    var ids = players.map(function (p) { return p.id; });
    if (ids.indexOf(state.drawer) >= 0) return;
    state.queue = ids;
    state.drawer = ids[0] || myId;
    state.startedAt = Date.now();
    state.strokes = [];
    state.guessedWords = [];
    state.hintSent = false;
    remoteDrafts = {};
    localDraft = null;
    handledStart = 0;
    var next = players.filter(function (p) { return p.id === state.drawer; })[0];
    systemMessage('Художник вышел. Теперь рисует ' + (next ? next.name : profile.name) + '.');
    publishState();
  }

  /* ---------- Отрисовка ---------- */

  function pointFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
      p: event.pressure || 0.5,
      t: Date.now()
    };
  }

  function clockMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function resetSmoothing(point) {
    smoothPoint = {
      x: point.x, y: point.y,
      rawX: point.x, rawY: point.y,
      t: clockMs()
    };
  }

  function smoothInputPoint(raw, forceEnd) {
    var current = smoothPoint;
    if (!current) {
      resetSmoothing(raw);
      return raw;
    }
    var elapsed = (clockMs() - current.t) / 1000;
    var dt = Math.max(0.004, Math.min(0.05, elapsed > 0 ? elapsed : 0.016));
    var speed = Math.hypot(raw.x - current.rawX, raw.y - current.rawY) / dt;
    var cutoff = 1 + speed / 260;
    var alpha = forceEnd ? 1 : 1 - Math.exp(-dt * 2 * Math.PI * cutoff);
    var point = {
      x: current.x + (raw.x - current.x) * alpha,
      y: current.y + (raw.y - current.y) * alpha,
      p: raw.p,
      t: raw.t
    };
    smoothPoint = { x: point.x, y: point.y, rawX: raw.x, rawY: raw.y, t: clockMs() };
    return point;
  }

  function isShape(toolId) {
    return toolId === 'shape';
  }

  function polyline(context, points) {
    context.beginPath();
    if (!points.length) return;
    context.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
  }

  function smoothPath(context, points) {
    context.beginPath();
    if (!points.length) return;
    if (points.length === 1) {
      context.moveTo(points[0].x, points[0].y);
      context.lineTo(points[0].x + 0.01, points[0].y + 0.01);
      return;
    }
    if (points.length === 2) {
      context.moveTo(points[0].x, points[0].y);
      context.lineTo(points[1].x, points[1].y);
      return;
    }
    context.moveTo(points[0].x, points[0].y);
    for (var i = 0; i < points.length - 1; i++) {
      var p0 = points[i === 0 ? 0 : i - 1];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[i + 2] || p2;
      var cp1x = p1.x + (p2.x - p0.x) / 6;
      var cp1y = p1.y + (p2.y - p0.y) / 6;
      var cp2x = p2.x - (p3.x - p1.x) / 6;
      var cp2y = p2.y - (p3.y - p1.y) / 6;
      context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }

  function strokePath(context, points, smooth) {
    if (smooth) smoothPath(context, points);
    else polyline(context, points);
  }

  function stampAlong(points, spacing, callback) {
    if (!points.length) return;
    callback(points[0].x, points[0].y, points[0]);
    var carry = 0;
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1];
      var b = points[i];
      var dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist < 0.01) continue;
      var step = Math.max(1, spacing);
      var t = carry;
      while (t < dist) {
        var ratio = t / dist;
        callback(a.x + (b.x - a.x) * ratio, a.y + (b.y - a.y) * ratio, b);
        t += step;
      }
      carry = t - dist;
    }
  }

  function hexToRgb(color) {
    var value = String(color || '#000000').replace('#', '');
    if (value.length === 3) value = value.split('').map(function (c) { return c + c; }).join('');
    var num = parseInt(value, 16);
    if (isNaN(num)) return [0, 0, 0];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function floodFill(context, point, color, alpha) {
    var x = Math.max(0, Math.min(context.canvas.width - 1, Math.round(point.x)));
    var y = Math.max(0, Math.min(context.canvas.height - 1, Math.round(point.y)));
    var w = context.canvas.width;
    var h = context.canvas.height;
    var image = context.getImageData(0, 0, w, h);
    var data = image.data;
    var start = (y * w + x) * 4;
    var tr = data[start], tg = data[start + 1], tb = data[start + 2], ta = data[start + 3];
    var cr = hexToRgb(color);
    var a = Math.max(0.05, Math.min(1, alpha));
    var visited = new Uint8Array(w * h);
    var stack = [x, y];
    var maxSteps = w * h;

    function matches(index) {
      var offset = index * 4;
      return Math.abs(data[offset] - tr) <= 12 &&
        Math.abs(data[offset + 1] - tg) <= 12 &&
        Math.abs(data[offset + 2] - tb) <= 12 &&
        Math.abs(data[offset + 3] - ta) <= 12;
    }

    function paint(index) {
      var offset = index * 4;
      data[offset] = Math.round(cr[0] * a + data[offset] * (1 - a));
      data[offset + 1] = Math.round(cr[1] * a + data[offset + 1] * (1 - a));
      data[offset + 2] = Math.round(cr[2] * a + data[offset + 2] * (1 - a));
      data[offset + 3] = Math.round(255 * a + data[offset + 3] * (1 - a));
    }

    var steps = 0;
    while (stack.length && steps < maxSteps) {
      var py = stack.pop();
      var px = stack.pop();
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      var index = py * w + px;
      if (visited[index] || !matches(index)) continue;
      visited[index] = 1;
      paint(index);
      steps++;
      stack.push(px - 1, py, px + 1, py, px, py - 1, px, py + 1);
    }
    context.putImageData(image, 0, 0);
  }

  function cachedStamp(key, diameter, draw) {
    var cached = stampCache[key];
    if (!cached) {
      var pad = 3;
      var side = Math.ceil(diameter) + pad * 2;
      var stamp = document.createElement('canvas');
      stamp.width = side;
      stamp.height = side;
      var stampCtx = stamp.getContext('2d');
      draw(stampCtx, side / 2, diameter);
      cached = { canvas: stamp, half: side / 2 };
      stampCache[key] = cached;
    }
    return cached;
  }

  function paintStroke(context, stroke) {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return;
    var points = stroke.points;
    var size = Math.max(2, Number(stroke.size) || 18);
    var color = stroke.color || '#111827';
    var alpha = stroke.alpha == null ? 1 : Math.max(0.05, Math.min(1, Number(stroke.alpha)));
    var smooth = !!stroke.smooth;
    var start = points[0];
    var end = points[points.length - 1];

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = alpha;
    context.globalCompositeOperation = 'source-over';

    if (stroke.tool === 'eraser') {
      var eraseColor = stroke.bg || (state && state.bg) || tool.bg || '#ffffff';
      context.globalAlpha = 1;
      context.strokeStyle = eraseColor;
      context.fillStyle = eraseColor;
      context.lineWidth = size * 1.5;
      strokePath(context, points, smooth);
      context.stroke();
      context.restore();
      return;
    }

    if (stroke.tool === 'soft') {
      var rgb = hexToRgb(color);
      var radius = size * 1.05;
      var stamp = cachedStamp('soft|' + color + '|' + alpha.toFixed(2) + '|' + radius.toFixed(1), radius * 2, function (c, center, diameter) {
        var r = diameter / 2;
        var gradient = c.createRadialGradient(center, center, 0, center, center, r);
        gradient.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.72 * alpha).toFixed(3) + ')');
        gradient.addColorStop(0.45, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.28 * alpha).toFixed(3) + ')');
        gradient.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
        c.fillStyle = gradient;
        c.beginPath();
        c.arc(center, center, r, 0, Math.PI * 2);
        c.fill();
      });
      context.globalAlpha = 1;
      stampAlong(points, Math.max(2, radius * 0.3), function (x, y) {
        context.drawImage(stamp.canvas, x - stamp.half, y - stamp.half);
      });
      context.restore();
      return;
    }

    if (stroke.tool === 'tablet') {
      var lastWidth = size;
      context.globalAlpha = alpha;
      for (var i = 1; i < points.length; i++) {
        var a = points[i - 1];
        var b = points[i];
        var dist = Math.hypot(b.x - a.x, b.y - a.y);
        var dt = a.t && b.t ? Math.max(1, b.t - a.t) : 16;
        var speed = dist / dt;
        var target = size * Math.max(0.6, Math.min(1.9, 1.85 - speed * 0.5));
        if (b.p && b.p > 0 && b.p !== 0.5) target *= Math.max(0.75, Math.min(1.3, 0.7 + b.p * 0.6));
        var width = lastWidth * 0.55 + target * 0.45;
        lastWidth = width;
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      if (points.length === 1) {
        context.beginPath();
        context.arc(points[0].x, points[0].y, size * 0.8, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
      return;
    }

    if (stroke.tool === 'shape') {
      var mode = SHAPE_LABELS[stroke.shapeMode] ? stroke.shapeMode : tool.shapeMode;
      var shapeStart = points[0];
      var shapeEnd = points[points.length - 1];
      var dx = shapeEnd.x - shapeStart.x;
      var dy = shapeEnd.y - shapeStart.y;
      context.lineWidth = Math.max(2, size);
      context.beginPath();
      if (mode === 'stripe') {
        context.moveTo(shapeStart.x, shapeStart.y);
        context.lineTo(shapeEnd.x, shapeEnd.y);
        context.stroke();
      } else if (mode === 'circle') {
        var radius = Math.max(2, Math.hypot(dx, dy) / 2);
        context.arc((shapeStart.x + shapeEnd.x) / 2, (shapeStart.y + shapeEnd.y) / 2, radius, 0, Math.PI * 2);
        context.stroke();
      } else {
        var side = Math.max(2, Math.abs(dx), Math.abs(dy));
        context.rect(shapeStart.x, shapeStart.y, dx < 0 ? -side : side, dy < 0 ? -side : side);
        context.stroke();
      }
      context.restore();
      return;
    }

    switch (stroke.tool) {
      case 'pencil':
        context.globalAlpha = 0.92 * alpha;
        context.lineWidth = Math.max(1, size * 0.45);
        strokePath(context, points, smooth);
        context.stroke();
        break;
      case 'marker':
        context.globalAlpha = 0.34 * alpha;
        context.lineWidth = size * 1.5;
        strokePath(context, points, smooth);
        context.stroke();
        break;
      case 'airbrush':
        points.forEach(function (point) {
          var radius = size * 0.75;
          var gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
          gradient.addColorStop(0, color);
          gradient.addColorStop(1, 'rgba(0,0,0,0)');
          context.globalAlpha = 0.075 * alpha;
          context.fillStyle = gradient;
          context.beginPath();
          context.arc(point.x, point.y, radius, 0, Math.PI * 2);
          context.fill();
        });
        break;
      case 'line':
        context.lineWidth = size;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        break;
      case 'rect': {
        var minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
        var minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
        context.lineWidth = size;
        context.strokeRect(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
        break;
      }
      case 'ellipse': {
        var cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
        var rx = Math.max(1, Math.abs(end.x - start.x) / 2);
        var ry = Math.max(1, Math.abs(end.y - start.y) / 2);
        context.lineWidth = size;
        context.beginPath();
        context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        context.stroke();
        break;
      }
      case 'fill':
        context.restore();
        floodFill(context, start, color, alpha);
        return;
      default:
        context.lineWidth = size;
        strokePath(context, points, smooth);
        context.stroke();
    }
    context.restore();
  }

  function redrawBase() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = (state && state.bg) || tool.bg || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (state) state.strokes.forEach(function (stroke) { paintStroke(ctx, stroke); });
    ctx.restore();
  }

  function redrawDrafts() {
    draftFrame = null;
    draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
    Object.keys(remoteDrafts).forEach(function (id) {
      var draft = remoteDrafts[id];
      if (!draft || id === myId || draft.tool === 'fill') return;
      if (draft.pendingUntil && Date.now() > draft.pendingUntil) return;
      paintStroke(draftCtx, draft);
    });
    if (localDraft) paintStroke(draftCtx, localDraft);
  }

  function scheduleDrafts() {
    if (draftFrame) return;
    draftFrame = requestAnimationFrame(redrawDrafts);
  }

  function cursorFactor() {
    if (tool.current === 'soft') return 2.1;
    if (tool.current === 'eraser') return 1.5;
    if (tool.current === 'tablet') return 1.8;
    return 1;
  }

  function updateCursor(event) {
    if (isBannedMe() || !isDrawer()) { el.cursor.hidden = true; return; }
    lastCursorEvent = { clientX: event.clientX, clientY: event.clientY };
    var rect = el.wrap.getBoundingClientRect();
    var scale = rect.width / canvas.width;
    var picking = tool.current === 'pipette';
    var diameter = picking ? 30 : Math.max(4, Math.round(tool.size * cursorFactor() * scale));
    el.cursor.style.width = diameter + 'px';
    el.cursor.style.height = diameter + 'px';
    el.cursor.style.left = (event.clientX - rect.left) + 'px';
    el.cursor.style.top = (event.clientY - rect.top) + 'px';
    el.cursor.style.borderColor = picking ? '#34d399' : (tool.current === 'eraser' ? '#fb7185' : '#111827');
    el.cursor.style.borderStyle = picking ? 'dashed' : 'solid';
    el.cursor.className = 'brush-cursor ' + (picking ? 'pipette-cursor' : 'shape-' + (tool.current === 'shape' ? tool.shapeMode : 'circle'));
    el.cursor.textContent = picking ? '💧' : '';
    el.cursor.hidden = false;
  }

  function refreshCursor() {
    if (lastCursorEvent) updateCursor(lastCursorEvent);
  }

  /* ---------- Интерфейс ---------- */

  function renderPlayers() {
    var players = presentPlayers();
    el.online.textContent = players.length;
    el.playersCount.textContent = players.length;
    el.players.innerHTML = players.map(function (player) {
      var initial = K.escapeHtml(player.name.trim().charAt(0).toUpperCase() || '?');
      var tag = state && state.drawer === player.id ? 'рисует' : (player.id === myId ? 'вы' : '');
      var ban = isCreator() && player.id !== myId && !isFingerprintBanned(player.fingerprint)
        ? '<button class="ban-btn" type="button" data-ban="' + K.escapeHtml(player.id) + '">бан</button>'
        : '';
      return '<li class="player"><span class="avatar" style="background:' + K.escapeHtml(player.color || K.colorFor(player.name)) + '">' + initial + '</span>' +
        '<span class="player-name">' + K.escapeHtml(player.name) + '</span>' +
        (tag ? '<span class="player-tag">' + tag + '</span>' : '') + ban + '</li>';
    }).join('');
  }

  function renderBanList() {
    var records = state && Array.isArray(state.banRecords) ? state.banRecords : [];
    if (!records.length) {
      el.banList.innerHTML = '<p class="ban-empty">Заблокированных игроков нет.</p>';
      return;
    }
    el.banList.innerHTML = records.map(function (record) {
      var unban = isCreator()
        ? '<button class="unban-btn" type="button" data-unban="' + K.escapeHtml(record.id) + '">разбанить</button>'
        : '';
      return '<div class="ban-row"><span>' + K.escapeHtml(record.name || 'Игрок') + '</span>' + unban + '</div>';
    }).join('');
  }

  function reactionMarkup(message) {
    if (message.system) return '';
    var value = reactionValue(message.id);
    if (!isDrawer() || isBannedMe()) {
      return value ? '<span class="react-mark">' + reactionIcon(value) + '</span>' : '';
    }
    return '<span class="reaction-slot">' +
      '<button class="react-btn' + (value === 'like' ? ' active' : '') + '" type="button" data-react="like" data-msg="' + K.escapeHtml(message.id) + '" aria-label="Лайк">👍</button>' +
      '<button class="react-btn' + (value === 'dislike' ? ' active' : '') + '" type="button" data-react="dislike" data-msg="' + K.escapeHtml(message.id) + '" aria-label="Дизлайк">👎</button>' +
      '</span>';
  }

  function renderMessages() {
    if (!state) return;
    var bannedIds = state.bans || [];
    el.messages.innerHTML = state.messages.filter(function (m) {
      return !(m.ownerId && bannedIds.indexOf(m.ownerId) >= 0);
    }).map(function (message) {
      var old = message.round && state.round && Number(message.round) < state.round;
      var cls = 'message' + (old ? ' old' : '') + (message.system ? ' system' : '') + (message.hit ? ' hit' : '');
      var body = message.system
        ? K.escapeHtml(message.text)
        : '<b>' + K.escapeHtml(message.name) + ':</b> ' + K.escapeHtml(message.text);
      return '<div class="' + cls + '">' + reactionMarkup(message) + body + '</div>';
    }).join('');
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function renderWord() {
    if (!state) return;
    var players = presentPlayers();
    var drawer = players.filter(function (p) { return p.id === state.drawer; })[0];
    el.drawer.textContent = drawer ? drawer.name : '—';
    el.round.textContent = state.round;
    el.wordSourceLabel.textContent = getDictionary().name;
    el.word.textContent = displayCharacters(word()).map(function (item) { return item.char; }).join('');
  }

  function swatchButton(color, className) {
    var active = tool.color.toLowerCase() === color.toLowerCase() ? ' active' : '';
    return '<button class="' + className + active + '" type="button" data-color="' + K.escapeHtml(color) + '" style="background:' + K.escapeHtml(color) + '" title="' + K.escapeHtml(color) + '"></button>';
  }

  function renderPalettes() {
    var recent = (profile.recentColors || []).slice(0, 9);
    while (recent.length < 9) recent.push('');
    if (el.inkBlobs) el.inkBlobs.innerHTML = PRESET_COLORS.map(function (c) { return swatchButton(c, 'ink-blob '); }).join('');
    if (el.editorRecent) {
      el.editorRecent.innerHTML = recent.map(function (color) {
        return color ? swatchButton(color, 'swatch ') : '<span class="empty-swatch"></span>';
      }).join('');
    }
    el.bgSquare.style.background = tool.bg;
  }

  function applyColorInputs() {
    [].forEach.call(el.inkColorInputs, function (input) { input.value = tool.color; });
    [].forEach.call(el.inkHexInputs, function (input) { input.value = tool.color; });
    [].forEach.call(el.bgColorInputs, function (input) { input.value = tool.bg; });
    [].forEach.call(el.bgHexInputs, function (input) { input.value = tool.bg; });
  }

  function renderToolGrid() {
    el.toolGrid.innerHTML = TOOLS.map(function (entry) {
      if (entry.sep) return '<div class="tool-btn tool-sep" aria-hidden="true"></div>';
      var title = entry.name + (entry.id === 'shape' ? ': ' + SHAPE_LABELS[tool.shapeMode] : '');
      return '<button class="tool-btn' + (tool.current === entry.id ? ' active' : '') + '" type="button" data-tool="' + entry.id + '" title="' + K.escapeHtml(title) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + entry.icon + '</svg></button>';
    }).join('');
  }

  function renderDictChecks() {
    var selected = selectedDictionaryIds();
    var all = K.getDictionaries().slice();
    availableDictionaries().forEach(function (dict) {
      if (!all.some(function (item) { return item.id === dict.id; })) all.push(dict);
    });
    el.dictCheckList.innerHTML = all.map(function (dict) {
      var checked = selected.indexOf(dict.id) >= 0 ? ' checked' : '';
      return '<label class="dict-check"><input type="checkbox" value="' + K.escapeHtml(dict.id) + '"' + checked + '>' +
        '<span>' + K.escapeHtml(dict.name) + '</span><small>' + dict.words.length + '</small></label>';
    }).join('');
  }

  function renderInlineDicts() {
    var custom = K.getCustomDictionaries();
    el.settingsDictList.innerHTML = custom.length
      ? custom.map(function (dict) {
          return '<button class="dict-item' + (dict.id === editingInlineDict ? ' active' : '') + '" type="button" data-id="' + K.escapeHtml(dict.id) + '">' +
            '<span>' + K.escapeHtml(dict.name) + '</span><small>' + dict.words.length + '</small></button>';
        }).join('')
      : '<p class="empty">Своих словарей пока нет.</p>';
    el.settingsDictDelete.disabled = !editingInlineDict;
  }

  function renderTools() {
    var canDraw = isDrawer() && !isBannedMe();
    renderToolGrid();
    el.toolRail.classList.toggle('disabled', !canDraw);
    el.toolGrid.querySelectorAll('button').forEach(function (button) {
      button.disabled = !canDraw;
    });

    renderKnobs();
    el.pipetteBtn.classList.toggle('active', tool.current === 'pipette');
    var smoothTitle = 'Плавность: ' + (tool.smooth ? 'вкл' : 'выкл');
    el.smoothBtn.textContent = '≈';
    el.smoothBtn.title = smoothTitle;
    el.smoothBtn.classList.toggle('active', tool.smooth);
    el.smoothBtn.setAttribute('aria-pressed', tool.smooth ? 'true' : 'false');
    el.smoothBtn.disabled = !canDraw;

    el.undo.disabled = !canDraw;
    el.clear.disabled = !canDraw;

    applyColorInputs();
    renderPalettes();

    if (isBannedMe()) el.status.textContent = 'Вы заблокированы в этой комнате';
    else if (canDraw) el.status.textContent = 'Вы рисуете слово. Остальные угадывают!';
    else el.status.textContent = 'Вы угадываете. Рисунок виден без затемнения!';
    el.sync.textContent = client && client.connected ? 'онлайн-синхронизация' : 'переподключение...';
    el.chatInput.disabled = isBannedMe() || isHitPaused();
    el.chatInput.placeholder = isHitPaused() ? 'Пауза — смотрите анимацию...' : 'Напиши слово...';

    el.roomBadge.hidden = !isCreator();
    el.settingsRoomName.textContent = (meta && meta.name) || room;
    el.roundMinInput.disabled = !isCreator();
    el.settingsNote.textContent = isCreator()
      ? 'Вы создатель комнаты: можно менять словари и время раунда.'
      : 'Сменять словари и время может только создатель комнаты.';
    el.dictNote.textContent = isCreator()
      ? 'Изменения начнут действовать со следующего раунда.'
      : 'Словари выбирает создатель комнаты.';
    var currentRoundMs = state && typeof state.roundMs === 'number' ? state.roundMs : DEFAULT_ROUND_MS;
    var minutes = Math.round(currentRoundMs / 60000 * 10) / 10;
    if (document.activeElement !== el.roundMinInput) el.roundMinInput.value = minutes;
    el.disableHintsInput.checked = !!(state && state.hintsDisabled);
    el.disableHintsInput.disabled = !isCreator();
    if (document.activeElement !== el.settingsName) el.settingsName.value = profile.name;
    renderDictChecks();
    renderInlineDicts();
    renderBanList();
  }

  function renderTimer() {
    if (!state) return;
    var pausedNow = isHitPaused();
    if (wasHitPaused && !pausedNow) renderTools();
    wasHitPaused = pausedNow;
    if (pausedNow) { el.timer.textContent = 'пауза'; return; }
    if (!state.roundMs) { el.timer.textContent = '∞'; return; }
    if (state.waitingForPlayers) { el.timer.textContent = '0:00 · ждём'; return; }
    var left = Math.max(0, Math.ceil((state.roundMs - (Date.now() - state.startedAt)) / 1000));
    el.timer.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  }

  function renderAll() {
    banned = isBannedMe();
    renderPlayers();
    renderMessages();
    renderWord();
    renderTools();
    renderTimer();
    redrawBase();
    scheduleDrafts();
  }

  function applyMeta() {
    if (!meta) return;
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
      name: local ? local.name : (room === K.DEFAULT_ROOM ? 'Простые' : room),
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
      state = normalizeState(data);
      Object.keys(remoteDrafts).forEach(function (id) {
        var draft = remoteDrafts[id];
        if (!draft) return;
        var committed = state.strokes.some(function (stroke) { return stroke.id === draft.id; });
        if (committed) delete remoteDrafts[id];
      });
      banned = isBannedMe();

      if (!banned && state.queue.indexOf(myId) < 0) {
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
      if (state.hitInfo) scheduleHitResolution(state.hitInfo);
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
      bg: '#ffffff',
      hintSent: false,
      hintsDisabled: false,
      waitingForPlayers: false,
      expiredAt: 0
    });
    chooseNextWord();
    systemMessage('Комната «' + (meta ? meta.name : 'Простые') + '» готова. Удачи!');
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

  /* ---------- Холст ---------- */

  canvas.addEventListener('pointerdown', function (event) {
    if (!state || !isDrawer()) return;
    event.preventDefault();
    updateCursor(event);

    if (tool.current === 'pipette') {
      var pos = pointFromEvent(event);
      var pixel = ctx.getImageData(
        Math.min(canvas.width - 1, Math.max(0, Math.floor(pos.x))),
        Math.min(canvas.height - 1, Math.max(0, Math.floor(pos.y))),
        1, 1
      ).data;
      setInk('#' + [pixel[0], pixel[1], pixel[2]].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''));
      tool.current = previousTool;
      renderTools();
      refreshCursor();
      return;
    }

    if (tool.current === 'fill') {
      var fillStroke = {
        id: K.uid(),
        owner: myId,
        tool: 'fill',
        color: tool.color,
        size: tool.size,
        alpha: tool.alpha / 100,
        smooth: false,
        shapeMode: tool.shapeMode,
        bg: tool.bg,
        points: [pointFromEvent(event)]
      };
      state.strokes.push(fillStroke);
      state.strokes = state.strokes.slice(-80);
      publishState();
      redrawBase();
      return;
    }

    drawing = true;
    try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* синтетические события */ }
    var startPoint = pointFromEvent(event);
    resetSmoothing(startPoint);
    localDraft = {
      id: K.uid(),
      owner: myId,
      tool: tool.current,
      color: tool.color,
      size: tool.size,
      alpha: tool.alpha / 100,
      smooth: tool.smooth,
      shapeMode: tool.shapeMode,
      bg: tool.bg,
      points: [startPoint]
    };
    scheduleDrafts();
  });

  canvas.addEventListener('pointermove', function (event) {
    updateCursor(event);
    if (!drawing || !localDraft) return;
    event.preventDefault();
    var raw = pointFromEvent(event);
    var next = tool.smooth && !isShape(tool.current) ? smoothInputPoint(raw, false) : raw;
    if (isShape(tool.current)) {
      localDraft.points = [localDraft.points[0], next];
    } else {
      var last = localDraft.points[localDraft.points.length - 1];
      if (Math.hypot(next.x - last.x, next.y - last.y) < 1) return;
      if (localDraft.points.length < 4000) localDraft.points.push(next);
    }
    scheduleDrafts();
    if (Date.now() - lastDraftPublish > 110) {
      lastDraftPublish = Date.now();
      publishDraft(localDraft);
    }
  });

  function endStroke(event) {
    if (!drawing) return;
    drawing = false;
    if (localDraft) {
      if (event && event.type === 'pointerup') {
        var rawEnd = pointFromEvent(event);
        var endPoint = localDraft.smooth && !isShape(localDraft.tool)
          ? smoothInputPoint(rawEnd, true) : rawEnd;
        if (localDraft.tool === 'shape') {
          if (localDraft.points.length < 2) localDraft.points.push(endPoint);
          else localDraft.points[localDraft.points.length - 1] = endPoint;
        } else {
          localDraft.points.push(endPoint);
        }
      }
      smoothPoint = null;
      state.strokes.push(localDraft);
      state.strokes = state.strokes.slice(-80);
      localDraft = null;
      publishState();
      publishDraft(null);
      redrawBase();
      scheduleDrafts();
    }
    if (event) updateCursor(event);
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  document.addEventListener('pointerup', function (event) { if (drawing) endStroke(event); });
  document.addEventListener('pointercancel', function (event) { if (drawing) endStroke(event); });
  canvas.addEventListener('pointerleave', function () { if (!drawing) el.cursor.hidden = true; });
  canvas.addEventListener('wheel', function (event) {
    if (!isDrawer() || isBannedMe()) return;
    event.preventDefault();
    setKnobValue('size', tool.size + (event.deltaY < 0 ? 2 : -2));
    K.setProfile(profile);
    updateCursor(event);
  }, { passive: false });

  /* Кружки размера и прозрачности */

  function renderKnobs() {
    var scale = (tool.size - 2) / (64 - 2);
    var dot = Math.round(6 + Math.max(0, Math.min(1, scale)) * 20);
    el.sizeKnob.style.setProperty('--knob-size', dot + 'px');
    el.sizeKnob.style.setProperty('--knob-fill', tool.color);
    el.alphaKnob.style.setProperty('--knob-fill', tool.color);
    el.alphaKnob.style.setProperty('--knob-alpha', (tool.alpha / 100).toFixed(2));
    el.sizeKnob.title = 'Размер: ' + tool.size + ' пикселей. Тяните вверх или вниз, клик — палитра.';
    el.alphaKnob.title = 'Прозрачность: ' + tool.alpha + '%. Тяните вверх или вниз, клик — палитра.';
  }

  function setKnobValue(kind, value) {
    var min = kind === 'size' ? 2 : 5;
    var max = kind === 'size' ? 64 : 100;
    var next = Math.max(min, Math.min(max, Math.round(value)));
    if (kind === 'size') {
      tool.size = next;
      profile.brushSize = next;
    } else {
      tool.alpha = next;
      profile.brushAlpha = next;
    }
    renderKnobs();
    return next;
  }

  function beginKnobDrag(event, kind) {
    if (event.button !== 0) return;
    event.preventDefault();
    knobDrag = {
      kind: kind,
      startY: event.clientY,
      startValue: kind === 'size' ? tool.size : tool.alpha,
      sensitivity: kind === 'size' ? 0.5 : 1,
      moved: false,
      button: event.currentTarget
    };
    knobDrag.button.classList.add('dragging');
    try { knobDrag.button.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
  }

  document.addEventListener('pointermove', function (event) {
    if (!knobDrag) return;
    var delta = knobDrag.startY - event.clientY;
    if (Math.abs(delta) > 3) knobDrag.moved = true;
    if (knobDrag.moved) setKnobValue(knobDrag.kind, knobDrag.startValue + delta * knobDrag.sensitivity);
  });

  document.addEventListener('pointerup', function () {
    if (!knobDrag) return;
    var drag = knobDrag;
    knobDrag = null;
    drag.button.classList.remove('dragging');
    K.setProfile(profile);
    if (!drag.moved) openPalettePopover(drag.button);
  });

  function openPalettePopover(anchor) {
    var rect = anchor.getBoundingClientRect();
    el.popoverColorInput.value = tool.color;
    el.popoverHexInput.value = tool.color;
    el.palettePopover.hidden = false;
    el.palettePopover.style.left = Math.min(window.innerWidth - 270, rect.right + 10) + 'px';
    el.palettePopover.style.top = Math.min(window.innerHeight - 300, rect.top) + 'px';
  }

  function closePalettePopover() {
    el.palettePopover.hidden = true;
  }

  el.sizeKnob.addEventListener('pointerdown', function (event) { beginKnobDrag(event, 'size'); });
  el.alphaKnob.addEventListener('pointerdown', function (event) { beginKnobDrag(event, 'alpha'); });
  el.palettePopoverClose.addEventListener('click', closePalettePopover);
  el.popoverColorInput.addEventListener('input', function () { setInk(el.popoverColorInput.value); });
  el.popoverHexInput.addEventListener('change', function () {
    setInk(el.popoverHexInput.value);
    el.popoverHexInput.value = tool.color;
  });
  document.addEventListener('pointerdown', function (event) {
    if (el.palettePopover.hidden) return;
    if (el.palettePopover.contains(event.target) || event.target === el.sizeKnob || event.target === el.alphaKnob) return;
    closePalettePopover();
  });

  /* Панель инструментов и цвета */

  function renderToolsOnce() {
    renderToolGrid();
    applyColorInputs();
  }

  el.toolGrid.addEventListener('click', function (event) {
    var btn = event.target.closest('.tool-btn[data-tool]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.tool === 'shape' && tool.current === 'shape') {
      var modes = ['square', 'circle', 'stripe'];
      tool.shapeMode = modes[(modes.indexOf(tool.shapeMode) + 1) % modes.length];
      profile.shapeMode = tool.shapeMode;
      K.setProfile(profile);
    } else {
      tool.current = btn.dataset.tool;
      if (tool.current !== 'pipette') previousTool = tool.current;
    }
    renderTools();
    refreshCursor();
  });

  function rememberColor(color) {
    var colors = profile.recentColors || [];
    colors = [color].concat(colors.filter(function (c) { return c !== color; })).slice(0, 9);
    profile.recentColors = colors;
    K.setProfile(profile);
    renderPalettes();
  }

  function setInk(color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    tool.color = color.toLowerCase();
    profile.inkColor = tool.color;
    rememberColor(tool.color);
    applyColorInputs();
    renderKnobs();
  }

  function setBg(color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    tool.bg = color.toLowerCase();
    profile.bgColor = tool.bg;
    K.setProfile(profile);
    applyColorInputs();
    if (state && isDrawer()) { state.bg = tool.bg; publishState(); }
    redrawBase();
    renderPalettes();
  }

  document.addEventListener('click', function (event) {
    var swatch = event.target.closest('[data-color]');
    if (swatch && !swatch.disabled) setInk(swatch.dataset.color);
  });

  [].forEach.call(el.inkColorInputs, function (input) { input.addEventListener('input', function () { setInk(input.value); }); });
  [].forEach.call(el.inkHexInputs, function (input) { input.addEventListener('change', function () { setInk(input.value); applyColorInputs(); }); });
  [].forEach.call(el.bgColorInputs, function (input) { input.addEventListener('input', function () { setBg(input.value); }); });
  [].forEach.call(el.bgHexInputs, function (input) { input.addEventListener('change', function () { setBg(input.value); applyColorInputs(); }); });

  el.bgSquare.addEventListener('click', function () {
    el.colorEditor.hidden = !el.colorEditor.hidden;
    if (!el.colorEditor.hidden && el.bgColorInputs.length) el.bgColorInputs[0].focus();
  });
  el.colorEditorBtn.addEventListener('click', function () { el.colorEditor.hidden = !el.colorEditor.hidden; });

  el.pipetteBtn.addEventListener('click', function () {
    if (tool.current !== 'pipette') previousTool = tool.current;
    tool.current = 'pipette';
    renderTools();
    refreshCursor();
  });

  el.smoothBtn.addEventListener('click', function () {
    tool.smooth = !tool.smooth;
    profile.smoothing = tool.smooth;
    K.setProfile(profile);
    renderTools();
    refreshCursor();
  });

  el.undo.addEventListener('click', function () {
    if (!state || !isDrawer()) return;
    for (var i = state.strokes.length - 1; i >= 0; i--) {
      if (state.strokes[i].owner === myId) { state.strokes.splice(i, 1); break; }
    }
    publishState();
    redrawBase();
  });

  el.clear.addEventListener('click', function () {
    if (!state || !isDrawer()) return;
    state.strokes = [];
    localDraft = null;
    remoteDrafts = {};
    publishDraft(null);
    publishState();
    redrawBase();
    scheduleDrafts();
  });

  document.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      el.undo.click();
    }
  });

  /* Чат, реакции, баны, настройки */

  function checkAnswer(text) {
    var targets = phraseTargets();
    if (!targets.length) return { hit: false, newWords: [] };
    var tokens = phraseWords(text);
    var guessed = (state.guessedWords || []).slice();
    var newWords = [];
    targets.forEach(function (target) {
      if (tokens.indexOf(target.key) >= 0 && guessed.indexOf(target.key) < 0) {
        guessed.push(target.key);
        newWords.push(target);
      }
    });
    if (!newWords.length) return { hit: false, newWords: [] };
    state.guessedWords = guessed;
    var complete = targets.every(function (target) { return guessed.indexOf(target.key) >= 0; });
    return { hit: complete, newWords: newWords, targets: targets };
  }

  el.chatForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!state || isBannedMe() || isHitPaused()) return;
    var text = el.chatInput.value.trim();
    if (!text) return;
    var result = !isDrawer() ? checkAnswer(text) : { hit: false, newWords: [] };
    state.messages.push({
      id: K.uid(), ownerId: myId, name: profile.name, color: profile.color,
      text: text, hit: result.hit, round: state.round, at: Date.now()
    });
    state.messages = state.messages.slice(-50);
    el.chatInput.value = '';

    if (result.newWords.length && !result.hit) {
      result.newWords.slice(0, 3).forEach(function (target) {
        systemMessage('Слово «' + target.display + '» присутствует в загадке!');
      });
    }
    if (result.hit) {
      state.scores[profile.name] = (state.scores[profile.name] || 0) + 10;
      var single = result.targets.length === 1;
      var reason = profile.name + (single ? ' угадал! +10 очков.' : ' угадал все слова! +10 очков.');
      systemMessage(reason);
      state.pausedUntil = Date.now() + HIT_PAUSE_MS;
      state.hitInfo = {
        id: K.uid(),
        text: single ? '🎯 ' + profile.name + ' угадал! +10 очков' : '🎯 Все слова угаданы! +10 очков',
        reason: reason,
        at: Date.now()
      };
      showHitAnimation(state.hitInfo);
      scheduleHitResolution(state.hitInfo);
    }
    publishState();
    renderAll();
  });

  el.messages.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-react]');
    if (!btn || !isDrawer() || isBannedMe() || !state) return;
    var id = btn.dataset.msg;
    var value = btn.dataset.react === 'like' ? 'like' : 'dislike';
    state.reactions[id] = { value: reactionValue(id) === value ? '' : value };
    publishState();
    renderMessages();
  });

  el.players.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-ban]');
    if (!btn || !isCreator() || !state) return;
    var id = btn.dataset.ban;
    if (id === myId || isIdBanned(id)) return;
    var player = presentPlayers().filter(function (p) { return p.id === id; })[0];
    var record = {
      id: id,
      name: player ? player.name : 'Игрок',
      fingerprint: player ? player.fingerprint || '' : '',
      at: Date.now()
    };
    state.bans.push(id);
    state.banRecords = state.banRecords.filter(function (r) { return r.id !== id; });
    state.banRecords.push(record);
    state.queue = state.queue.filter(function (q) { return q !== id; });
    systemMessage(record.name + ' удалён создателем комнаты.');
    if (state.drawer === id) rotateDrawer('Художник удалён.');
    delete presence[id];
    delete remoteDrafts[id];
    publishState();
    renderAll();
  });

  el.banList.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-unban]');
    if (!btn || !isCreator() || !state) return;
    var id = btn.dataset.unban;
    state.bans = state.bans.filter(function (value) { return value !== id; });
    state.banRecords = state.banRecords.filter(function (record) { return record.id !== id; });
    systemMessage('Игрок разбанен создателем комнаты.');
    publishState();
    renderAll();
  });

  el.dictCheckList.addEventListener('change', function () {
    if (!isCreator() || !state) return;
    var ids = [].slice.call(el.dictCheckList.querySelectorAll('input:checked')).map(function (input) { return input.value; });
    if (!ids.length) {
      renderDictChecks();
      return;
    }
    state.dictionaryIds = ids;
    state.dictionaryPool = dictionariesByIds(ids).map(function (dict) {
      return { id: dict.id, name: dict.name, words: dict.words.slice(0, 500) };
    });
    if (meta) {
      meta.dictionaryIds = ids.slice();
      meta.dictionaryPool = state.dictionaryPool;
      K.publish(client, K.topic(room, 'meta'), meta, true);
    }
    publishState();
    renderTools();
  });

  el.roundMinInput.addEventListener('change', function () {
    if (!isCreator() || !state) return;
    var minutes = Number(el.roundMinInput.value);
    if (!isFinite(minutes)) minutes = 5;
    minutes = Math.max(0, Math.min(60, minutes));
    state.roundMs = Math.round(minutes * 60000);
    state.startedAt = Date.now();
    state.waitingForPlayers = false;
    state.expiredAt = 0;
    state.hintSent = false;
    handledStart = 0;
    el.roundMinInput.value = minutes;
    systemMessage(state.roundMs ? 'Время раунда: ' + minutes + ' мин.' : 'Время раунда: без ограничений.');
    publishState();
    renderAll();
  });

  el.disableHintsInput.addEventListener('change', function () {
    if (!isCreator() || !state) return;
    state.hintsDisabled = el.disableHintsInput.checked;
    if (state.hintsDisabled) state.hintSent = false;
    systemMessage(state.hintsDisabled ? 'Подсказки отключены.' : 'Подсказки включены.');
    publishState();
    renderAll();
  });

  function switchPanel(name) {
    activePanel = name;
    el.panelTabs.querySelectorAll('.panel-tab').forEach(function (button) {
      button.classList.toggle('active', button.dataset.tab === name);
    });
    document.querySelectorAll('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== name;
    });
  }

  el.panelTabs.addEventListener('click', function (event) {
    var button = event.target.closest('.panel-tab');
    if (button) switchPanel(button.dataset.tab);
  });
  el.openSettingsBtn.addEventListener('click', function () { switchPanel('settings'); });

  function selectInlineDict(id) {
    var found = null;
    K.getCustomDictionaries().forEach(function (dict) { if (dict.id === id) found = dict; });
    editingInlineDict = found ? found.id : null;
    el.settingsDictName.value = found ? found.name : '';
    el.settingsDictWords.value = found ? found.words.join('\n') : '';
    renderInlineDicts();
    renderDictChecks();
  }

  el.settingsDictList.addEventListener('click', function (event) {
    var item = event.target.closest('.dict-item');
    if (item) selectInlineDict(item.dataset.id);
  });

  el.settingsNameSave.addEventListener('click', function () {
    var name = el.settingsName.value.trim();
    if (!name) return;
    profile.name = name;
    profile.color = K.colorFor(name);
    K.setProfile(profile);
    publishPresence(true);
    el.settingsSaved.hidden = false;
    setTimeout(function () { el.settingsSaved.hidden = true; }, 1800);
    renderAll();
  });

  el.settingsDictSave.addEventListener('click', function () {
    var name = el.settingsDictName.value.trim();
    var words = K.wordsFromText(el.settingsDictWords.value);
    if (!name || !words.length) return;
    var list = K.getCustomDictionaries();
    var existing = null;
    list.forEach(function (dict) { if (dict.id === editingInlineDict) existing = dict; });
    if (existing) {
      existing.name = name;
      existing.words = words;
    } else {
      existing = { id: 'custom-' + K.uid(), name: name, words: words, createdAt: Date.now() };
      list.push(existing);
    }
    K.saveCustomDictionaries(list);
    selectInlineDict(existing.id);
  });

  el.settingsDictDelete.addEventListener('click', function () {
    if (!editingInlineDict) return;
    var list = K.getCustomDictionaries().filter(function (dict) { return dict.id !== editingInlineDict; });
    K.saveCustomDictionaries(list);
    selectInlineDict(null);
  });

  el.settingsDictNew.addEventListener('click', function () { selectInlineDict(null); });

  el.nameModal.addEventListener('close', function () {
    if (el.nameForm.returnValue === 'cancel') return;
    var name = el.nameInput.value.trim();
    if (!name) return;
    profile.name = name;
    profile.color = K.colorFor(name);
    K.setProfile(profile);
    publishPresence(true);
    renderAll();
  });

  setInterval(function () {
    if (client && client.connected) publishPresence(true);
    if (state) ensureDrawer();
    checkTimeout();
    issueHintIfNeeded();
    renderTimer();
  }, 5000);

  setInterval(function () {
    if (client && client.connected) renderTimer();
    if (state) {
      issueHintIfNeeded();
      renderWord();
    }
  }, 1000);

  el.nameInput.value = profile.named ? profile.name : '';
  if (!profile.named) el.nameModal.showModal();
  renderToolsOnce();
  applyMeta();
  renderAll();
  if (client.connected && !subscribedAt) {
    subscribedAt = Date.now();
    presenceReadyAt = subscribedAt + 5000;
    scheduleInitialState();
  }
})();
