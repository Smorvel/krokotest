/* Главная: только считаем игроков в единственной комнате. */
(function () {
  'use strict';
  if (!window.KROKO) return;

  var onlineText = document.getElementById('onlineText');
  var roomOnline = document.getElementById('roomOnline');
  if (!onlineText || !roomOnline) return;

  var presence = {};
  var clientId = 'watch-' + KROKO.uid();
  var client = KROKO.connect(clientId, null);

  function render() {
    var now = Date.now();
    var names = Object.keys(presence).filter(function (id) {
      return presence[id].online && now - presence[id].ts < 60000;
    });
    onlineText.textContent = client.connected
      ? (names.length ? names.length + ' игрок(ов) сейчас в комнате' : 'В комнате пока пусто — заходи первым')
      : 'Нет соединения с игровым сервером, переподключаем...';
    roomOnline.textContent = client.connected ? String(names.length) : '—';
  }

  client.on('connect', function () {
    client.subscribe(KROKO.BASE + '/presence/+', { qos: 1 });
    render();
  });

  client.on('reconnect', render);
  client.on('offline', render);
  client.on('error', function () { render(); });

  client.on('message', function (topic, message) {
    if (topic.indexOf(KROKO.BASE + '/presence/') !== 0) return;
    var data = KROKO.parse(message);
    if (!data || !data.id) return;
    if (data.online === false) delete presence[data.id];
    else {
      var ts = Number(data.ts) || 0;
      if (Date.now() - ts < 60000) presence[data.id] = { online: true, ts: ts };
      else delete presence[data.id];
    }
    render();
  });

  setInterval(render, 15000);
  render();
})();
