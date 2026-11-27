/* Single-tab guard: a newer game tab with the same profile removes the older one. */
(function (G) {
  var K = window.KROKO;
  if (!K) return;

  var profile = K.getProfile();
  var tabId = K.uid();
  var claimAt = Date.now();
  var claimSeq = Math.random();
  var channel = null;
  var storageKey = 'krokotest.game.session.claim';

  function claim() {
    return {
      type: 'claim',
      tab: tabId,
      profileId: profile.id,
      at: claimAt,
      seq: claimSeq,
      room: G.room
    };
  }

  function isNewer(data) {
    if (!data || data.type !== 'claim') return false;
    if (data.tab === tabId || data.profileId !== profile.id) return false;
    var at = Number(data.at) || 0;
    var seq = Number(data.seq) || 0;
    return at > claimAt || (at === claimAt && seq > claimSeq);
  }

  function kick() {
    if (G.sessionKicked) return;
    G.sessionKicked = true;
    G.closePalettePopover && G.closePalettePopover();
    try { if (G.client && G.client.connected) G.publishPresence(false); } catch (err) { /* уже отключено */ }
    try { if (G.client) G.client.end(true); } catch (err) { /* уже отключено */ }
    try {
      if (G.el.loadingOverlay) G.el.loadingOverlay.hidden = true;
      if (G.el.duplicateOverlay) G.el.duplicateOverlay.hidden = false;
      document.body.classList.remove('syncing');
      document.body.classList.add('session-kicked');
    } catch (err) { /* страница уже закрывается */ }
  }

  function receive(raw) {
    var data = raw;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (err) { return; }
    }
    if (isNewer(data)) kick();
  }

  try {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel('krokotest.game.session');
      channel.onmessage = function (event) { receive(event.data); };
      channel.postMessage(claim());
    }
  } catch (err) { /* BroadcastChannel недоступен — используем localStorage */ }

  try {
    localStorage.setItem(storageKey, JSON.stringify(claim()));
    window.addEventListener('storage', function (event) {
      if (event.key === storageKey && event.newValue) receive(event.newValue);
    });
  } catch (err) { /* приватный режим */ }

  G.sessionTabId = tabId;
  G.sessionClaimAt = claimAt;
  G.kickForDuplicateSession = kick;
})(window.KROKO_GAME);
