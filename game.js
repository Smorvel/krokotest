/* Онлайн-комната Кроко: очередь, словари, кисти и синхронизация через MQTT. */
(function () {
  'use strict';

  var K = window.KROKO;
  if (!K || !window.mqtt) return;

  var params = new URLSearchParams(location.search);
  var room = params.get('room') || K.DEFAULT_ROOM;
  var profile = K.getProfile();
  var myId = profile.id;
  var sessionJoinedAt = Date.now();
  var ROUND_MS = 90 * 1000;
  var HIT_PAUSE_MS = 2400;

  var PRESET_COLORS = [
    '#111827', '#ffffff', '#ef4444', '#f97316', '#fbbf24', '#a3e635',
    '#34d399', '#22d3ee', '#38bdf8', '#6366f1', '#a78bfa', '#f472b6'
  ];

  var TOOLS = [
    { id: 'brush', name: 'Кисть', icon: '<path d="M4 18c2.2.6 4-.2 5-2 .8-1.5 1-3 2.5-4.5L16 7l3 3-5.5 5.5C12 16 10.5 16.2 9 17c-1.5 1-3.3 1.8-5 1Z"/>' },
    { id: 'pencil', name: 'Карандаш', icon: '<path d="m4 20 4.5-1 11-11-3.5-3.5-11 11L4 20Z"/><path d="m14.5 6.5 3.5 3.5"/>' },
    { id: 'marker', name: 'Маркер', icon: '<path d="M5 19h14"/><path d="m7 16 9-10 3 3-9 10H7v-3Z"/>' },
    { id: 'airbrush', name: 'Аэрограф', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>' },
    { id: 'line', name: 'Линия', icon: '<path d="M4 19 20 5"/><circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="5" r="1.5"/>' },
    { id: 'rect', name: 'Прямоугольник', icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>' },
    { id: 'ellipse', name: 'Круг', icon: '<ellipse cx="12" cy="12" rx="9" ry="6"/>' },
    { id: 'fill', name: 'Заливка', icon: '<path d="m12 3 8 8-8 8-8-8 8-8Z"/><path d="M20 11c-2 2-3 3-3 4a2 2 0 0 0 4 0c0-1-1-2-1-4Z"/>' },
    { id: 'eraser', name: 'Ластик', icon: '<path d="m4 16 7-7 7 7-4 4H8l-4-4Z"/><path d="m8 12 5 5"/>' },
    { id: 'pipette', name: 'Пипетка', icon: '<path d="m14 4 6 6-3 1-6 6-3-3 6-6-1-4Z"/><path d="m7 16-3 4"/>' }
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
  var hintShown = false;
  var banned = false;
  var client = null;
  var activePanel = 'chat';
  var editingInlineDict = null;
  var handledHitId = null;
  var hitTimer = null;
  var wasHitPaused = false;

  var tool = {
    current: 'brush',
    size: Number(profile.brushSize) || 18,
    alpha: Number(profile.brushAlpha) || 100,
    color: profile.inkColor || '#111827',
    bg: profile.bgColor || '#ffffff'
  };

  var canvas = document.getElementById('drawCanvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  var layerCtx = layer.getContext('2d', { willReadFrequently: true });

  var el = {
    roomTitle: document.getElementById('roomTitle'),
    roomBadge: document.getElementById('roomBadge'),
    online: document.getElementById('onlineCount'),
    connection: document.getElementById('connectionText'),
    dictName: document.getElementById('dictName'),
    toolRail: document.getElementById('toolRail'),
    toolGrid: document.getElementById('toolGrid'),
    size: document.getElementById('sizeInput'),
    sizeText: document.getElementById('sizeText'),
    alpha: document.getElementById('alphaInput'),
    alphaText: document.getElementById('alphaText'),
    inkColor: document.getElementById('inkColor'),
    hexColor: document.getElementById('hexColor'),
    bgColor: document.getElementById('bgColor'),
    hexBg: document.getElementById('hexBg'),
    presets: document.getElementById('presetColors'),
    recent: document.getElementById('recentColors'),
    undo: document.getElementById('undoBtn'),
    clear: document.getElementById('clearBtn'),
    word: document.getElementById('wordText'),
    hint: document.getElementById('hintBtn'),
    drawer: document.getElementById('drawerName'),
    round: document.getElementById('roundText'),
    timer: document.getElementById('timerText'),
    wrap: document.getElementById('canvasWrap'),
    cursor: document.getElementById('brushCursor'),
    hitToast: document.getElementById('hitToast'),
    status: document.getElementById('statusText'),
    sync: document.getElementById('syncText'),
    panelTabs: document.getElementById('panelTabs'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    players: document.getElementById('playersList'),
    playersCount: document.getElementById('playersCount'),
    messages: document.getElementById('messages'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    settingsRoomName: document.getElementById('settingsRoomName'),
    dictSelect: document.getElementById('dictSelect'),
    roundMsSelect: document.getElementById('roundMsSelect'),
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

  function fallbackDictionary() {
    return K.BUILTIN_DICTIONARIES[0];
  }

  function getDictionary() {
    if (state && state.dictionary && Array.isArray(state.dictionary.words) && state.dictionary.words.length) return state.dictionary;
    if (meta && meta.dictionary && Array.isArray(meta.dictionary.words) && meta.dictionary.words.length) return meta.dictionary;
    return { id: fallbackDictionary().id, name: fallbackDictionary().name, words: fallbackDictionary().words };
  }

  function word() {
    var words = getDictionary().words;
    var index = ((state && state.wordIndex) || 0) % words.length;
    return words[index];
  }

  function isCreator() {
    return !!(meta && meta.creatorId && meta.creatorId === myId);
  }

  function isBannedMe() {
    return K.isBanned(state, myId);
  }

  function isHitPaused() {
    return !!(state && state.pausedUntil && Date.now() < state.pausedUntil);
  }

  function normalizeState(data) {
    var s = data || {};
    var dictionary = s.dictionary && Array.isArray(s.dictionary.words) && s.dictionary.words.length
      ? s.dictionary
      : getDictionary();
    s.v = 2;
    s.round = Number(s.round) || 1;
    s.wordIndex = Number(s.wordIndex) || 0;
    s.startedAt = Number(s.startedAt) || Date.now();
    s.strokes = Array.isArray(s.strokes) ? s.strokes.slice(-80) : [];
    s.messages = Array.isArray(s.messages) ? s.messages.slice(-50) : [];
    s.scores = s.scores && typeof s.scores === 'object' ? s.scores : {};
    s.queue = Array.isArray(s.queue) ? s.queue.filter(function (id) { return typeof id === 'string'; }) : [];
    s.bans = Array.isArray(s.bans) ? s.bans.filter(function (id) { return typeof id === 'string'; }) : [];
    s.dictionary = { id: dictionary.id, name: dictionary.name, words: dictionary.words.slice(0, 500) };
    s.bg = typeof s.bg === 'string' ? s.bg : '#ffffff';
    s.drawer = typeof s.drawer === 'string' ? s.drawer : '';
    s.roundMs = Number(s.roundMs) === 60000 || Number(s.roundMs) === 120000 || Number(s.roundMs) === 180000
      ? Number(s.roundMs)
      : ROUND_MS;
    s.pausedUntil = Number(s.pausedUntil) || 0;
    s.hitInfo = s.hitInfo && typeof s.hitInfo === 'object' ? s.hitInfo : null;
    s.updatedAt = Number(s.updatedAt) || 0;
    s.updatedBy = s.updatedBy || '';
    return s;
  }

  function presentPlayers() {
    var now = Date.now();
    var list = Object.keys(presence).map(function (id) { return presence[id]; }).filter(function (p) {
      return p && p.online !== false && now - (Number(p.ts) || 0) < 60000 && !K.isBanned(state, p.id);
    });
    if (!isBannedMe() && !list.some(function (p) { return p.id === myId; })) {
      list.push({
        id: myId, name: profile.name, color: profile.color,
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
        points: stroke.points.slice(-160), bg: stroke.bg
      } : null,
      at: Date.now()
    }, true);
  }

  function systemMessage(text) {
    if (!state) return;
    state.messages.push({ id: K.uid(), name: 'система', text: text, system: true, at: Date.now() });
    state.messages = state.messages.slice(-50);
  }

  function rotateDrawer(reason) {
    if (!state) return;
    var players = presentPlayers();
    var ids = state.queue.filter(function (id) {
      return players.some(function (p) { return p.id === id; }) && !K.isBanned(state, id);
    });
    var index = ids.indexOf(state.drawer);
    if (index >= 0) {
      ids.splice(index, 1);
      ids.push(state.drawer);
    }
    state.queue = ids;
    state.drawer = ids[0] || myId;
    state.wordIndex = (state.wordIndex + 1) % Math.max(1, getDictionary().words.length);
    state.round += 1;
    state.startedAt = Date.now();
    state.strokes = [];
    state.bg = state.drawer === myId ? tool.bg : '#ffffff';
    state.pausedUntil = 0;
    state.hitInfo = null;
    handledHitId = null;
    handledStart = state.startedAt;
    hintShown = false;
    localDraft = null;
    remoteDrafts = {};
    publishDraft(null);
    var next = players.filter(function (p) { return p.id === state.drawer; })[0];
    systemMessage(reason + ' Следующий художник: ' + (next ? next.name : 'вы') + '.');
  }

  function checkTimeout() {
    if (!state) return;
    if (state.pausedUntil && Date.now() < state.pausedUntil) return;
    if (Date.now() - state.startedAt < (state.roundMs || ROUND_MS)) return;
    if (handledStart === state.startedAt) return;
    handledStart = state.startedAt;
    if (isDrawer() || isCreator()) {
      rotateDrawer('Время вышло!');
      publishState();
    }
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
      rotateDrawer(state.hitInfo.reason || 'Слово угадано!');
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
    remoteDrafts = {};
    localDraft = null;
    handledStart = state.startedAt;
    var next = players.filter(function (p) { return p.id === state.drawer; })[0];
    systemMessage('Художник вышел. Теперь рисует ' + (next ? next.name : profile.name) + '.');
    publishState();
  }

  /* Отрисовка */
  function pointFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
      p: event.pressure || 0.5
    };
  }

  function isShape(toolId) {
    return toolId === 'line' || toolId === 'rect' || toolId === 'ellipse';
  }

  function smoothPath(context, points) {
    context.beginPath();
    if (!points.length) return;
    if (points.length === 1) {
      context.moveTo(points[0].x, points[0].y);
      context.lineTo(points[0].x + 0.01, points[0].y + 0.01);
      return;
    }
    context.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length - 1; i++) {
      var midX = (points[i].x + points[i + 1].x) / 2;
      var midY = (points[i].y + points[i + 1].y) / 2;
      context.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    var last = points[points.length - 1];
    context.lineTo(last.x, last.y);
  }

  function paintStroke(context, stroke) {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return;
    var points = stroke.points;
    var size = Math.max(2, Number(stroke.size) || 18);
    var color = stroke.color || '#111827';
    var alpha = stroke.alpha == null ? 1 : Math.max(0.05, Math.min(1, Number(stroke.alpha)));
    var start = points[0];
    var end = points[points.length - 1];

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = alpha;

    if (stroke.tool === 'eraser') {
      context.globalCompositeOperation = 'destination-out';
      context.globalAlpha = 1;
      context.lineWidth = size * 1.5;
      smoothPath(context, points);
      context.stroke();
      context.restore();
      return;
    }

    switch (stroke.tool) {
      case 'pencil':
        context.globalAlpha = 0.92 * alpha;
        context.lineWidth = Math.max(1, size * 0.45);
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (var i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
        context.stroke();
        break;
      case 'marker':
        context.globalAlpha = 0.34 * alpha;
        context.lineWidth = size * 1.5;
        smoothPath(context, points);
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
        context.globalAlpha = 0.55 * alpha;
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (var j = 1; j < points.length; j++) context.lineTo(points[j].x, points[j].y);
        context.closePath();
        context.fill();
        context.globalAlpha = 0.95 * alpha;
        context.lineWidth = Math.max(2, size * 0.35);
        context.stroke();
        break;
      default:
        context.lineWidth = size;
        smoothPath(context, points);
        context.stroke();
    }
    context.restore();
  }

  function redraw() {
    layerCtx.clearRect(0, 0, layer.width, layer.height);
    if (state) state.strokes.forEach(function (s) { paintStroke(layerCtx, s); });
    Object.keys(remoteDrafts).forEach(function (id) {
      if (id !== myId && remoteDrafts[id]) paintStroke(layerCtx, remoteDrafts[id]);
    });
    if (localDraft) paintStroke(layerCtx, localDraft);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = (state && state.bg) || tool.bg || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  function cursorFactor() {
    if (tool.current === 'eraser' || tool.current === 'marker' || tool.current === 'airbrush') return 1.5;
    if (tool.current === 'pencil') return 0.45;
    return 1;
  }

  function updateCursor(event) {
    if (isBannedMe() || !isDrawer()) { el.cursor.hidden = true; return; }
    var rect = el.wrap.getBoundingClientRect();
    var scale = rect.width / canvas.width;
    var diameter = Math.max(4, Math.round(tool.size * cursorFactor() * scale));
    el.cursor.style.width = diameter + 'px';
    el.cursor.style.height = diameter + 'px';
    el.cursor.style.left = (event.clientX - rect.left) + 'px';
    el.cursor.style.top = (event.clientY - rect.top) + 'px';
    el.cursor.style.borderColor = tool.current === 'eraser' ? '#fb7185' : '#111827';
    el.cursor.hidden = false;
  }

  /* Интерфейс */
  function renderPlayers() {
    var players = presentPlayers();
    el.online.textContent = players.length;
    el.playersCount.textContent = players.length;
    el.players.innerHTML = players.map(function (player) {
      var initial = K.escapeHtml(player.name.trim().charAt(0).toUpperCase() || '?');
      var tag = state && state.drawer === player.id ? 'рисует' : (player.id === myId ? 'вы' : '');
      var ban = isCreator() && player.id !== myId
        ? '<button class="ban-btn" type="button" data-ban="' + K.escapeHtml(player.id) + '">бан</button>'
        : '';
      return '<li class="player"><span class="avatar" style="background:' + K.escapeHtml(player.color || K.colorFor(player.name)) + '">' + initial + '</span>' +
        '<span class="player-name">' + K.escapeHtml(player.name) + '</span>' +
        (tag ? '<span class="player-tag">' + tag + '</span>' : '') + ban + '</li>';
    }).join('');
  }

  function renderScores() {
    // Очки отображаются в чате системными сообщениями, отдельный блок больше не нужен.
  }

  function renderMessages() {
    if (!state) return;
    var bannedIds = state.bans || [];
    el.messages.innerHTML = state.messages.filter(function (m) {
      return !(m.ownerId && bannedIds.indexOf(m.ownerId) >= 0);
    }).map(function (message) {
      var cls = 'message' + (message.system ? ' system' : '') + (message.hit ? ' hit' : '');
      return '<div class="' + cls + '">' + (message.system
        ? K.escapeHtml(message.text)
        : '<b>' + K.escapeHtml(message.name) + ':</b> ' + K.escapeHtml(message.text)) + '</div>';
    }).join('');
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function renderWord() {
    if (!state) return;
    var players = presentPlayers();
    var drawer = players.filter(function (p) { return p.id === state.drawer; })[0];
    el.drawer.textContent = drawer ? drawer.name : '—';
    el.round.textContent = state.round;

    if (isDrawer()) {
      el.word.textContent = word();
      el.hint.hidden = true;
    } else {
      el.word.textContent = hintShown
        ? word().charAt(0) + K.maskWord(word()).slice(1)
        : K.maskWord(word());
      el.hint.hidden = isBannedMe();
    }
    el.dictName.textContent = getDictionary().name;
  }

  function swatchButton(color) {
    var active = tool.color.toLowerCase() === color.toLowerCase() ? ' active' : '';
    return '<button class="swatch' + active + '" type="button" data-color="' + K.escapeHtml(color) + '" style="background:' + K.escapeHtml(color) + '" title="' + K.escapeHtml(color) + '"></button>';
  }

  function renderPalettes() {
    el.presets.innerHTML = PRESET_COLORS.map(swatchButton).join('');
    var recent = (profile.recentColors || []).slice(0, 6);
    while (recent.length < 6) recent.push('');
    el.recent.innerHTML = recent.map(function (color) {
      return color ? swatchButton(color) : '<span class="empty-swatch"></span>';
    }).join('');
  }

  function renderTools() {
    var canDraw = isDrawer() && !isBannedMe();
    el.toolRail.classList.toggle('disabled', !canDraw);
    el.toolRail.querySelectorAll('button, input').forEach(function (control) {
      control.disabled = !canDraw;
    });
    canvas.style.pointerEvents = canDraw ? 'auto' : 'none';

    el.toolGrid.querySelectorAll('.tool-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tool === tool.current);
    });
    el.size.value = tool.size;
    el.sizeText.textContent = tool.size;
    el.alpha.value = tool.alpha;
    el.alphaText.textContent = tool.alpha + '%';
    el.inkColor.value = tool.color;
    el.hexColor.value = tool.color;
    el.bgColor.value = tool.bg;
    el.hexBg.value = tool.bg;
    renderPalettes();

    if (isBannedMe()) el.status.textContent = 'Вы заблокированы в этой комнате';
    else if (canDraw) el.status.textContent = 'Вы рисуете слово. Остальные угадывают!';
    else el.status.textContent = 'Вы угадываете. Рисунок виден без затемнения!';
    el.sync.textContent = client && client.connected ? 'онлайн-синхронизация' : 'переподключение...';
    el.chatInput.disabled = isBannedMe() || isHitPaused();
    el.chatInput.placeholder = isHitPaused() ? 'Пауза — смотрите анимацию...' : 'Напиши слово...';
    el.hint.disabled = isBannedMe();

    el.roomBadge.hidden = !isCreator();
    el.settingsRoomName.textContent = (meta && meta.name) || room;
    el.dictSelect.disabled = !isCreator();
    el.roundMsSelect.disabled = !isCreator();
    el.settingsNote.textContent = isCreator()
      ? 'Вы создатель комнаты: можно менять словарь и время раунда.'
      : 'Сменять словарь и время может только создатель комнаты.';
    if (document.activeElement !== el.dictSelect) el.dictSelect.value = getDictionary().id;
    if (document.activeElement !== el.roundMsSelect) el.roundMsSelect.value = String((state && state.roundMs) || ROUND_MS);
    if (document.activeElement !== el.settingsName) el.settingsName.value = profile.name;
    renderInlineDicts();
  }

  function fillDictionarySelect() {
    var current = getDictionary().id;
    el.dictSelect.innerHTML = K.getDictionaries().map(function (d) {
      return '<option value="' + K.escapeHtml(d.id) + '"' + (d.id === current ? ' selected' : '') + '>' + K.escapeHtml(d.name) + ' (' + d.words.length + ')</option>';
    }).join('');
  }

  function renderTimer() {
    if (!state) return;
    var pausedNow = isHitPaused();
    if (wasHitPaused && !pausedNow) renderTools();
    wasHitPaused = pausedNow;
    var duration = state.roundMs || ROUND_MS;
    var left = Math.max(0, Math.ceil((duration - (Date.now() - state.startedAt)) / 1000));
    if (pausedNow) {
      el.timer.textContent = 'пауза';
      return;
    }
    el.timer.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  }

  function renderAll() {
    banned = isBannedMe();
    renderPlayers();
    renderMessages();
    renderWord();
    renderTools();
    renderTimer();
    redraw();
  }

  function applyMeta() {
    if (!meta) return;
    el.roomTitle.textContent = meta.name || room;
    fillDictionarySelect();
    renderTools();
  }

  function ensureMeta() {
    if (meta) return;
    var local = null;
    K.getRooms().forEach(function (r) { if (r.slug === room) local = r; });
    var dict = local && local.dictionary ? local.dictionary : {
      id: fallbackDictionary().id, name: fallbackDictionary().name, words: fallbackDictionary().words
    };
    meta = {
      slug: room,
      name: local ? local.name : (room === K.DEFAULT_ROOM ? 'Простые' : room),
      creatorId: local ? local.creatorId : (room === K.DEFAULT_ROOM ? '' : profile.id),
      creatorName: local ? local.creatorName : profile.name,
      dictionary: dict,
      createdAt: local ? local.createdAt : Date.now()
    };
    if (client.connected) K.publish(client, K.topic(room, 'meta'), meta, true);
    applyMeta();
  }

  /* MQTT */
  var willMessage = {
    topic: K.topic(room, 'presence/' + myId),
    payload: JSON.stringify({ id: myId, name: profile.name, online: false, ts: Date.now() }),
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
      if (data.v !== 2) return;
      stateSeen = true;
      if (state && Number(data.updatedAt) < Number(state.updatedAt || 0)) return;
      var previousRound = state ? state.round + ':' + state.wordIndex : null;
      state = normalizeState(data);
      banned = isBannedMe();

      if (!banned && state.queue.indexOf(myId) < 0) {
        state.queue.push(myId);
        publishState();
      }
      if (previousRound && previousRound !== state.round + ':' + state.wordIndex) {
        remoteDrafts = {};
        localDraft = null;
        hintShown = false;
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
      if (K.isBanned(state, data.id)) return;
      if (data.online === false) delete presence[data.id];
      else presence[data.id] = Object.assign({}, data, { ts: Number(data.ts) || 0 });
      renderPlayers();
      renderWord();
      renderTools();
      if (state) ensureDrawer();
      return;
    }

    if (topic.indexOf(K.topic(room, 'draft/')) === 0) {
      if (!data.id || data.id === myId || K.isBanned(state, data.id)) return;
      remoteDrafts[data.id] = data.stroke || null;
      redraw();
    }
  });

  function createInitialState() {
    ensureMeta();
    var players = presentPlayers();
    var ids = players.map(function (p) { return p.id; });
    var drawer = ids[0] || myId;
    var dict = getDictionary();

    state = normalizeState({
      round: 1,
      wordIndex: K.hash(drawer) % Math.max(1, dict.words.length),
      drawer: drawer,
      queue: ids,
      bans: [],
      dictionary: dict,
      startedAt: Date.now(),
      strokes: [],
      messages: [],
      scores: {},
      bg: drawer === myId ? tool.bg : '#ffffff',
      roundMs: ROUND_MS
    });
    systemMessage('Комната «' + (meta ? meta.name : 'Простые') + '» готова. Удачи!');
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

  /* Холст */
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
      tool.color = '#' + [pixel[0], pixel[1], pixel[2]].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
      profile.inkColor = tool.color;
      rememberColor(tool.color);
      return;
    }

    drawing = true;
    try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* синтетические события */ }
    localDraft = {
      id: K.uid(),
      owner: myId,
      tool: tool.current,
      color: tool.color,
      size: tool.size,
      alpha: tool.alpha / 100,
      bg: tool.bg,
      points: [pointFromEvent(event)]
    };
    redraw();
  });

  canvas.addEventListener('pointermove', function (event) {
    updateCursor(event);
    if (!drawing || !localDraft) return;
    event.preventDefault();
    var next = pointFromEvent(event);
    if (isShape(tool.current)) {
      localDraft.points = [localDraft.points[0], next];
    } else {
      var last = localDraft.points[localDraft.points.length - 1];
      if (Math.hypot(next.x - last.x, next.y - last.y) < 1) return;
      if (localDraft.points.length < 220) localDraft.points.push(next);
    }
    redraw();
    if (Date.now() - lastDraftPublish > 130) {
      lastDraftPublish = Date.now();
      publishDraft(localDraft);
    }
  });

  function endStroke(event) {
    if (!drawing) return;
    drawing = false;
    if (localDraft) {
      if (event && event.type === 'pointerup' && !isShape(tool.current)) {
        var end = pointFromEvent(event);
        localDraft.points.push(end);
      }
      state.strokes.push(localDraft);
      state.strokes = state.strokes.slice(-80);
      localDraft = null;
      publishDraft(null);
      publishState();
    }
    redraw();
    if (event) updateCursor(event);
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', function () { if (!drawing) el.cursor.hidden = true; });
  canvas.addEventListener('wheel', function (event) {
    if (!isDrawer() || isBannedMe()) return;
    event.preventDefault();
    var delta = event.deltaY < 0 ? 2 : -2;
    tool.size = Math.max(2, Math.min(64, tool.size + delta));
    profile.brushSize = tool.size;
    K.setProfile(profile);
    el.size.value = tool.size;
    el.sizeText.textContent = tool.size;
    updateCursor(event);
  }, { passive: false });

  /* Панель инструментов */
  el.toolGrid.innerHTML = TOOLS.map(function (t) {
    return '<button class="tool-btn' + (t.id === tool.current ? ' active' : '') + '" type="button" data-tool="' + t.id + '" title="' + t.name + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + t.icon + '</svg></button>';
  }).join('');

  el.toolGrid.addEventListener('click', function (event) {
    var btn = event.target.closest('.tool-btn');
    if (!btn || btn.disabled) return;
    tool.current = btn.dataset.tool;
    renderTools();
  });

  function rememberColor(color) {
    var colors = profile.recentColors || [];
    colors = [color].concat(colors.filter(function (c) { return c !== color; })).slice(0, 6);
    profile.recentColors = colors;
    K.setProfile(profile);
    renderTools();
  }

  function setInk(color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    tool.color = color.toLowerCase();
    profile.inkColor = tool.color;
    rememberColor(tool.color);
  }

  function setBg(color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    tool.bg = color.toLowerCase();
    profile.bgColor = tool.bg;
    K.setProfile(profile);
    if (state && isDrawer()) { state.bg = tool.bg; publishState(); }
    renderTools();
    redraw();
  }

  el.size.addEventListener('input', function () {
    tool.size = Number(el.size.value);
    profile.brushSize = tool.size;
    K.setProfile(profile);
    el.sizeText.textContent = tool.size;
  });

  el.alpha.addEventListener('input', function () {
    tool.alpha = Number(el.alpha.value);
    profile.brushAlpha = tool.alpha;
    K.setProfile(profile);
    el.alphaText.textContent = tool.alpha + '%';
  });

  el.inkColor.addEventListener('input', function () { setInk(el.inkColor.value); });
  el.hexColor.addEventListener('change', function () { setInk(el.hexColor.value); renderTools(); });
  el.bgColor.addEventListener('input', function () { setBg(el.bgColor.value); });
  el.hexBg.addEventListener('change', function () { setBg(el.hexBg.value); renderTools(); });

  function handlePaletteClick(event) {
    var btn = event.target.closest('[data-color]');
    if (btn && !btn.disabled) setInk(btn.dataset.color);
  }
  el.presets.addEventListener('click', handlePaletteClick);
  el.recent.addEventListener('click', handlePaletteClick);

  el.undo.addEventListener('click', function () {
    if (!state || !isDrawer()) return;
    for (var i = state.strokes.length - 1; i >= 0; i--) {
      if (state.strokes[i].owner === myId) { state.strokes.splice(i, 1); break; }
    }
    publishState();
    redraw();
  });

  el.clear.addEventListener('click', function () {
    if (!state || !isDrawer()) return;
    state.strokes = [];
    localDraft = null;
    remoteDrafts = {};
    state.bg = tool.bg;
    publishDraft(null);
    publishState();
    redraw();
    renderTools();
  });

  document.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      el.undo.click();
    }
  });

  /* Чат, очередь и управление */
  el.chatForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!state || isBannedMe()) return;
    if (state.pausedUntil && Date.now() < state.pausedUntil) return;
    var text = el.chatInput.value.trim();
    if (!text) return;
    var hit = !isDrawer() && text.toLowerCase() === word().toLowerCase();
    state.messages.push({
      id: K.uid(), ownerId: myId, name: profile.name, color: profile.color,
      text: text, hit: hit, at: Date.now()
    });
    state.messages = state.messages.slice(-50);
    el.chatInput.value = '';
    if (hit) {
      state.scores[profile.name] = (state.scores[profile.name] || 0) + 10;
      var reason = profile.name + ' угадал! +10 очков.';
      systemMessage(reason);
      state.pausedUntil = Date.now() + HIT_PAUSE_MS;
      state.hitInfo = {
        id: K.uid(),
        text: '🎯 ' + profile.name + ' угадал! +10 очков',
        reason: reason,
        at: Date.now()
      };
      handledHitId = state.hitInfo.id;
      showHitAnimation(state.hitInfo);
    }
    publishState();
    renderAll();
  });

  el.hint.addEventListener('click', function () {
    if (isDrawer() || isBannedMe()) return;
    hintShown = !hintShown;
    renderWord();
  });

  el.players.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-ban]');
    if (!btn || !isCreator() || !state) return;
    var id = btn.dataset.ban;
    if (id === myId || state.bans.indexOf(id) >= 0) return;
    var player = presentPlayers().filter(function (p) { return p.id === id; })[0];
    state.bans.push(id);
    state.queue = state.queue.filter(function (q) { return q !== id; });
    systemMessage((player ? player.name : 'Игрок') + ' удалён создателем комнаты.');
    if (state.drawer === id) rotateDrawer('Художник удалён.');
    delete presence[id];
    delete remoteDrafts[id];
    publishState();
    renderAll();
  });

  el.dictSelect.addEventListener('change', function () {
    if (!isCreator() || !state) return;
    var dict = K.findDictionary(el.dictSelect.value);
    state.dictionary = { id: dict.id, name: dict.name, words: dict.words.slice(0, 500) };
    state.wordIndex = K.hash(myId) % Math.max(1, dict.words.length);
    state.startedAt = Date.now();
    state.strokes = [];
    state.bg = state.drawer === myId ? tool.bg : '#ffffff';
    localDraft = null;
    remoteDrafts = {};
    publishDraft(null);
    systemMessage('Создатель включил словарь «' + dict.name + '».');
    publishState();
    renderAll();
  });

  el.roundMsSelect.addEventListener('change', function () {
    if (!isCreator() || !state) return;
    var ms = Number(el.roundMsSelect.value) || ROUND_MS;
    state.roundMs = ms;
    state.startedAt = Date.now();
    handledStart = state.startedAt;
    systemMessage('Создатель установил время раунда: ' + el.roundMsSelect.selectedOptions[0].textContent + '.');
    publishState();
    renderAll();
  });

  function switchPanel(name) {
    activePanel = name;
    el.panelTabs.querySelectorAll('.panel-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === name);
    });
    document.querySelectorAll('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== name;
    });
  }

  el.panelTabs.addEventListener('click', function (event) {
    var btn = event.target.closest('.panel-tab');
    if (btn) switchPanel(btn.dataset.tab);
  });
  el.openSettingsBtn.addEventListener('click', function () { switchPanel('settings'); });

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

  function selectInlineDict(id) {
    var found = null;
    K.getCustomDictionaries().forEach(function (dict) { if (dict.id === id) found = dict; });
    editingInlineDict = found ? found.id : null;
    el.settingsDictName.value = found ? found.name : '';
    el.settingsDictWords.value = found ? found.words.join('\n') : '';
    renderInlineDicts();
    fillDictionarySelect();
    renderTools();
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
    renderTimer();
  }, 5000);
  setInterval(function () {
    if (client && client.connected) renderTimer();
  }, 1000);

  el.nameInput.value = profile.named ? profile.name : '';
  if (!profile.named) el.nameModal.showModal();
  applyMeta();
  renderAll();
  if (client.connected && !subscribedAt) {
    subscribedAt = Date.now();
    presenceReadyAt = subscribedAt + 5000;
    scheduleInitialState();
  }
})();
