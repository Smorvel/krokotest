/* Общие функции Кроко: профиль, словари, комнаты и MQTT. */
(function () {
  'use strict';

  var BROKER = 'wss://broker.hivemq.com:8884/mqtt';
  var ROOT = 'krokotest/v2/rooms';
  var DEFAULT_ROOM = 'prostye';
  var KEY_PROFILE = 'krokotest.profile.v1';
  var KEY_DICTS = 'krokotest.dictionaries.v1';
  var KEY_ROOMS = 'krokotest.rooms.v1';

  var BUILTIN_DICTIONARIES = [
    {
      id: 'easy', name: 'Простые слова', words: [
        'дом', 'кот', 'солнце', 'дерево', 'мяч', 'книга', 'чашка', 'велосипед',
        'мост', 'облако', 'пицца', 'гитара', 'школа', 'друг', 'собака', 'птица',
        'рыба', 'цветок', 'дождь', 'снег', 'зима', 'лето', 'город', 'окно',
        'стул', 'ключ', 'часы', 'зеркало', 'бабочка', 'карандаш', 'молоко', 'хлеб',
        'компьютер', 'телефон', 'кофе', 'торт', 'кровь', 'плеер', 'фонарь', 'лестница'
      ]
    },
    {
      id: 'animals', name: 'Животные', words: [
        'лев', 'тигр', 'слон', 'жираф', 'зебра', 'медведь', 'волк', 'лиса',
        'заяц', 'еж', 'белка', 'кенгуру', 'коала', 'панда', 'обезьяна', 'попугай',
        'орёл', 'пингвин', 'дельфин', 'кит', 'акула', 'осьминог', 'черепаха', 'змея',
        'лягушка', 'бабочка', 'жук', 'паук', 'муравей', 'пчела', 'комар', 'улитка'
      ]
    },
    {
      id: 'food', name: 'Еда и напитки', words: [
        'борщ', 'пельмени', 'пицца', 'суши', 'гамбургер', 'хот-дог', 'шаурма', 'плов',
        'паста', 'лапша', 'салат', 'сыр', 'хлеб', 'масло', 'йогурт', 'молоко',
        'кофе', 'чай', 'сок', 'лимонад', 'торт', 'пирог', 'печенье', 'мороженое',
        'шоколад', 'конфета', 'яблоко', 'банан', 'апельсин', 'вино', 'пиво', 'водка'
      ]
    },
    {
      id: 'movies', name: 'Фильмы и сериалы', words: [
        'Титаник', 'Аватар', 'Гарри Поттер', 'Властелин колец', 'Звёздные войны',
        'Марсианин', 'Интерстеллар', 'Начало', 'Матрица', 'Терминатор',
        'Кинг-Конг', 'Джурассик Парк', 'Форрест Гамп', 'Зеленая миля', 'Бойцовский клуб',
        'Один дома', 'Гонщик', 'Рик и Морти', 'Друзья', 'Клан Сопрано'
      ]
    },
    {
      id: 'hard', name: 'Сложные слова', words: [
        'акварель', 'амфибия', 'бастран', 'вектор', 'гравитация', 'дельтаплан',
        'ехидна', 'журнал', 'зенит', 'иероглиф', 'калейдоскоп', 'лабиринт',
        'метеорит', 'небула', 'орбита', 'панорама', 'парадокс', 'квант',
        'силуэт', 'телескоп', 'ультрафиолет', 'фрактал', 'хамелеон', 'циклон',
        'чертёж', 'шарнир', 'эволюция', 'юпитер', 'якорь', 'архипелаг'
      ]
    }
  ];

  var COLORS = ['#34d399', '#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#fb923c', '#22d3ee', '#f87171'];

  function uid() {
    return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 8);
  }

  function hash(value) {
    var h = 0;
    var text = String(value || '');
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function colorFor(name) {
    return COLORS[hash(name) % COLORS.length];
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function getFingerprint() {
    var parts = [
      navigator.userAgent || '',
      navigator.platform || '',
      navigator.language || '',
      (navigator.languages || []).join(','),
      String(new Date().getTimezoneOffset()),
      [screen.width, screen.height, screen.colorDepth, window.devicePixelRatio].join('x'),
      String(navigator.hardwareConcurrency || ''),
      String(navigator.deviceMemory || ''),
      String(navigator.maxTouchPoints || 0)
    ];
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 280; canvas.height = 60;
      var ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '16px Arial';
      ctx.fillStyle = '#f60'; ctx.fillRect(1, 1, 220, 30);
      ctx.fillStyle = '#069'; ctx.fillText('Кроко::fingerprint', 2, 2);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#0f9'; ctx.fillText('🧩', 20, 20);
      parts.push(canvas.toDataURL());
    } catch (err) { /* canvas может быть недоступен */ }
    try {
      var gl = document.createElement('canvas').getContext('webgl');
      if (gl) {
        var debug = gl.getExtension('WEBGL_debug_renderer_info');
        parts.push(String(gl.getParameter(gl.VERSION)));
        if (debug) {
          parts.push(String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)));
          parts.push(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)));
        }
      }
    } catch (err) { /* WebGL может быть недоступен */ }
    ['Arial', 'Roboto', 'Times New Roman', 'Courier New', 'Verdana'].forEach(function (font) {
      try {
        var span = document.createElement('span');
        span.style.cssText = 'position:absolute;left:-9999px;font-size:72px;white-space:nowrap;font-family:' + font;
        span.textContent = 'Кроко 123 abc';
        document.body.appendChild(span);
        parts.push(font + ':' + span.offsetWidth + 'x' + span.offsetHeight);
        span.remove();
      } catch (err) { /* ignore */ }
    });
    return 'fp-' + hash(parts.join('|'));
  }

  function maskWord(word) {
    return String(word || '').replace(/\S/g, '•');
  }

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* приватный режим */ }
  }

  function getProfile() {
    var profile = read(KEY_PROFILE, null);
    if (!profile || !profile.id) {
      profile = {
        id: uid(),
        name: 'Игрок ' + (10 + hash(navigator.userAgent) % 90),
        color: colorFor(navigator.userAgent),
        named: false,
        inkColor: '#111827',
        bgColor: '#252932',
        brushSize: 18,
        brushAlpha: 100,
        smoothing: false,
        shapeMode: 'square',
        fingerprint: getFingerprint(),
        recentColors: ['#111827', '#ffffff', '#ef4444', '#38bdf8'],
        recentBgColors: ['#252932', '#ffffff', '#111827']
      };
      write(KEY_PROFILE, profile);
    }
    if (!Array.isArray(profile.recentColors)) profile.recentColors = ['#111827', '#ffffff', '#ef4444', '#38bdf8'];
    if (!Array.isArray(profile.recentBgColors)) profile.recentBgColors = ['#252932', '#ffffff', '#111827'];
    if (!profile.inkColor) profile.inkColor = '#111827';
    if (!profile.bgColor) profile.bgColor = '#252932';
    if (!Number(profile.brushSize)) profile.brushSize = 18;
    if (!Number(profile.brushAlpha)) profile.brushAlpha = 100;
    if (typeof profile.smoothing !== 'boolean') profile.smoothing = false;
    if (!profile.shapeMode) profile.shapeMode = 'square';
    if (!profile.fingerprint) profile.fingerprint = getFingerprint();
    return profile;
  }

  function setProfile(profile) {
    profile.named = true;
    write(KEY_PROFILE, profile);
  }

  function getDictionaries() {
    var custom = read(KEY_DICTS, []);
    if (!Array.isArray(custom)) custom = [];
    return BUILTIN_DICTIONARIES.concat(custom.filter(function (d) {
      return d && d.id && d.name && Array.isArray(d.words) && d.words.length;
    }));
  }

  function getCustomDictionaries() {
    return read(KEY_DICTS, []);
  }

  function saveCustomDictionaries(list) {
    write(KEY_DICTS, list);
  }

  function findDictionary(id) {
    var all = getDictionaries();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function getRooms() {
    var rooms = read(KEY_ROOMS, []);
    if (!Array.isArray(rooms)) rooms = [];
    return rooms;
  }

  function saveRoom(meta) {
    var rooms = getRooms().filter(function (r) { return r.slug !== meta.slug; });
    rooms.unshift(meta);
    write(KEY_ROOMS, rooms.slice(0, 30));
  }

  function topic(room, suffix) {
    return ROOT + '/' + room + '/' + suffix;
  }

  function connect(clientId, willMessage) {
    if (!window.mqtt) throw new Error('MQTT library not loaded');
    var options = {
      clientId: clientId,
      clean: true,
      keepalive: 30,
      connectTimeout: 12000,
      reconnectPeriod: 2500,
      protocolVersion: 4
    };
    if (willMessage) options.will = willMessage;
    return window.mqtt.connect(BROKER, options);
  }

  function publish(client, topicName, value, retain) {
    if (!client || !client.connected) return false;
    client.publish(topicName, JSON.stringify(value), { qos: 1, retain: !!retain });
    return true;
  }

  function parse(message) {
    try { return JSON.parse(message.toString()); } catch (err) { return null; }
  }

  function wordsFromText(text) {
    return String(text || '')
      .split(/[\n,;]+/)
      .map(function (w) { return w.trim(); })
      .filter(function (w, i, arr) { return w && w.length <= 60 && arr.indexOf(w) === i; })
      .slice(0, 500);
  }

  function isBanned(state, id) {
    return !!(state && Array.isArray(state.bans) && state.bans.indexOf(id) >= 0);
  }

  window.KROKO = {
    BROKER: BROKER,
    ROOT: ROOT,
    DEFAULT_ROOM: DEFAULT_ROOM,
    BUILTIN_DICTIONARIES: BUILTIN_DICTIONARIES,
    uid: uid,
    hash: hash,
    colorFor: colorFor,
    escapeHtml: escapeHtml,
    maskWord: maskWord,
    getFingerprint: getFingerprint,
    getProfile: getProfile,
    setProfile: setProfile,
    getDictionaries: getDictionaries,
    getCustomDictionaries: getCustomDictionaries,
    saveCustomDictionaries: saveCustomDictionaries,
    findDictionary: findDictionary,
    getRooms: getRooms,
    saveRoom: saveRoom,
    topic: topic,
    connect: connect,
    publish: publish,
    parse: parse,
    wordsFromText: wordsFromText,
    isBanned: isBanned
  };
})();
