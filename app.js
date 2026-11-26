/* Общие функции: профиль, слова и MQTT-подключение. */
(function () {
  'use strict';

  var BROKER = 'wss://broker.hivemq.com:8884/mqtt';
  var BASE = 'krokotest/simple/v1';
  var KEY_PROFILE = 'krokotest.profile.v1';

  var WORDS = [
    'дом', 'кот', 'солнце', 'дерево', 'мяч', 'книга', 'чашка', 'велосипед',
    'мост', 'облако', 'пицца', 'гитара', 'школа', 'друг', 'собака', 'птица',
    'рыба', 'цветок', 'дождь', 'снег', 'зима', 'лето', 'город', 'окно',
    'стул', 'ключ', 'часы', 'зеркало', 'бабочка', 'карандаш', 'молоко', 'хлеб',
    'компьютер', 'телефон'
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

  function maskWord(word) {
    return String(word || '').replace(/\S/g, '•');
  }

  function getProfile() {
    var profile = null;
    try { profile = JSON.parse(localStorage.getItem(KEY_PROFILE) || 'null'); } catch (err) { profile = null; }
    if (!profile || !profile.id) {
      profile = {
        id: uid(),
        name: 'Игрок ' + (10 + hash(navigator.userAgent) % 90),
        color: colorFor(navigator.userAgent),
        named: false
      }
      try { localStorage.setItem(KEY_PROFILE, JSON.stringify(profile)); } catch (err) { /* приватный режим */ }
    }
    return profile;
  }

  function setProfile(profile) {
    profile.named = true;
    try { localStorage.setItem(KEY_PROFILE, JSON.stringify(profile)); } catch (err) { /* приватный режим */ }
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

  function publish(client, topic, value, retain) {
    if (!client || !client.connected) return false;
    client.publish(topic, JSON.stringify(value), { qos: 1, retain: !!retain });
    return true;
  }

  function parse(message) {
    try { return JSON.parse(message.toString()); } catch (err) { return null; }
  }

  window.KROKO = {
    BROKER: BROKER,
    BASE: BASE,
    TOPIC_STATE: BASE + '/state',
    TOPIC_PRESENCE: BASE + '/presence/',
    TOPIC_DRAFT: BASE + '/draft/',
    WORDS: WORDS,
    uid: uid,
    hash: hash,
    colorFor: colorFor,
    escapeHtml: escapeHtml,
    maskWord: maskWord,
    getProfile: getProfile,
    setProfile: setProfile,
    connect: connect,
    publish: publish,
    parse: parse
  };
})();
