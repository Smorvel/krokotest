/* Общее состояние комнаты Кроко: данные, инструменты и ссылки на DOM. */
(function () {
  var G = window.KROKO_GAME = {};
  var K = window.KROKO;
  if (!K || !window.mqtt) return;

  G.K = K;
  G.ICONS = window.KROKO_GAME_ICONS || {};
  var ICONS = G.ICONS;
  G.params = new URLSearchParams(location.search);
  G.room = G.params.get('room') || K.DEFAULT_ROOM;
  G.profile = K.getProfile();
  G.noDraw = !!G.profile.noDraw;
  G.soundEnabled = G.profile.soundEnabled !== false;
  G.myId = G.profile.id;
  G.myFingerprint = G.profile.fingerprint || K.getFingerprint();
  G.sessionJoinedAt = Date.now();

  G.DEFAULT_ROUND_MS = 5 * 60 * 1000;
  G.MAX_ROUND_MS = 60 * 60 * 1000;
  G.HIT_PAUSE_MS = 2400;
  G.SYSTEM_NOTICE_MS = 5000;
  G.SYSTEM_NOTICE_EXIT_MS = 350;
  G.REVEAL_MS = 3600;
  G.TIMEOUT_REVEAL_MS = 3000;
  G.LEAVE_REVEAL_MS = 3000;
  G.SOLO_GRACE_MS = 900;
  G.PRESENCE_TS_TTL_MS = 30000;
  /* Обрыв соединения (например, обновление страницы) даёт ведущему 5 секунд
     на повторное подключение. Если за это время он не вернулся, раунд
     завершается у остальных игроков по завещанию MQTT. */
  G.DRAWER_OFFLINE_MS = 5000;
  G.HISTORY_LIMIT = 30;
  /* Drawing history is never discarded. Old strokes are rasterized instead. */
  G.STROKE_SOFT_LIMIT = 160;
  G.STROKE_KEEP_RECENT = 60;
  G.STROKE_BYTES_LIMIT = 260000;
  G.sessionKicked = false;
  G.leavingRoom = null;
  G.syncDone = false;

  G.PRESET_COLORS = [
    '#000000', '#ffffff', '#606060', '#d32f2f', '#f97316', '#fbbf24',
    '#37c206', '#ffe7b9', '#22d3ee', '#2154ee', '#8147e4', '#fa28b9', '#87461e'
  ];

  G.SHAPE_LABELS = { square: 'квадрат', circle: 'круг', stripe: 'полоса' };

  G.TOOLS = [
    { id: 'brush', name: 'Стандартная кисть', icon: ICONS.brush },
    { id: 'soft', name: 'Мягкая кисть', icon: ICONS.soft },
    { id: 'tablet', name: 'Кисть для планшета', icon: ICONS.tablet },
    { id: 'shape', name: 'Фигуры', icon: ICONS.shapeSquare },
    { id: 'fill', name: 'Заливка', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 8 8-8 8-8-8 8-8Z"/><path d="M20 11c-2 2-3 3-3 4a2 2 0 0 0 4 0c0-1-1-2-1-4Z"/></svg>' },
    { sep: true },
    { id: 'eraser', name: 'Ластик', icon: ICONS.eraser }
  ];

  G.state = null;
  G.meta = null;
  G.stateSeen = false;
  G.retainedTopics = {};
  G.orphanCheckTimer = null;
  G.ignoreRetainedMetaUntil = 0;
  G.subscribedAt = 0;
  G.presenceReadyAt = 0;
  G.initialStateTimer = null;
  G.presence = {};
  G.remoteDrafts = {};
  G.pendingStrokes = {};
  G.pendingCanvas = null;
  G.localDraft = null;
  G.drawing = false;
  G.lastDraftPublish = 0;
  G.handledStart = null;
  G.banned = false;
  G.client = null;
  G.activePanel = 'chat';
  G.editingInlineDict = null;
  G.handledHitId = null;
  G.handledRotation = null;
  G.lastRotationAt = 0;
  G.canvasSeen = false;
  G.canvasSnapshotTimer = null;
  /* Версия холста приходит только из canvas/<round>. Отдельные события
     штрихов — быстрый предпросмотр и не должны откатывать снимок назад. */
  G.canvasVersion = 0;
  G.canvasRound = 0;
  G.canvasOwner = '';
  G.futureStrokes = {};
  G.futureDeletions = {};
  G.deletedStrokes = {};
  G.drawerMissingSince = 0;
  G.drawerSeenAt = 0;
  G.drawerOfflineAt = 0;
  /* Переподключившийся клиент не забирает ход, пока не закончится сверка. */
  G.turnLockUntil = 0;
  G.DRAWER_MISSING_GRACE_MS = 45000;
  G.seenChatIds = {};
  G.hitTimer = null;
  G.handledRevealId = null;
  G.wasHitPaused = false;
  G.previousTool = 'brush';
  G.draftFrame = null;
  G.baseFrame = null;
  G.fillCache = {};
  G.fillCacheKeys = [];
  G.rasterImages = {};
  G.rasterBgCache = {};
  G.rasterBgCacheKeys = [];
  G.knobDrag = null;
  G.stampCache = {};
  G.smoothPoint = null;
  G.lastCursorEvent = null;

  G.tool = {
    current: 'brush',
    size: Number(G.profile.brushSize) || 18,
    alpha: Number(G.profile.brushAlpha) || 100,
    color: G.profile.inkColor || '#000000',
    bg: G.profile.bgColor || '#252932',
    smooth: G.profile.smoothing === true,
    shapeMode: G.SHAPE_LABELS[G.profile.shapeMode] ? G.profile.shapeMode : 'square'
  };

  G.canvas = document.getElementById('drawCanvas');
  G.draftCanvas = document.getElementById('draftCanvas');
  G.ctx = G.canvas.getContext('2d', { willReadFrequently: true });
  G.draftCtx = G.draftCanvas.getContext('2d');

  G.el = {
    roomTitle: document.getElementById('roomTitle'),
    roomBadge: document.getElementById('roomBadge'),
    online: document.getElementById('onlineCount'),
    connection: document.getElementById('connectionText'),
    toolRail: document.getElementById('toolRail'),
    toolGrid: document.getElementById('toolGrid'),
    sizeKnob: document.getElementById('sizeKnob'),
    sizeCaption: document.getElementById('sizeCaption'),
    alphaKnob: document.getElementById('alphaKnob'),
    alphaCaption: document.getElementById('alphaCaption'),
    pipetteBtn: document.getElementById('pipetteBtn'),
    smoothBtn: document.getElementById('smoothBtn'),
    undo: document.getElementById('undoBtn'),
    clear: document.getElementById('clearBtn'),
    save: document.getElementById('saveBtn'),
    wordSourceLabel: document.getElementById('wordSourceLabel'),
    word: document.getElementById('wordText'),
    drawer: document.getElementById('drawerName'),
    drawerAvatar: document.getElementById('drawerAvatar'),
    timer: document.getElementById('timerText'),
    wrap: document.getElementById('canvasWrap'),
    cursor: document.getElementById('brushCursor'),
    hitToast: document.getElementById('hitToast'),
    wordReveal: document.getElementById('wordReveal'),
    revealReason: document.getElementById('revealReason'),
    revealWord: document.getElementById('revealWord'),
    revealNote: document.getElementById('revealNote'),
    inkBlobs: document.getElementById('inkBlobs'),
    bgSquare: document.getElementById('bgSquare'),
    palettePopover: document.getElementById('palettePopover'),
    paletteTitle: document.getElementById('paletteTitle'),
    paletteCurrent: document.getElementById('paletteCurrent'),
    paletteHex: document.getElementById('paletteHex'),
    paletteSv: document.getElementById('paletteSv'),
    paletteSvHandle: document.getElementById('paletteSvHandle'),
    paletteHue: document.getElementById('paletteHue'),
    palettePopoverClose: document.getElementById('palettePopoverClose'),
    popoverSize: document.getElementById('popoverSize'),
    popoverSizeValue: document.getElementById('popoverSizeValue'),
    popoverAlpha: document.getElementById('popoverAlpha'),
    popoverAlphaValue: document.getElementById('popoverAlphaValue'),
    sizeToast: document.getElementById('sizeToast'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingOverlayText: document.getElementById('loadingOverlayText'),
    loadingOverlayHint: document.getElementById('loadingOverlayHint'),
    duplicateOverlay: document.getElementById('duplicateOverlay'),
    status: document.getElementById('statusText'),
    sync: document.getElementById('syncText'),
    panelTabs: document.getElementById('panelTabs'),
    leaveRoomBtn: document.getElementById('leaveRoomBtn'),
    players: document.getElementById('playersList'),
    playersCount: document.getElementById('playersCount'),
    banList: document.getElementById('banList'),
    blacklistBlock: document.getElementById('blacklistBlock'),
    messages: document.getElementById('messages'),
    systemFeed: document.getElementById('systemFeed'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    settingsRoomName: document.getElementById('settingsRoomName'),
    dictCheckList: document.getElementById('dictCheckList'),
    dictNote: document.getElementById('dictNote'),
    roundMinInput: document.getElementById('roundMinInput'),
    disableHintsInput: document.getElementById('disableHintsInput'),
    noDrawInput: document.getElementById('noDrawInput'),
    soundOffInput: document.getElementById('soundOffInput'),
    playPrefsNote: document.getElementById('playPrefsNote'),
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
})();
