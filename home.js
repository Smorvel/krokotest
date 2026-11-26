/* Главная: список комнат, онлайн и создание своей комнаты. */
(function () {
  'use strict';

  var K = window.KROKO;
  if (!K) return;

  var profile = K.getProfile();
  var defaultDictionary = K.findDictionary('easy');
  var metas = {};
  var online = {};
  var presenceByRoom = {};

  metas[K.DEFAULT_ROOM] = {
    slug: K.DEFAULT_ROOM,
    name: 'Простые',
    creatorId: '',
    dictionary: { id: defaultDictionary.id, name: defaultDictionary.name, words: defaultDictionary.words },
    createdAt: 1,
    system: true
  };

  var list = document.getElementById('roomList');
  var statRooms = document.getElementById('statRooms');
  var statOnline = document.getElementById('statOnline');
  var statDicts = document.getElementById('statDicts');
  var form = document.getElementById('createForm');
  var nameInput = document.getElementById('roomName');
  var dictSelect = document.getElementById('roomDictionary');

  function fillDictionarySelect() {
    dictSelect.innerHTML = K.getDictionaries().map(function (d) {
      return '<option value="' + K.escapeHtml(d.id) + '">' + K.escapeHtml(d.name) + ' (' + d.words.length + ')</option>';
    }).join('');
  }

  function render() {
    var rooms = Object.keys(metas).map(function (slug) { return metas[slug]; });
    var localSlugs = {};
    K.getRooms().forEach(function (room) {
      localSlugs[room.slug] = true;
      if (!metas[room.slug]) metas[room.slug] = room;
    });
    rooms = Object.keys(metas).map(function (slug) { return metas[slug]; });
    rooms.sort(function (a, b) {
      if (a.system) return -1;
      if (b.system) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    list.innerHTML = rooms.map(function (room) {
      var count = online[room.slug] || 0;
      var dictionary = room.dictionary ? room.dictionary.name : 'Простые слова';
      var own = room.creatorId === profile.id ? '<span class="player-tag">создатель</span>' : '';
      return '<a class="room-card" href="game.html?room=' + encodeURIComponent(room.slug) + '">' +
        '<span class="room-emoji">' + (room.system ? '🎨' : (room.creatorId === profile.id ? '⭐' : '👥')) + '</span>' +
        '<span class="room-info"><h3>' + K.escapeHtml(room.name) + ' ' + own + '</h3>' +
        '<p>Словарь: ' + K.escapeHtml(dictionary) + ' · ссылка открыта для всех</p></span>' +
        '<span class="room-side"><span class="room-online"><span class="live-dot' + (count ? '' : ' off') + '"></span><b>' + count + '</b> онлайн</span>' +
        '<span class="button primary small">Войти</span></span></a>';
    }).join('');

    var totalOnline = 0;
    Object.keys(online).forEach(function (slug) { totalOnline += online[slug]; });
    statRooms.textContent = rooms.length;
    statOnline.textContent = totalOnline;
    statDicts.textContent = K.getDictionaries().length;
  }

  var client = K.connect('home-' + profile.id + '-' + K.uid(), null);

  client.on('connect', function () {
    client.subscribe(K.ROOT + '/+/meta', { qos: 1 });
    client.subscribe(K.ROOT + '/+/presence/+', { qos: 1 });
    K.publish(client, K.topic(K.DEFAULT_ROOM, 'meta'), metas[K.DEFAULT_ROOM], true);
    render();
  });

  client.on('message', function (topic, message) {
    var data = K.parse(message);
    if (!data) return;
    var parts = topic.split('/');
    var slug = parts[2];
    if (!slug) return;

    if (topic.indexOf(K.ROOT + '/') === 0 && parts[3] === 'meta' && data.slug) {
      metas[slug] = data;
      render();
      return;
    }

    if (parts[3] === 'presence' && data.id) {
      var now = Date.now();
      var ts = Number(data.ts) || 0;
      if (!presenceByRoom[slug]) presenceByRoom[slug] = {};
      if (data.online === false || now - ts >= 60000) delete presenceByRoom[slug][data.id];
      else presenceByRoom[slug][data.id] = ts;
      online[slug] = Object.keys(presenceByRoom[slug]).length;
      render();
    }
  });

  client.on('reconnect', render);
  client.on('offline', render);
  client.on('error', render);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var name = nameInput.value.trim();
    if (!name) return;
    var dictionary = K.findDictionary(dictSelect.value);
    var slug = 'room-' + K.uid();
    var meta = {
      slug: slug,
      name: name,
      creatorId: profile.id,
      creatorName: profile.name,
      dictionary: { id: dictionary.id, name: dictionary.name, words: dictionary.words.slice(0, 500) },
      createdAt: Date.now()
    };
    metas[slug] = meta;
    K.saveRoom(meta);
    if (client.connected) K.publish(client, K.topic(slug, 'meta'), meta, true);
    location.href = 'game.html?room=' + encodeURIComponent(slug);
  });

  fillDictionarySelect();
  render();
  setInterval(render, 20000);
})();
