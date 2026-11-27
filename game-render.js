/* Room UI rendering. */
(function (G) {
  with (G) {
    function renderPlayers() {
      var players = presentPlayers();
      el.online.textContent = players.length;
      el.playersCount.textContent = players.length;
      el.players.innerHTML = players.map(function (player) {
        var initial = K.escapeHtml(player.name.trim().charAt(0).toUpperCase() || '?');
        var tag = state && state.drawer === player.id ? 'рисует' : (player.id === myId ? 'вы' : '');
        var ban = isCreator() && player.id !== myId && !isFingerprintBanned(player.fingerprint)
          ? '<button class="ban-btn" type="button" data-ban="' + K.escapeHtml(player.id) + '">бан</button>'
          : '';
        return '<li class="player"><span class="avatar" style="background:' + K.escapeHtml(player.color || K.colorFor(player.name)) + '">' + initial + '</span>' +
          '<span class="player-name">' + K.escapeHtml(player.name) + '</span>' +
          (tag ? '<span class="player-tag">' + tag + '</span>' : '') + ban + '</li>';
      }).join('');
    }
  
    function renderBanList() {
      var records = state && Array.isArray(state.banRecords) ? state.banRecords : [];
      if (!records.length) {
        el.banList.innerHTML = '<p class="ban-empty">Заблокированных игроков нет.</p>';
        return;
      }
      el.banList.innerHTML = records.map(function (record) {
        var unban = isCreator()
          ? '<button class="unban-btn" type="button" data-unban="' + K.escapeHtml(record.id) + '">разбанить</button>'
          : '';
        return '<div class="ban-row"><span>' + K.escapeHtml(record.name || 'Игрок') + '</span>' + unban + '</div>';
      }).join('');
    }
  
    function reactionMarkup(message) {
      if (message.system) return '';
      var value = reactionValue(message.id);
      if (!isDrawer() || isBannedMe()) {
        return value ? '<span class="react-mark">' + reactionIcon(value) + '</span>' : '';
      }
      return '<span class="reaction-slot">' +
        '<button class="react-btn' + (value === 'like' ? ' active' : '') + '" type="button" data-react="like" data-msg="' + K.escapeHtml(message.id) + '" aria-label="Лайк">👍</button>' +
        '<button class="react-btn' + (value === 'dislike' ? ' active' : '') + '" type="button" data-react="dislike" data-msg="' + K.escapeHtml(message.id) + '" aria-label="Дизлайк">👎</button>' +
        '</span>';
    }
  
    function renderMessages() {
      if (!state) return;
      var bannedIds = state.bans || [];
      el.messages.innerHTML = state.messages.filter(function (m) {
        return !(m.ownerId && bannedIds.indexOf(m.ownerId) >= 0);
      }).map(function (message) {
        var old = message.round && state.round && Number(message.round) < state.round;
        var cls = 'message' + (old ? ' old' : '') + (message.system ? ' system' : '') + (message.hit ? ' hit' : '');
        var body = message.system
          ? K.escapeHtml(message.text)
          : '<b>' + K.escapeHtml(message.name) + ':</b> ' + K.escapeHtml(message.text);
        return '<div class="' + cls + '">' + reactionMarkup(message) + body + '</div>';
      }).join('');
      el.messages.scrollTop = el.messages.scrollHeight;
    }
  
    function renderWord() {
      if (!state) return;
      var players = presentPlayers();
      var drawer = players.filter(function (p) { return p.id === state.drawer; })[0];
      el.drawer.textContent = drawer ? drawer.name : '—';
      el.round.textContent = state.round;
      el.wordSourceLabel.textContent = getDictionary().name;
      el.word.textContent = displayCharacters(word()).map(function (item) { return item.char; }).join('');
    }
  
    function swatchButton(color, className) {
      var active = tool.color.toLowerCase() === color.toLowerCase() ? ' active' : '';
      return '<button class="' + className + active + '" type="button" data-color="' + K.escapeHtml(color) + '" style="background:' + K.escapeHtml(color) + '" title="' + K.escapeHtml(color) + '"></button>';
    }
  
    function renderPalettes() {
      var recent = (profile.recentColors || []).slice(0, 9);
      while (recent.length < 9) recent.push('');
      if (el.inkBlobs) el.inkBlobs.innerHTML = PRESET_COLORS.map(function (c) { return swatchButton(c, 'ink-blob '); }).join('');
      if (el.editorRecent) {
        el.editorRecent.innerHTML = recent.map(function (color) {
          return color ? swatchButton(color, 'swatch ') : '<span class="empty-swatch"></span>';
        }).join('');
      }
      el.bgSquare.style.background = tool.bg;
    }
  
    function applyColorInputs() {
      [].forEach.call(el.inkColorInputs, function (input) { input.value = tool.color; });
      [].forEach.call(el.inkHexInputs, function (input) { input.value = tool.color; });
      [].forEach.call(el.bgColorInputs, function (input) { input.value = tool.bg; });
      [].forEach.call(el.bgHexInputs, function (input) { input.value = tool.bg; });
    }
  
    function renderToolGrid() {
      el.toolGrid.innerHTML = TOOLS.map(function (entry) {
        if (entry.sep) return '<div class="tool-btn tool-sep" aria-hidden="true"></div>';
        var title = entry.name + (entry.id === 'shape' ? ': ' + SHAPE_LABELS[tool.shapeMode] : '');
        var icon = entry.icon;
        if (entry.id === 'shape') {
          icon = tool.shapeMode === 'circle' ? ICONS.shapeCircle : (tool.shapeMode === 'stripe' ? ICONS.shapeStripe : ICONS.shapeSquare);
        }
        return '<button class="tool-btn' + (tool.current === entry.id ? ' active' : '') + '" type="button" data-tool="' + entry.id + '" title="' + K.escapeHtml(title) + '">' +
          icon + '</button>';
      }).join('');
    }
  
    function renderDictChecks() {
      var selected = selectedDictionaryIds();
      var all = K.getDictionaries().slice();
      availableDictionaries().forEach(function (dict) {
        if (!all.some(function (item) { return item.id === dict.id; })) all.push(dict);
      });
      el.dictCheckList.innerHTML = all.map(function (dict) {
        var checked = selected.indexOf(dict.id) >= 0 ? ' checked' : '';
        return '<label class="dict-check"><input type="checkbox" value="' + K.escapeHtml(dict.id) + '"' + checked + '>' +
          '<span>' + K.escapeHtml(dict.name) + '</span><small>' + dict.words.length + '</small></label>';
      }).join('');
    }
  
    function renderInlineDicts() {
      var custom = K.getCustomDictionaries();
      el.settingsDictList.innerHTML = custom.length
        ? custom.map(function (dict) {
            return '<button class="dict-item' + (dict.id === editingInlineDict ? ' active' : '') + '" type="button" data-id="' + K.escapeHtml(dict.id) + '">' +
              '<span>' + K.escapeHtml(dict.name) + '</span><small>' + dict.words.length + '</small></button>';
          }).join('')
        : '<p class="empty">Своих словарей пока нет.</p>';
      el.settingsDictDelete.disabled = !editingInlineDict;
    }
  
    function renderTools() {
      var canDraw = isDrawer() && !isBannedMe();
      renderToolGrid();
      el.toolRail.classList.toggle('disabled', !canDraw);
      el.toolGrid.querySelectorAll('button').forEach(function (button) {
        button.disabled = !canDraw;
      });
  
      renderKnobs();
      el.pipetteBtn.classList.toggle('active', tool.current === 'pipette');
      var smoothTitle = 'Плавность: ' + (tool.smooth ? 'вкл' : 'выкл');
      el.smoothBtn.title = smoothTitle;
      el.smoothBtn.classList.toggle('active', tool.smooth);
      el.smoothBtn.setAttribute('aria-pressed', tool.smooth ? 'true' : 'false');
      el.smoothBtn.disabled = !canDraw;
  
      el.undo.disabled = !canDraw;
      el.clear.disabled = !canDraw;
  
      applyColorInputs();
      renderPalettes();
  
      if (isBannedMe()) el.status.textContent = 'Вы заблокированы в этой комнате';
      else if (canDraw) el.status.textContent = 'Вы рисуете слово. Остальные угадывают!';
      else el.status.textContent = 'Вы угадываете. Рисунок виден без затемнения!';
      el.sync.textContent = client && client.connected ? 'онлайн-синхронизация' : 'переподключение...';
      el.chatInput.disabled = isBannedMe() || isHitPaused();
      el.chatInput.placeholder = isHitPaused() ? 'Пауза — смотрите анимацию...' : 'Напиши слово...';
  
      el.roomBadge.hidden = !isCreator();
      el.settingsRoomName.textContent = (meta && meta.name) || room;
      el.roundMinInput.disabled = !isCreator();
      el.settingsNote.textContent = isCreator()
        ? 'Вы создатель комнаты: можно менять словари и время раунда.'
        : 'Сменять словари и время может только создатель комнаты.';
      el.dictNote.textContent = isCreator()
        ? 'Изменения начнут действовать со следующего раунда.'
        : 'Словари выбирает создатель комнаты.';
      var currentRoundMs = state && typeof state.roundMs === 'number' ? state.roundMs : DEFAULT_ROUND_MS;
      var minutes = Math.round(currentRoundMs / 60000 * 10) / 10;
      if (document.activeElement !== el.roundMinInput) el.roundMinInput.value = minutes;
      el.disableHintsInput.checked = !!(state && state.hintsDisabled);
      el.disableHintsInput.disabled = !isCreator();
      if (document.activeElement !== el.settingsName) el.settingsName.value = profile.name;
      renderDictChecks();
      renderInlineDicts();
      renderBanList();
    }
  
    function renderTimer() {
      if (!state) return;
      var pausedNow = isHitPaused();
      if (wasHitPaused && !pausedNow) renderTools();
      wasHitPaused = pausedNow;
      if (pausedNow) { el.timer.textContent = 'пауза'; return; }
      if (!state.roundMs) { el.timer.textContent = '∞'; return; }
      if (state.waitingForPlayers) { el.timer.textContent = '0:00 · ждём'; return; }
      var left = Math.max(0, Math.ceil((state.roundMs - (Date.now() - state.startedAt)) / 1000));
      el.timer.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
    }
  
    function renderAll() {
      banned = isBannedMe();
      renderPlayers();
      renderMessages();
      renderWord();
      renderTools();
      renderTimer();
      redrawBase();
      scheduleDrafts();
    }
  
    G.renderPlayers = renderPlayers;
    G.renderBanList = renderBanList;
    G.reactionMarkup = reactionMarkup;
    G.renderMessages = renderMessages;
    G.renderWord = renderWord;
    G.swatchButton = swatchButton;
    G.renderPalettes = renderPalettes;
    G.applyColorInputs = applyColorInputs;
    G.renderToolGrid = renderToolGrid;
    G.renderDictChecks = renderDictChecks;
    G.renderInlineDicts = renderInlineDicts;
    G.renderTools = renderTools;
    G.renderTimer = renderTimer;
    G.renderAll = renderAll;
  }
})(window.KROKO_GAME);
