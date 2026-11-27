/* Главная: активные комнаты, одна своя комната и редактор аватара. */
(function () {
  'use strict';

  var K = window.KROKO;
  if (!K) return;

  var COMMON_NAME = 'Общая';
  var EYE_LABELS = { round: 'Круглые', happy: 'Весёлые', sleepy: 'Сонные', wide: 'Широкие', wink: 'Подмигивание' };
  var MOUTH_LABELS = { smile: 'Улыбка', grin: 'С зубами', neutral: 'Ровный', frown: 'Грустный', surprised: 'Удивлённый' };

  var profile = K.getProfile();
  var defaultDictionary = K.findDictionary('easy');
  var metas = {};
  var online = {};
  var presenceByRoom = {};
  var editingRoom = false;
  var roomSavedTimer = null;
  var avatarSavedTimer = null;

  metas[K.DEFAULT_ROOM] = {
    slug: K.DEFAULT_ROOM,
    name: COMMON_NAME,
    creatorId: '',
    creatorFingerprint: '',
    dictionary: { id: defaultDictionary.id, name: defaultDictionary.name, words: defaultDictionary.words },
    dictionaryIds: [defaultDictionary.id],
    dictionaryPool: [{ id: defaultDictionary.id, name: defaultDictionary.name, words: defaultDictionary.words.slice(0, 500) }],
    createdAt: 1,
    system: true
  };

  var list = document.getElementById('roomList');
  var statRooms = document.getElementById('statRooms');
  var statOnline = document.getElementById('statOnline');
  var statDicts = document.getElementById('statDicts');
  var myRoomCard = document.getElementById('myRoomCard');
  var avatarPreview = document.getElementById('avatarPreview');
  var avatarPreviewName = document.getElementById('avatarPreviewName');
  var avatarName = document.getElementById('avatarName');
  var avatarBody = document.getElementById('avatarBody');
  var avatarEyes = document.getElementById('avatarEyes');
  var avatarMouth = document.getElementById('avatarMouth');
  var avatarBg = document.getElementById('avatarBg');
  var avatarSaved = document.getElementById('avatarSaved');

  function dictionaryNames(room) {
    if (Array.isArray(room.dictionaryIds) && room.dictionaryIds.length) {
      var names = room.dictionaryIds.map(function (id) {
        var dict = K.findDictionary(id);
        return dict ? dict.name : '';
      }).filter(Boolean);
      if (names.length) return names.join(', ');
    }
    return room.dictionary ? room.dictionary.name : 'Простые слова';
  }

  function countOf(slug) {
    return online[slug] || 0;
  }

  function isOwnRoom(room) {
    if (!room) return false;
    if (profile.ownRoomSlug && room.slug === profile.ownRoomSlug) return true;
    if (room.creatorId && room.creatorId === profile.id) return true;
    return !!(profile.fingerprint && room.creatorFingerprint && room.creatorFingerprint === profile.fingerprint);
  }

  function ownRoom() {
    var rooms = K.getRooms();
    var i;
    if (profile.ownRoomSlug) {
      for (i = 0; i < rooms.length; i++) if (rooms[i].slug === profile.ownRoomSlug) return rooms[i];
    }
    for (i = 0; i < rooms.length; i++) if (isOwnRoom(rooms[i])) return rooms[i];
    return null;
  }

  function roomCard(room, count) {
    var own = isOwnRoom(room) ? '<span class="player-tag">создатель</span>' : '';
    return '<a class="room-card" href="game.html?room=' + encodeURIComponent(room.slug) + '">' +
      '<span class="room-emoji">' + (room.slug === K.DEFAULT_ROOM ? '🎨' : (own ? '⭐' : '👥')) + '</span>' +
      '<span class="room-info"><h3>' + K.escapeHtml(room.name) + ' ' + own + '</h3>' +
      '<p>Словари: ' + K.escapeHtml(dictionaryNames(room)) + ' · ссылка открыта для всех</p></span>' +
      '<span class="room-side"><span class="room-online"><span class="live-dot' + (count ? '' : ' off') + '"></span><b>' + count + '</b> онлайн</span>' +
      '<span class="button primary small">Войти</span></span></a>';
  }

  function renderMyRoom() {
    if (editingRoom) return;
    var room = ownRoom();
    if (!room) {
      myRoomCard.innerHTML = '<form class="create-form card" id="createForm">' +
        '<label><span>Название комнаты</span><input id="roomName" maxlength="24" placeholder="Например, Друзья" required></label>' +
        '<button class="button primary" type="submit">Создать комнату</button></form>';
      return;
    }
    var count = countOf(room.slug);
    myRoomCard.innerHTML = '<div class="own-room-row card">' +
      '<span class="room-emoji">⭐</span>' +
      '<span class="room-info"><h3>' + K.escapeHtml(room.name) + ' <span class="player-tag">создатель</span></h3>' +
      '<p>Словари: ' + K.escapeHtml(dictionaryNames(room)) + ' · <b>' + count + '</b> онлайн</p>' +
      '<span class="saved-line" id="roomSaved" hidden>Сохранено</span></span>' +
      '<span class="own-room-actions">' +
      '<a class="button primary small" href="game.html?room=' + encodeURIComponent(room.slug) + '">Войти</a>' +
      '<button class="button ghost small" type="button" data-action="edit-room">Изменить</button>' +
      '</span></div>' +
      '<form class="create-form card edit-room-form" id="editRoomForm" hidden>' +
      '<label><span>Название комнаты</span><input name="roomName" maxlength="24" value="' + K.escapeHtml(room.name) + '" required></label>' +
      '<span class="form-actions"><button class="button primary small" type="submit">Сохранить</button>' +
      '<button class="button ghost small" type="button" data-action="cancel-edit">Отмена</button></span></form>';
  }

  function render() {
    var rooms = Object.keys(metas).map(function (slug) { return metas[slug]; });
    K.getRooms().forEach(function (room) {
      if (!metas[room.slug]) metas[room.slug] = room;
    });
    rooms = Object.keys(metas).map(function (slug) { return metas[slug]; });
    rooms.sort(function (a, b) {
      if (a.slug === K.DEFAULT_ROOM) return -1;
      if (b.slug === K.DEFAULT_ROOM) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    var active = rooms.filter(function (room) {
      return room.slug === K.DEFAULT_ROOM || countOf(room.slug) > 0;
    });
    list.innerHTML = active.map(function (room) {
      return roomCard(room, countOf(room.slug));
    }).join('');

    var totalOnline = 0;
    Object.keys(online).forEach(function (slug) { totalOnline += online[slug]; });
    statRooms.textContent = active.length;
    statOnline.textContent = totalOnline;
    statDicts.textContent = K.getDictionaries().length;
    renderMyRoom();
  }

  function publishMeta(meta) {
    metas[meta.slug] = meta;
    K.saveRoom(meta);
    if (client.connected) K.publish(client, K.topic(meta.slug, 'meta'), meta, true);
  }

  function createRoom(name) {
    var dictionary = {
      id: defaultDictionary.id,
      name: defaultDictionary.name,
      words: defaultDictionary.words.slice(0, 500)
    };
    var slug = 'room-' + K.uid();
    var meta = {
      slug: slug,
      name: name,
      creatorId: profile.id,
      creatorName: profile.name,
      creatorFingerprint: profile.fingerprint || K.getFingerprint(),
      dictionary: dictionary,
      dictionaryIds: [dictionary.id],
      dictionaryPool: [dictionary],
      createdAt: Date.now()
    };
    profile.ownRoomSlug = slug;
    K.setProfile(profile);
    publishMeta(meta);
    location.href = 'game.html?room=' + encodeURIComponent(slug);
  }

  function updateRoom(name) {
    var room = ownRoom();
    if (!room) return;
    room.name = name;
    room.creatorId = room.creatorId || profile.id;
    room.creatorName = profile.name;
    room.creatorFingerprint = room.creatorFingerprint || profile.fingerprint || K.getFingerprint();
    profile.ownRoomSlug = room.slug;
    K.setProfile(profile);
    publishMeta(room);
    editingRoom = false;
    render();
    var saved = document.getElementById('roomSaved');
    if (saved) {
      saved.hidden = false;
      clearTimeout(roomSavedTimer);
      roomSavedTimer = setTimeout(function () { saved.hidden = true; }, 1800);
    }
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
    var slug = parts[3];
    if (!slug) return;

    if (topic.indexOf(K.ROOT + '/') === 0 && parts[4] === 'meta' && data.slug) {
      if (slug === K.DEFAULT_ROOM) {
        data.slug = K.DEFAULT_ROOM;
        data.name = COMMON_NAME;
        data.system = true;
      }
      metas[slug] = data;
      render();
      return;
    }

    if (parts[4] === 'presence' && data.id) {
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

  myRoomCard.addEventListener('submit', function (event) {
    event.preventDefault();
    if (event.target.id === 'createForm') {
      var name = event.target.querySelector('#roomName').value.trim();
      if (name) createRoom(name);
    } else if (event.target.id === 'editRoomForm') {
      var nextName = event.target.querySelector('[name="roomName"]').value.trim();
      if (nextName) updateRoom(nextName);
    }
  });

  myRoomCard.addEventListener('click', function (event) {
    var action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'edit-room') {
      editingRoom = true;
      var form = document.getElementById('editRoomForm');
      if (form) form.hidden = false;
    } else if (action.dataset.action === 'cancel-edit') {
      editingRoom = false;
      renderMyRoom();
    }
  });

  function selectOptions(values, labels) {
    return values.map(function (value) {
      return '<option value="' + value + '">' + K.escapeHtml(labels[value] || value) + '</option>';
    }).join('');
  }

  function avatarDraft() {
    return {
      body: avatarBody.value,
      eyes: avatarEyes.value,
      mouth: avatarMouth.value,
      bg: avatarBg.value
    };
  }

  function renderAvatarPreview() {
    avatarPreview.innerHTML = K.avatarMarkup({
      name: avatarName.value.trim() || profile.name,
      color: avatarBody.value,
      avatar: avatarDraft()
    }, 'avatar-large');
    avatarPreviewName.textContent = avatarName.value.trim() || 'Игрок';
  }

  function syncAvatarControls() {
    avatarName.value = profile.named ? profile.name : '';
    avatarBody.value = profile.avatar.body;
    avatarBg.value = profile.avatar.bg;
    avatarEyes.value = profile.avatar.eyes;
    avatarMouth.value = profile.avatar.mouth;
    renderAvatarPreview();
  }

  function saveAvatar() {
    var name = avatarName.value.trim() || profile.name;
    profile.name = name;
    profile.color = avatarBody.value;
    profile.avatar = avatarDraft();
    K.setProfile(profile);
    syncAvatarControls();
    avatarSaved.hidden = false;
    clearTimeout(avatarSavedTimer);
    avatarSavedTimer = setTimeout(function () { avatarSaved.hidden = true; }, 1800);
  }

  avatarEyes.innerHTML = selectOptions(K.AVATAR_EYES, EYE_LABELS);
  avatarMouth.innerHTML = selectOptions(K.AVATAR_MOUTHS, MOUTH_LABELS);
  [avatarName, avatarBody, avatarEyes, avatarMouth, avatarBg].forEach(function (control) {
    control.addEventListener('input', renderAvatarPreview);
    control.addEventListener('change', renderAvatarPreview);
  });
  document.getElementById('avatarSave').addEventListener('click', saveAvatar);
  syncAvatarControls();

  render();
  setInterval(render, 20000);
})();
