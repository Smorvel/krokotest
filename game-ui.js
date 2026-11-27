/* Chat, reactions, bans and room settings handlers. */
(function (G) {
  with (G) {
    /* Чат, реакции, баны, настройки */
  
    function checkAnswer(text) {
      var targets = phraseTargets();
      if (!targets.length) return { hit: false, newWords: [] };
      var tokens = phraseWords(text);
      var guessed = (state.guessedWords || []).slice();
      var newWords = [];
      targets.forEach(function (target) {
        if (tokens.indexOf(target.key) >= 0 && guessed.indexOf(target.key) < 0) {
          guessed.push(target.key);
          newWords.push(target);
        }
      });
      if (!newWords.length) return { hit: false, newWords: [] };
      state.guessedWords = guessed;
      var complete = targets.every(function (target) { return guessed.indexOf(target.key) >= 0; });
      return { hit: complete, newWords: newWords, targets: targets };
    }
  
    el.chatForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (sessionKicked || !state || isDrawer() || isBannedMe() || isHitPaused()) return;
      var text = el.chatInput.value.trim();
      if (!text) return;
      var result = !isDrawer() ? checkAnswer(text) : { hit: false, newWords: [] };
      var message = {
        id: K.uid(), ownerId: myId, name: profile.name, color: profile.color,
        text: text, hit: result.hit, round: state.round, at: Date.now()
      };
      state.messages.push(message);
      state.messages = state.messages.slice(-50);
      el.chatInput.value = '';
  
      if (result.newWords.length && !result.hit) {
        result.newWords.slice(0, 3).forEach(function (target) {
          systemMessage('Слово «' + target.display + '» присутствует в загадке!');
        });
      }
      var hitPayload = null;
      if (result.hit) {
        state.scores[profile.name] = (state.scores[profile.name] || 0) + 10;
        var single = result.targets.length === 1;
        var reason = profile.name + (single ? ' угадал! +10 очков.' : ' угадал все слова! +10 очков.');
        systemMessage(reason);
        state.pausedUntil = Date.now() + HIT_PAUSE_MS;
        state.hitInfo = {
          id: K.uid(),
          guesserId: myId,
          text: single ? '🎯 ' + profile.name + ' угадал! +10 очков' : '🎯 Все слова угаданы! +10 очков',
          reason: reason,
          at: Date.now()
        };
        hitPayload = {
          guessedWords: result.newWords.map(function (target) { return target.key; }),
          scoreName: profile.name,
          score: state.scores[profile.name],
          hitInfo: state.hitInfo
        };
        showHitAnimation(state.hitInfo);
        scheduleHitResolution(state.hitInfo);
      }
      publishChatEvent(message, hitPayload);
      publishState();
      renderAll();
    });
  
    el.messages.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-react]');
      if (!btn || !isDrawer() || isBannedMe() || !state) return;
      var id = btn.dataset.msg;
      var message = state.messages.filter(function (m) { return m.id === id; })[0];
      if (!message || isOldMessage(message)) return;
      var value = btn.dataset.react === 'like' ? 'like' : 'dislike';
      state.reactions[id] = { value: reactionValue(id) === value ? '' : value };
      publishState();
      renderMessages();
    });
  
    el.players.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-ban]');
      if (!btn || !isCreator() || !state) return;
      var id = btn.dataset.ban;
      if (id === myId || isIdBanned(id)) return;
      var player = presentPlayers().filter(function (p) { return p.id === id; })[0];
      var record = {
        id: id,
        name: player ? player.name : 'Игрок',
        fingerprint: player ? player.fingerprint || '' : '',
        at: Date.now()
      };
      state.bans.push(id);
      state.banRecords = state.banRecords.filter(function (r) { return r.id !== id; });
      state.banRecords.push(record);
      state.queue = state.queue.filter(function (q) { return q !== id; });
      systemMessage(record.name + ' удалён создателем комнаты.');
      if (state.drawer === id) rotateDrawer('Художник удалён.');
      delete presence[id];
      delete remoteDrafts[id];
      publishState();
      renderAll();
    });
  
    el.banList.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-unban]');
      if (!btn || !isCreator() || !state) return;
      var id = btn.dataset.unban;
      state.bans = state.bans.filter(function (value) { return value !== id; });
      state.banRecords = state.banRecords.filter(function (record) { return record.id !== id; });
      systemMessage('Игрок разбанен создателем комнаты.');
      publishState();
      renderAll();
    });
  
    el.dictCheckList.addEventListener('change', function () {
      if (!isCreator() || !state) return;
      var ids = [].slice.call(el.dictCheckList.querySelectorAll('input:checked')).map(function (input) { return input.value; });
      if (!ids.length) {
        renderDictChecks();
        return;
      }
      state.dictionaryIds = ids;
      state.dictionaryPool = dictionariesByIds(ids).map(function (dict) {
        return { id: dict.id, name: dict.name, words: dict.words.slice(0, K.MAX_DICTIONARY_WORDS) };
      });
      if (meta) {
        meta.dictionaryIds = ids.slice();
        meta.dictionaryPool = state.dictionaryPool;
        K.publish(client, K.topic(room, 'meta'), meta, true);
      }
      publishState();
      renderTools();
    });
  
    el.roundMinInput.addEventListener('change', function () {
      if (!isCreator() || !state) return;
      var minutes = Number(el.roundMinInput.value);
      if (!isFinite(minutes)) minutes = 5;
      minutes = Math.max(0, Math.min(60, minutes));
      state.roundMs = Math.round(minutes * 60000);
      state.startedAt = Date.now();
      state.waitingForPlayers = false;
      state.expiredAt = 0;
      state.hintSent = false;
      handledStart = 0;
      el.roundMinInput.value = minutes;
      systemMessage(state.roundMs ? 'Время раунда: ' + minutes + ' мин.' : 'Время раунда: без ограничений.');
      publishState();
      renderAll();
    });
  
    el.disableHintsInput.addEventListener('change', function () {
      if (!isCreator() || !state) return;
      state.hintsDisabled = el.disableHintsInput.checked;
      if (state.hintsDisabled) state.hintSent = false;
      systemMessage(state.hintsDisabled ? 'Подсказки отключены.' : 'Подсказки включены.');
      publishState();
      renderAll();
    });
  
    function switchPanel(name) {
      activePanel = name;
      el.panelTabs.querySelectorAll('.panel-tab').forEach(function (button) {
        button.classList.toggle('active', button.dataset.tab === name);
      });
      document.querySelectorAll('[data-panel]').forEach(function (panel) {
        panel.hidden = panel.dataset.panel !== name;
      });
    }
  
    el.panelTabs.addEventListener('click', function (event) {
      var button = event.target.closest('.panel-tab');
      if (button) switchPanel(button.dataset.tab);
    });
    function leaveRoom() {
      if (sessionKicked) {
        location.href = 'index.html';
        return;
      }
      endRoundOnLeave();
      publishPresence(false);
      sessionKicked = true;
      setTimeout(function () { location.href = 'index.html'; }, 150);
    }

    document.querySelectorAll('.js-leave-room').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        leaveRoom();
      });
    });
  
    function selectInlineDict(id) {
      var found = null;
      K.getCustomDictionaries().forEach(function (dict) { if (dict.id === id) found = dict; });
      editingInlineDict = found ? found.id : null;
      el.settingsDictName.value = found ? found.name : '';
      el.settingsDictWords.value = found ? found.words.join('\n') : '';
      renderInlineDicts();
      renderDictChecks();
    }
  
    el.settingsDictList.addEventListener('click', function (event) {
      var item = event.target.closest('.dict-item');
      if (item) selectInlineDict(item.dataset.id);
    });
  
    el.settingsNameSave.addEventListener('click', function () {
      var name = el.settingsName.value.trim();
      if (!name) return;
      profile.name = name;
      profile.color = K.colorFor(name);
      K.setProfile(profile);
      publishPresence(true);
      el.settingsSaved.hidden = false;
      setTimeout(function () { el.settingsSaved.hidden = true; }, 1800);
      renderAll();
    });
  
    el.settingsDictSave.addEventListener('click', function () {
      var name = el.settingsDictName.value.trim();
      var words = K.wordsFromText(el.settingsDictWords.value);
      if (!name || !words.length) return;
      var list = K.getCustomDictionaries();
      var existing = null;
      list.forEach(function (dict) { if (dict.id === editingInlineDict) existing = dict; });
      if (existing) {
        existing.name = name;
        existing.words = words;
      } else {
        existing = { id: 'custom-' + K.uid(), name: name, words: words, createdAt: Date.now() };
        list.push(existing);
      }
      K.saveCustomDictionaries(list);
      selectInlineDict(existing.id);
    });
  
    el.settingsDictDelete.addEventListener('click', function () {
      if (!editingInlineDict) return;
      var list = K.getCustomDictionaries().filter(function (dict) { return dict.id !== editingInlineDict; });
      K.saveCustomDictionaries(list);
      selectInlineDict(null);
    });
  
    el.settingsDictNew.addEventListener('click', function () { selectInlineDict(null); });
  
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
    G.checkAnswer = checkAnswer;
    G.switchPanel = switchPanel;
    G.selectInlineDict = selectInlineDict;
  }
})(window.KROKO_GAME);
