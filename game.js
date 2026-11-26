/* Онлайн-игра: общее состояние через MQTT, один художник на раунд. */
(function () {
  'use strict';

  if (!window.KROKO || !window.mqtt) return;

  var K = window.KROKO;
  var ROUND_MS = 90 * 1000;
  var profile = K.getProfile();
  var myId = profile.id;

  var BRUSHES = [
    { id: 'standard', icon: '🖌️', label: 'Обычная' },
    { id: 'blur', icon: '💨', label: 'Размытие' },
    { id: 'sketch', icon: '✏️', label: 'Карандаш' },
    { id: 'tabletStandard', icon: '🖊️', label: 'Таблет' },
    { divider: true },
    { id: 'line', icon: '📏', label: 'Линия' },
    { id: 'ellipse', icon: '⭕', label: 'Эллипс' },
    { id: 'rays', icon: '✴️', label: 'Лучи' },
    { id: 'lassoFill', icon: '🪄', label: 'Заливка' },
    { id: 'pixelArt', icon: '🧩', label: 'Пиксель' }
  ];

  var COLORS = [
    '#111827', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e',
    '#14b8a6', '#38bdf8', '#6366f1', '#a855f7', '#ec4899', '#64748b',
    '#7c2d12', '#0f766e', '#92400e', '#1d4ed8', '#be123c', '#084981'
  ];
  var BG_COLORS = ['#ffffff', '#fefce8', '#f0fdf4', '#f0f9ff', '#1e293b', '#000000', '#fdf2f8', '#fff7ed', '#f5f3ff', '#ecfeff', '#f8fafc', '#fef2f2'];

  var state = null;
  var presence = {};
  var remoteDrafts = {};
  var localDraft = null;
  var drawing = false;
  var lastDraftPublish = 0;
  var handledStart = null;
  var hintShown = false;
  var tool = {
    brush: 'standard', size: 18, color: '#111827', bg: '#ffffff',
    erasing: false, picking: false
  };

  var canvas = document.getElementById('drawCanvas');
  var frame = document.getElementById('canvasFrame');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  var layerCtx = layer.getContext('2d');

  var el = {
    online: document.getElementById('onlineCount'),
    connection: document.getElementById('connectionText'),
    word: document.getElementById('wordText'),
    hint: document.getElementById('hintButton'),
    round: document.getElementById('roundText'),
    timer: document.getElementById('timerText'),
    players: document.getElementById('playersList'),
    playersCount: document.getElementById('playersCount'),
    scores: document.getElementById('scoresList'),
    note: document.getElementById('canvasNote'),
    noteTitle: document.getElementById('noteTitle'),
    status: document.getElementById('statusText'),
    sync: document.getElementById('syncText'),
    cursor: document.getElementById('brushCursor'),
    toolbar: document.getElementById('toolbar'),
    brushButton: document.getElementById('brushButton'),
    brushPopover: document.getElementById('brushPopover'),
    brushGrid: document.getElementById('brushGrid'),
    pipette: document.getElementById('pipetteButton'),
    undo: document.getElementById('undoButton'),
    eraser: document.getElementById('eraserButton'),
    clear: document.getElementById('clearButton'),
    size: document.getElementById('sizeInput'),
    sizeText: document.getElementById('sizeText'),
    colorSwatch: document.getElementById('colorSwatch'),
    colorPopover: document.getElementById('colorPopover'),
    colorGrid: document.getElementById('colorGrid'),
    bgSwatch: document.getElementById('bgSwatch'),
    bgPopover: document.getElementById('bgPopover'),
    bgGrid: document.getElementById('bgGrid'),
    messages: document.getElementById('messages'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    nameModal: document.getElementById('nameModal'),
    nameInput: document.getElementById('nameInput'),
    nameForm: document.getElementById('nameForm')
  };

  var client = null;

  function normalizeState(data) {
    var s = data || {};
    s.v = 1;
    s.round = Number(s.round) || 1;
    s.wordIndex = Number(s.wordIndex) || 0;
    s.startedAt = Number(s.startedAt) || Date.now();
    s.strokes = Array.isArray(s.strokes) ? s.strokes.slice(-60) : [];
    s.messages = Array.isArray(s.messages) ? s.messages.slice(-40) : [];
    s.scores = s.scores && typeof s.scores === 'object' ? s.scores : {};
    s.resolved = Array.isArray(s.resolved) ? s.resolved.slice(-30) : [];
    s.bg = s.bg || '#ffffff';
    s.drawer = s.drawer || myId;
    s.updatedAt = Number(s.updatedAt) || 0;
    s.updatedBy = s.updatedBy || '';
    return s;
  }

  function word() {
    return K.WORDS[((state && state.wordIndex) || 0) % K.WORDS.length];
  }

  function presentPlayers() {
    var now = Date.now();
    var list = Object.keys(presence).map(function (id) { return presence[id]; }).filter(function (p) {
      return p.online && now - p.ts < 60000;
    });
    if (!list.some(function (p) { return p.id === myId; })) {
      list.unshift({ id: myId, name: profile.name, color: profile.color, joinedAt: profile.joinedAt || 0, ts: Date.now(), online: true });
    }
    return list.sort(function (a, b) { return (a.joinedAt || 0) - (b.joinedAt || 0); });
  }

  function isDrawer() {
    return !!state && state.drawer === myId;
  }

  function publishState() {
    if (!state || !client || !client.connected) return;
    state.updatedAt = Date.now();
    state.updatedBy = myId;
    K.publish(client, K.TOPIC_STATE, state, true);
  }

  function publishPresence(online) {
    if (!client || !client.connected) return;
    K.publish(client, K.TOPIC_PRESENCE + myId, {
      id: myId,
      name: profile.name,
      color: profile.color,
      joinedAt: profile.joinedAt || (profile.joinedAt = Date.now()),
      online: online !== false,
      ts: Date.now()
    }, true);
  }

  function publishDraft(stroke) {
    if (!client || !client.connected) return;
    K.publish(client, K.TOPIC_DRAFT + myId, {
      id: myId,
      owner: myId,
      stroke: stroke ? Object.assign({}, stroke, { points: stroke.points.slice(-100) }) : null,
      at: Date.now()
    }, true);
  }

  function systemMessage(text) {
    if (!state) return;
    state.messages.push({ id: K.uid(), name: 'система', text: text, system: true, at: Date.now() });
    state.messages = state.messages.slice(-40);
  }

  function rotateDrawer(reason, winner) {
    if (!state) return;
    var players = presentPlayers();
    var index = -1;
    for (var i = 0; i < players.length; i++) if (players[i].id === state.drawer) index = i;
    var next = players[(index + 1) % players.length] || players[0];
    if (!next) next = { id: myId, name: profile.name };

    state.drawer = next.id;
    state.wordIndex = (state.wordIndex + 1) % K.WORDS.length;
    state.round += 1;
    state.startedAt = Date.now();
    state.strokes = [];
    state.bg = '#ffffff';
    state.resolved = state.resolved.slice(-25);
    handledStart = state.startedAt;
    remoteDrafts = {};
    localDraft = null;
    publishDraft(null);
    systemMessage(reason + ' Следующий художник: ' + next.name + '.');
  }

  function checkTimeout() {
    if (!state || Date.now() - state.startedAt < ROUND_MS) return;
    if (handledStart === state.startedAt) return;
    handledStart = state.startedAt;
    var ids = presentPlayers().map(function (p) { return p.id; });
    if (isDrawer() || ids.indexOf(state.drawer) < 0) {
      rotateDrawer('Время вышло!');
      publishState();
    }
  }

  function ensureDrawer() {
    if (!state) return;
    var ids = presentPlayers().map(function (p) { return p.id; });
    if (ids.indexOf(state.drawer) >= 0) return;
    state.drawer = ids[0] || myId;
    state.startedAt = Date.now();
    state.strokes = [];
    remoteDrafts = {};
    systemMessage('Художник вышел. Теперь рисует ' + (presentPlayers()[0] ? presentPlayers()[0].name : profile.name) + '.');
    publishState();
  }

  /* Отрисовка */
  function tracePoints(context, points) {
    if (!points || !points.length) return;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
    if (points.length === 1) context.lineTo(points[0].x + 0.01, points[0].y + 0.01);
    context.stroke();
  }

  function jitter(index, seed) {
    var value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return (value - Math.floor(value)) - 0.5;
  }

  function paintStroke(context, stroke) {
    if (!stroke || !stroke.points || !stroke.points.length) return;
    var points = stroke.points;
    var size = Math.max(2, Number(stroke.size) || 18);
    var color = stroke.color || '#111827';

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (stroke.tool === 'eraser') {
      context.globalCompositeOperation = 'destination-out';
      context.strokeStyle = 'rgba(0,0,0,1)';
      context.lineWidth = size * 1.7;
      tracePoints(context, points);
      context.restore();
      return;
    }

    context.strokeStyle = color;
    context.fillStyle = color;

    switch (stroke.tool) {
      case 'blur':
        context.globalAlpha = 0.42;
        context.lineWidth = Math.max(2, size * 0.75);
        context.shadowBlur = size;
        context.shadowColor = color;
        tracePoints(context, points);
        break;
      case 'sketch':
        context.globalAlpha = 0.55;
        context.lineWidth = Math.max(1.5, size * 0.45);
        for (var pass = 0; pass < 3; pass++) {
          context.save();
          context.translate(jitter(pass, points.length) * size * 0.5, jitter(pass + 4, points.length) * size * 0.5);
          tracePoints(context, points);
          context.restore();
        }
        break;
      case 'tabletStandard':
        if (points.length === 1) {
          context.beginPath();
          context.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
          context.fill();
        }
        for (var i = 1; i < points.length; i++) {
          context.lineWidth = Math.max(2, size * (0.45 + (points[i].p || 0.5) * 0.85));
          context.beginPath();
          context.moveTo(points[i - 1].x, points[i - 1].y);
          context.lineTo(points[i].x, points[i].y);
          context.stroke();
        }
        break;
      case 'line':
        context.lineWidth = size;
        if (points.length > 1) {
          context.beginPath();
          context.moveTo(points[0].x, points[0].y);
          context.lineTo(points[points.length - 1].x, points[points.length - 1].y);
          context.stroke();
        } else tracePoints(context, points);
        break;
      case 'ellipse': {
        var xs = points.map(function (p) { return p.x; });
        var ys = points.map(function (p) { return p.y; });
        var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
        var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
        context.lineWidth = size;
        context.beginPath();
        context.ellipse((minX + maxX) / 2, (minY + maxY) / 2, Math.max(2, (maxX - minX) / 2), Math.max(2, (maxY - minY) / 2), 0, 0, Math.PI * 2);
        context.stroke();
        break;
      }
      case 'rays': {
        var start = points[0], end = points[points.length - 1];
        var radius = Math.hypot(end.x - start.x, end.y - start.y) || size * 3;
        context.lineWidth = Math.max(2, size * 0.6);
        for (var ray = 0; ray < 12; ray++) {
          var angle = Math.PI * 2 * ray / 12;
          var length = radius * (ray % 2 ? 0.72 : 1);
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.lineTo(start.x + Math.cos(angle) * length, start.y + Math.sin(angle) * length);
          context.stroke();
        }
        break;
      }
      case 'lassoFill':
        context.globalAlpha = 0.28;
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (var j = 1; j < points.length; j++) context.lineTo(points[j].x, points[j].y);
        context.closePath();
        context.fill();
        context.globalAlpha = 0.9;
        context.lineWidth = Math.max(2, size * 0.4);
        context.stroke();
        break;
      case 'pixelArt': {
        var grid = Math.max(6, Math.round(size * 0.7));
        points.forEach(function (point) {
          context.fillRect(Math.floor(point.x / grid) * grid, Math.floor(point.y / grid) * grid, grid, grid);
        });
        break;
      }
      default:
        context.lineWidth = size;
        tracePoints(context, points);
    }
    context.restore();
  }

  function redraw() {
    layerCtx.clearRect(0, 0, layer.width, layer.height);
    if (state) state.strokes.forEach(function (stroke) { paintStroke(layerCtx, stroke); });
    Object.keys(remoteDrafts).forEach(function (id) {
      if (id !== myId && remoteDrafts[id]) paintStroke(layerCtx, remoteDrafts[id]);
    });
    if (localDraft) paintStroke(layerCtx, localDraft);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = (state && state.bg) || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  function pointFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
      p: event.pressure || 0.5
    };
  }

  function smoothPoint(next, previous) {
    if (!previous) return next;
    return { x: previous.x + (next.x - previous.x) * 0.35, y: previous.y + (next.y - previous.y) * 0.35, p: next.p };
  }

  function updateCursor(event) {
    if (!isDrawer() || drawing) { el.cursor.hidden = true; return; }
    var rect = frame.getBoundingClientRect();
    var diameter = Math.max(4, Math.round(1.8 * tool.size + 1));
    el.cursor.style.width = diameter + 'px';
    el.cursor.style.height = diameter + 'px';
    el.cursor.style.left = (event.clientX - rect.left) + 'px';
    el.cursor.style.top = (event.clientY - rect.top) + 'px';
    el.cursor.style.borderColor = tool.erasing ? 'rgba(251,113,133,.9)' : 'rgba(8,12,13,.8)';
    el.cursor.hidden = false;
  }

  /* Интерфейс */
  function renderPlayers() {
    var players = presentPlayers();
    el.online.textContent = players.length;
    el.playersCount.textContent = players.length;
    el.players.innerHTML = players.map(function (player) {
      var initial = K.escapeHtml(player.name.trim().charAt(0).toUpperCase() || '?');
      var role = state && state.drawer === player.id ? 'рисует' : '';
      return '<li class="player"><span class="avatar" style="background:' + K.escapeHtml(player.color || K.colorFor(player.name)) + '">' + initial + '</span>' +
        '<span class="player-name">' + K.escapeHtml(player.name) + '</span>' +
        (role ? '<span class="player-me">' + role + '</span>' : player.id === myId ? '<span class="player-me">вы</span>' : '') + '</li>';
    }).join('');
  }

  function renderScores() {
    if (!state) return;
    var rows = Object.keys(state.scores).map(function (name) { return { name: name, score: state.scores[name] }; })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, 5);
    el.scores.innerHTML = rows.length
      ? rows.map(function (row) { return '<div class="score-row"><span>' + K.escapeHtml(row.name) + '</span><b>' + row.score + '</b></div>'; }).join('')
      : '<div class="score-row muted">Пока нет очков</div>';
  }

  function renderMessages() {
    if (!state) return;
    el.messages.innerHTML = state.messages.map(function (message) {
      var cls = 'message' + (message.system ? ' system' : '') + (message.hit ? ' hit' : '');
      return '<div class="' + cls + '">' + (message.system
        ? K.escapeHtml(message.text)
        : '<b>' + K.escapeHtml(message.name) + ':</b> ' + K.escapeHtml(message.text)) + '</div>';
    }).join('');
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function renderWord() {
    if (!state) return;
    var drawerName = (presentPlayers().filter(function (p) { return p.id === state.drawer; })[0] || {}).name || 'игрок';
    if (isDrawer()) {
      el.word.textContent = word();
      el.hint.hidden = true;
    } else {
      el.word.textContent = hintShown ? word().charAt(0) + K.maskWord(word()).slice(1) : K.maskWord(word());
      el.hint.hidden = false;
    }
    el.round.textContent = state.round;
    el.noteTitle.textContent = 'Сейчас рисует ' + drawerName;
  }

  function renderTools() {
    var drawer = isDrawer();
    el.toolbar.hidden = !drawer;
    el.note.hidden = drawer;
    el.cursor.hidden = true;
    canvas.style.pointerEvents = drawer ? 'auto' : 'none';
    el.status.textContent = drawer ? 'Вы рисуете слово. Остальные угадывают!' : 'Вы угадываете. Пишите варианты в чат!';
    el.sync.textContent = client && client.connected ? 'онлайн-синхронизация' : 'переподключение...';

    el.eraser.classList.toggle('active', tool.erasing);
    el.pipette.classList.toggle('active', tool.picking);
    el.size.value = tool.size;
    el.sizeText.textContent = tool.size;
    el.colorSwatch.style.background = tool.color;
    el.bgSwatch.style.background = tool.bg;
    document.querySelectorAll('.brush-item').forEach(function (item) {
      item.classList.toggle('active', !tool.erasing && item.dataset.brush === tool.brush);
    });
    document.querySelectorAll('.color-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.color.toLowerCase() === tool.color.toLowerCase() || (item.classList.contains('bg-item') && item.dataset.color.toLowerCase() === tool.bg.toLowerCase()));
    });
  }

  function renderAll() {
    renderPlayers();
    renderScores();
    renderMessages();
    renderWord();
    renderTools();
    renderTimer();
    redraw();
  }

  function renderTimer() {
    if (!state) return;
    var left = Math.max(0, Math.ceil((ROUND_MS - (Date.now() - state.startedAt)) / 1000));
    el.timer.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  }

  function closePopovers() {
    el.brushPopover.hidden = true;
    el.colorPopover.hidden = true;
    el.bgPopover.hidden = true;
    el.brushButton.classList.remove('active');
  }

  /* MQTT */
  var willMessage = {
    topic: K.TOPIC_PRESENCE + myId,
    payload: JSON.stringify({ id: myId, name: profile.name, online: false, ts: Date.now() }),
    qos: 1,
    retain: true
  };

  client = K.connect('play-' + myId, willMessage);

  client.on('connect', function () {
    el.connection.textContent = 'онлайн';
    el.connection.classList.add('online');
    client.subscribe(K.TOPIC_STATE, { qos: 1 });
    client.subscribe(K.BASE + '/presence/+', { qos: 1 });
    client.subscribe(K.BASE + '/draft/+', { qos: 1 });
    publishPresence(true);
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

    if (topic === K.TOPIC_STATE) {
      if (data.v !== 1) return;
      if (state && Number(data.updatedAt) < Number(state.updatedAt || 0)) return;
      var previousRound = state ? state.round + ':' + state.wordIndex : null;
      state = normalizeState(data);
      if (previousRound && previousRound !== state.round + ':' + state.wordIndex) {
        remoteDrafts = {};
        localDraft = null;
        hintShown = false;
      }
      renderAll();
      checkTimeout();
      return;
    }

    if (topic.indexOf(K.TOPIC_PRESENCE) === 0) {
      if (!data.id) return;
      if (data.online === false) {
        if (data.id === myId) return;
        delete presence[data.id];
      } else {
        presence[data.id] = Object.assign({}, data, { ts: Date.now() });
      }
      renderPlayers();
      renderWord();
      ensureDrawer();
      return;
    }

    if (topic.indexOf(K.TOPIC_DRAFT) === 0) {
      if (!data.id || data.id === myId) return;
      remoteDrafts[data.id] = data.stroke || null;
      redraw();
    }
  });

  setTimeout(function () {
    if (!state && client.connected) {
      state = normalizeState({
        round: 1, wordIndex: K.hash(myId) % K.WORDS.length,
        drawer: myId, startedAt: Date.now(), strokes: [], messages: [], scores: {}, resolved: [], bg: '#ffffff'
      });
      systemMessage('Комната «Простые» готова. Удачи!');
      publishState();
      renderAll();
    }
  }, 1800);

  /* События холста */
  canvas.addEventListener('pointerdown', function (event) {
    if (!state || !isDrawer()) return;
    event.preventDefault();
    closePopovers();
    if (tool.picking) {
      var sample = pointFromEvent(event);
      var pixel = ctx.getImageData(Math.min(canvas.width - 1, Math.max(0, Math.floor(sample.x))), Math.min(canvas.height - 1, Math.max(0, Math.floor(sample.y))), 1, 1).data;
      tool.color = '#' + [pixel[0], pixel[1], pixel[2]].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
      tool.picking = false;
      renderTools();
      return;
    }
    drawing = true;
    try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* синтетические события */ }
    el.cursor.hidden = true;
    localDraft = {
      id: K.uid(), owner: myId,
      tool: tool.erasing ? 'eraser' : tool.brush,
      color: tool.color, size: tool.size,
      points: [pointFromEvent(event)]
    };
    redraw();
  });

  canvas.addEventListener('pointermove', function (event) {
    updateCursor(event);
    if (!drawing || !localDraft) return;
    event.preventDefault();
    var last = localDraft.points[localDraft.points.length - 1];
    var next = smoothPoint(pointFromEvent(event), last);
    if (Math.hypot(next.x - last.x, next.y - last.y) < 0.7) return;
    if (localDraft.points.length < 180) localDraft.points.push(next);
    redraw();
    if (Date.now() - lastDraftPublish > 110) {
      lastDraftPublish = Date.now();
      publishDraft(localDraft);
    }
  });

  function endStroke(event) {
    if (!drawing) return;
    drawing = false;
    if (localDraft && localDraft.points.length) {
      if (event && event.type === 'pointerup') localDraft.points.push(pointFromEvent(event));
      if (localDraft.points.length > 180) localDraft.points = localDraft.points.filter(function (_, i) { return i % 2 === 0 || i === localDraft.points.length - 1; });
      state.strokes.push(localDraft);
      state.strokes = state.strokes.slice(-60);
      publishDraft(null);
      localDraft = null;
      publishState();
    }
    redraw();
    if (event) updateCursor(event);
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', function () { el.cursor.hidden = true; });

  /* Панель инструментов */
  el.brushButton.addEventListener('click', function () {
    var open = el.brushPopover.hidden;
    closePopovers();
    el.brushPopover.hidden = !open;
    el.brushButton.classList.toggle('active', open);
  });

  el.brushGrid.innerHTML = BRUSHES.map(function (brush) {
    if (brush.divider) return '<div class="brush-divider"></div>';
    return '<button class="brush-item" type="button" data-brush="' + brush.id + '"><span>' + brush.icon + '</span>' + brush.label + '</button>';
  }).join('');

  el.brushGrid.addEventListener('click', function (event) {
    var item = event.target.closest('.brush-item');
    if (!item) return;
    tool.brush = item.dataset.brush;
    tool.erasing = false;
    tool.picking = false;
    renderTools();
    closePopovers();
  });

  el.pipette.addEventListener('click', function () {
    tool.picking = !tool.picking;
    if (tool.picking) tool.erasing = false;
    renderTools();
  });

  el.eraser.addEventListener('click', function () {
    tool.erasing = !tool.erasing;
    if (tool.erasing) tool.picking = false;
    renderTools();
  });

  el.undo.addEventListener('click', function () {
    if (!state) return;
    for (var i = state.strokes.length - 1; i >= 0; i--) {
      if (state.strokes[i].owner === myId) { state.strokes.splice(i, 1); break; }
    }
    publishState();
    redraw();
  });

  el.clear.addEventListener('click', function () {
    if (!state) return;
    state.strokes = [];
    localDraft = null;
    remoteDrafts = {};
    tool.bg = '#ffffff';
    publishDraft(null);
    publishState();
    redraw();
  });

  el.size.addEventListener('input', function () {
    tool.size = Number(el.size.value);
    el.sizeText.textContent = tool.size;
  });

  el.colorSwatch.addEventListener('click', function () {
    var open = el.colorPopover.hidden;
    closePopovers();
    el.colorPopover.hidden = !open;
  });
  el.colorGrid.innerHTML = COLORS.map(function (color) {
    return '<button class="color-item" type="button" data-color="' + color + '" style="background:' + color + '" aria-label="' + color + '"></button>';
  }).join('');
  el.colorGrid.addEventListener('click', function (event) {
    var item = event.target.closest('.color-item');
    if (!item) return;
    tool.color = item.dataset.color;
    tool.erasing = false;
    tool.picking = false;
    renderTools();
    closePopovers();
  });

  el.bgSwatch.addEventListener('click', function () {
    var open = el.bgPopover.hidden;
    closePopovers();
    el.bgPopover.hidden = !open;
  });
  el.bgGrid.innerHTML = BG_COLORS.map(function (color) {
    return '<button class="bg-item color-item" type="button" data-color="' + color + '" style="background:' + color + '" aria-label="фон ' + color + '"></button>';
  }).join('');
  el.bgGrid.addEventListener('click', function (event) {
    var item = event.target.closest('.bg-item');
    if (!item || !state) return;
    state.bg = item.dataset.color;
    tool.bg = item.dataset.color;
    publishState();
    redraw();
    closePopovers();
  });

  document.addEventListener('pointerdown', function (event) {
    if (!event.target.closest('.toolbar') && !event.target.closest('.popover')) closePopovers();
  });
  document.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      el.undo.click();
    }
    if (event.key === 'Escape') closePopovers();
  });

  /* Чат */
  el.chatForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!state) return;
    var text = el.chatInput.value.trim();
    if (!text) return;
    var hit = !isDrawer() && text.toLowerCase() === word().toLowerCase();
    state.messages.push({
      id: K.uid(), name: profile.name, color: profile.color,
      text: text, hit: hit, at: Date.now()
    });
    state.messages = state.messages.slice(-40);
    state.resolved.push(K.uid());
    state.resolved = state.resolved.slice(-30);
    el.chatInput.value = '';
    if (hit) {
      state.scores[profile.name] = (state.scores[profile.name] || 0) + 10;
      rotateDrawer(profile.name + ' угадал! +10 очков.');
      hintShown = false;
    }
    publishState();
    renderAll();
  });

  el.hint.addEventListener('click', function () {
    hintShown = !hintShown;
    renderWord();
  });

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
    checkTimeout();
    renderTimer();
  }, 5000);
  setInterval(function () {
    if (client && client.connected) renderTimer();
  }, 1000);

  /* Старт */
  el.nameInput.value = profile.named ? profile.name : '';
  if (!profile.named) el.nameModal.showModal();
  renderAll();
})();
