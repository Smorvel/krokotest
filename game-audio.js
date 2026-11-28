/* Звуки раунда. Воспроизведение не должно мешать игре: один элемент на звук,
   никаких повторных загрузок и никаких повторов на MQTT-echo. */
(function (G) {
  if (!G) return;

  var SOURCES = {
    draw: 'sound/draw.wav',
    finish: 'sound/finish.wav',
    notime: 'sound/notime.wav'
  };
  var elements = {};
  var pending = [];
  var unlocked = false;
  var audioContext = null;
  var soundEnabled = G.soundEnabled !== false;

  function setEnabled(value) {
    soundEnabled = !!value;
    if (!soundEnabled) {
      pending.length = 0;
      Object.keys(elements).forEach(function (name) {
        try {
          elements[name].pause();
          elements[name].currentTime = 0;
        } catch (error) {}
      });
      return;
    }
    unlock();
  }

  function unlock() {
    if (!soundEnabled) return;
    /* Короткий звук в AudioContext снимает блокировку автовоспроизведения
       после первого реального действия игрока на странице. */
    try {
      if (!audioContext) {
        var Context = window.AudioContext || window.webkitAudioContext;
        if (Context) {
          audioContext = new Context();
          var buffer = audioContext.createBuffer(1, 1, 22050);
          var source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(audioContext.destination);
          source.start(0);
        }
      }
      if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    } catch (error) {}
    unlocked = true;
    var queued = pending.splice(0);
    queued.forEach(function (name) { play(name); });
  }

  document.addEventListener('pointerdown', unlock, { passive: true, capture: true });
  document.addEventListener('keydown', unlock, { capture: true });

  function element(name) {
    if (!elements[name]) {
      var audio = new Audio(SOURCES[name]);
      audio.preload = 'auto';
      elements[name] = audio;
    }
    return elements[name];
  }

  function play(name) {
    if (!soundEnabled || !SOURCES[name]) return;
    unlock();
    try {
      var audio = element(name);
      audio.currentTime = 0;
      var result = audio.play();
      if (result && typeof result.catch === 'function') {
        result.catch(function () {
          if (pending.indexOf(name) < 0) pending.push(name);
        });
      }
    } catch (error) {
      if (pending.indexOf(name) < 0) pending.push(name);
    }
  }

  var soundTurnKey = '';
  var endedTurnKey = '';
  var notimeTurnKey = '';

  /* Один вызов на изменение состояния и раз в секунду. Ключи привязаны
     к раунду, поэтому повторная публикация state не проигрывает звуки снова. */
  function updateSounds() {
    var state = G.state;
    if (!state || G.sessionKicked) return;

    var turnKey = [state.round, state.startedAt, state.wordIndex, state.drawer].join(':');
    if (turnKey !== soundTurnKey) {
      soundTurnKey = turnKey;
      endedTurnKey = '';
      notimeTurnKey = '';
      if (state.drawer === G.myId && !state.reveal) play('draw');
    }

    var reveal = state.reveal;
    var roundEnded = !!((state.hitInfo && state.hitInfo.id) || (reveal && reveal.id));
    if (roundEnded && endedTurnKey !== soundTurnKey) {
      endedTurnKey = soundTurnKey;
      play('finish');
    }

    if (!reveal && !(state.hitInfo && state.hitInfo.id) && !G.isHitPaused() &&
        Number(state.roundMs) >= 60000) {
      var left = Number(G.remainingRoundMs && G.remainingRoundMs()) || 0;
      if (left > 0 && left <= 30000 && notimeTurnKey !== soundTurnKey) {
        notimeTurnKey = soundTurnKey;
        play('notime');
      }
    }
  }

  G.audio = { unlock: unlock, play: play, setEnabled: setEnabled };
  G.updateSounds = updateSounds;
})(window.KROKO_GAME);
