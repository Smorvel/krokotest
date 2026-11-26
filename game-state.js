/* Общее состояние комнаты Кроко: данные, инструменты и ссылки на DOM. */
(function () {
  var G = window.KROKO_GAME = {};
  var K = window.KROKO;
  if (!K || !window.mqtt) return;

  G.K = K;
  G.params = new URLSearchParams(location.search);
  G.room = G.params.get('room') || K.DEFAULT_ROOM;
  G.profile = K.getProfile();
  G.myId = G.profile.id;
  G.myFingerprint = G.profile.fingerprint || K.getFingerprint();
  G.sessionJoinedAt = Date.now();

  G.DEFAULT_ROUND_MS = 5 * 60 * 1000;
  G.MAX_ROUND_MS = 60 * 60 * 1000;
  G.HIT_PAUSE_MS = 2400;
  G.HISTORY_LIMIT = 30;

  G.PRESET_COLORS = [
    '#111827', '#ffffff', '#ef4444', '#f97316', '#fbbf24', '#a3e635',
    '#34d399', '#22d3ee', '#38bdf8', '#6366f1', '#a78bfa', '#f472b6'
  ];

  G.SHAPE_LABELS = { square: 'квадрат', circle: 'круг', stripe: 'полоса' };

  G.TOOLS = [
    { id: 'brush', name: 'Стандартная кисть', icon: '<path d="M4 18c2.2.6 4-.2 5-2 .8-1.5 1-3 2.5-4.5L16 7l3 3-5.5 5.5C12 16 10.5 16.2 9 17c-1.5 1-3.3 1.8-5 1Z"/>' },
    { id: 'soft', name: 'Мягкая кисть', icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>' },
    { id: 'tablet', name: 'Кисть для планшета', icon: '<path d="M4 19c2-6 3-9 5-9s2 7 4 7 2-9 4-9 2 6 3 11"/><path d="M8 4h8l1 3H7l1-3Z"/>' },
    { id: 'shape', name: 'Фигуры', icon: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 12h8"/>' },
    { id: 'fill', name: 'Заливка', icon: '<path d="m12 3 8 8-8 8-8-8 8-8Z"/><path d="M20 11c-2 2-3 3-3 4a2 2 0 0 0 4 0c0-1-1-2-1-4Z"/>' },
    { sep: true },
    { id: 'eraser', name: 'Ластик', icon: '<path d="m4 16 7-7 7 7-4 4H8l-4-4Z"/><path d="m8 12 5 5"/>' }
  ];

  G.state = null;
  G.meta = null;
  G.stateSeen = false;
  G.subscribedAt = 0;
  G.presenceReadyAt = 0;
  G.initialStateTimer = null;
  G.presence = {};
  G.remoteDrafts = {};
  G.localDraft = null;
  G.drawing = false;
  G.lastDraftPublish = 0;
  G.handledStart = null;
  G.banned = false;
  G.client = null;
  G.activePanel = 'chat';
  G.editingInlineDict = null;
  G.handledHitId = null;
  G.hitTimer = null;
  G.wasHitPaused = false;
  G.previousTool = 'brush';
  G.draftFrame = null;
  G.knobDrag = null;
  G.stampCache = {};
  G.smoothPoint = null;
  G.lastCursorEvent = null;

  G.tool = {
    current: 'brush',
    size: Number(G.profile.brushSize) || 18,
    alpha: Number(G.profile.brushAlpha) || 100,
    color: G.profile.inkColor || '#111827',
    bg: G.profile.bgColor || '#ffffff',
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
    leaveRoomBtn: document.getElementById('leaveRoomBtn'),
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
})();
