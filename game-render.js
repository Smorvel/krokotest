/* Room UI rendering. */
(function (G) {
  with (G) {
    /* Меняем DOM только при реальном изменении текста: частый тик таймера не
       должен сбрасывать пользовательское выделение в верхней панели. */
    function setText(node, value) {
      if (!node) return;
      var next = String(value);
      if (node.textContent !== next) node.textContent = next;
    }

    function setHtml(node, value) {
      if (!node || node.dataset.rendered === value) return;
      node.innerHTML = value;
      node.dataset.rendered = value;
    }

    function renderPlayers() {
      var players = presentPlayers();
      setText(el.online, players.length);
      setText(el.playersCount, players.length);
      setHtml(el.players, players.map(function (player) {
        var tag = state && state.drawer === player.id ? 'рисует' : (player.id === myId ? 'вы' : '');
        var ban = isCreator() && player.id !== myId && !isFingerprintBanned(player.fingerprint)
          ? '<button class="ban-btn" type="button" data-ban="' + K.escapeHtml(player.id) + '">бан</button>'
          : '';
        return '<li class="player">' + K.avatarMarkup(player) +
          '<span class="player-name">' + K.escapeHtml(player.name) + '</span>' +
          (tag ? '<span class="player-tag">' + tag + '</span>' : '') + ban + '</li>';
      }).join(''));
    }
  
    function renderBanList() {
      /* Чёрный список — только для создателя комнаты. Обычный игрок не видит
         ни списка, ни кнопок разбана, даже если раньше успел открыть вкладку. */
      if (el.blacklistBlock) el.blacklistBlock.hidden = !isCreator();
      if (!isCreator()) {
        el.banList.innerHTML = '';
        return;
      }
      var records = state && Array.isArray(state.banRecords) ? state.banRecords : [];
      if (!records.length) {
        el.banList.innerHTML = '<p class="ban-empty">Заблокированных игроков нет.</p>';
        return;
      }
      el.banList.innerHTML = records.map(function (record) {
        return '<div class="ban-row"><span>' + K.escapeHtml(record.name || 'Игрок') + '</span>' +
          '<button class="unban-btn" type="button" data-unban="' + K.escapeHtml(record.id) + '">разбанить</button></div>';
      }).join('');
    }
  
    function isOldMessage(message) {
      return !!(message && message.round && state && state.round && Number(message.round) < Number(state.round));
    }

    var systemNoticeNodes = {};
    function renderSystemFeed() {
      if (!el.systemFeed || !state) return;
      var now = Date.now();
      var events = (state.systemEvents || []).filter(function (event) {
        return event && event.text && now - (Number(event.at) || 0) < SYSTEM_NOTICE_MS;
      }).slice(-4);
      var liveIds = {};
      events.forEach(function (event) { liveIds[event.id] = true; });

      /* Не переставляем уже показанные плашки: insertBefore существующего узла
         перезапускает CSS-анимацию и выглядит как мерцание при любом событии
         в комнате. Новые плашки просто добавляются в конец. */
      events.forEach(function (event) {
        var node = systemNoticeNodes[event.id];
        if (!node) {
          node = document.createElement('div');
          node.className = 'system-notice';
          node.dataset.kind = typeof systemNoticeKind === 'function'
            ? systemNoticeKind(event.text) : 'info';
          node.textContent = event.text;
          systemNoticeNodes[event.id] = node;
        }
        if (node.leaveTimer) {
          clearTimeout(node.leaveTimer);
          node.leaveTimer = null;
          node.classList.remove('leaving');
        }
        if (!node.parentNode) el.systemFeed.appendChild(node);
      });

      Object.keys(systemNoticeNodes).forEach(function (id) {
        if (liveIds[id]) return;
        var node = systemNoticeNodes[id];
        if (!node || !node.parentNode || node.classList.contains('leaving')) return;
        node.classList.add('leaving');
        node.leaveTimer = setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
          delete systemNoticeNodes[id];
        }, SYSTEM_NOTICE_EXIT_MS);
      });
    }

    function reactionMarkup(message) {
      if (message.system) return '';
      var value = reactionValue(message.id);
      var canReact = (isDrawer() || isCreator()) && !isBannedMe() && !isOldMessage(message);
      if (!canReact) {
        var info = reactionInfo(message.id);
        return info.value ? reactionIcon(info.value, info.muted) : '';
      }
      return '<span class="reaction-slot">' +
        '<button class="react-btn' + (value === 'like' ? ' active' : '') + '" type="button" data-react="like" data-msg="' + K.escapeHtml(message.id) + '" aria-label="Лайк">' + (ICONS.like || '') + '</button>' +
        '<button class="react-btn' + (value === 'dislike' ? ' active' : '') + '" type="button" data-react="dislike" data-msg="' + K.escapeHtml(message.id) + '" aria-label="Дизлайк">' + (ICONS.dislike || '') + '</button>' +
        '</span>';
    }
  
    function renderMessages(keepScroll) {
      if (!state) return;
      /* Реакция перерисовывает чат, но позиция скролла должна оставаться там же,
         включая быстрый MQTT-echo собственного состояния. */
      keepScroll = !!keepScroll || (Number(G.keepMessagesScrollUntil) || 0) > Date.now();
      var previousTop = el.messages.scrollTop;
      var bannedIds = state.bans || [];
      el.messages.innerHTML = state.messages.filter(function (m) {
        /* Системные события живут отдельной плашкой над чатом. */
        return !m.system && !(m.ownerId && bannedIds.indexOf(m.ownerId) >= 0);
      }).map(function (message) {
        var old = isOldMessage(message);
        var cls = 'message' + (old ? ' old' : '') + (message.hit ? ' hit' : '');
        var body = '<b>' + K.escapeHtml(message.name) + ':</b> ' + K.escapeHtml(message.text);
        return '<div class="' + cls + '">' + reactionMarkup(message) + body + '</div>';
      }).join('');
      /* Сообщения всегда прижаты к низу: новые появляются снизу, старые
         уходят вверх. В узкой раскладке направление скролла может быть
         обратным, поэтому выбираем позицию по фактическому flex-direction. */
      var reverse = getComputedStyle(el.messages).flexDirection === 'column-reverse';
      if (keepScroll) el.messages.scrollTop = previousTop;
      else el.messages.scrollTop = reverse ? 0 : el.messages.scrollHeight;
    }
  
    function renderWord() {
      if (!state) return;
      var players = presentPlayers();
      var drawer = players.filter(function (p) { return p.id === state.drawer; })[0];
      setText(el.drawer, drawer ? drawer.name : '—');
      if (el.drawerAvatar) setHtml(el.drawerAvatar, drawer ? K.avatarMarkup(drawer) : '');
      setText(el.round, state.round);
      setText(el.wordSourceLabel, getDictionary().name);
      setText(el.word, displayCharacters(word()).map(function (item) { return item.char; }).join(''));
    }
  
    function swatchButton(color, className) {
      var active = tool.color.toLowerCase() === color.toLowerCase() ? ' active' : '';
      return '<button class="' + className + active + '" type="button" data-color="' + K.escapeHtml(color) + '" style="background:' + K.escapeHtml(color) + '" title="' + K.escapeHtml(color) + '"></button>';
    }
  
    function renderPalettes() {
      if (el.inkBlobs) el.inkBlobs.innerHTML = PRESET_COLORS.map(function (c) { return swatchButton(c, 'ink-blob '); }).join('');
      if (el.bgSquare) el.bgSquare.style.background = tool.bg;
    }

    function applyColorInputs() {
      if (typeof syncPaletteInputs === 'function') syncPaletteInputs();
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
  
    function renderSync() {
      if (!el.sync) return;
      el.sync.textContent = client && client.connected
        ? 'синхронизация v' + (Number(state && state.canvasSeq) || 0)
        : 'переподключение...';
    }

    function renderTools() {
      var revealing = !!(state && state.reveal);
      var canDraw = isDrawer() && !isBannedMe() && !revealing;
      document.body.classList.toggle('can-draw', canDraw);
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
      else if (revealing) el.status.textContent = 'Раунд завершён. Следующий раунд скоро.';
      else if (canDraw) el.status.textContent = 'Вы рисуете слово. Остальные угадывают!';
      else el.status.textContent = 'Вы угадываете. Рисунок виден без затемнения!';
      renderSync();
      el.chatInput.disabled = isDrawer() || isBannedMe() || isHitPaused() || revealing;
      el.chatInput.placeholder = revealing
        ? 'Раунд завершён — смотрите слово'
        : (isDrawer() ? 'Вы рисуете — чат недоступен' : (isHitPaused() ? 'Пауза — смотрите анимацию...' : 'Напиши слово...'));
  
      el.roomBadge.hidden = !isCreator();
      el.settingsRoomName.textContent = (meta && meta.name) || room;
      el.roundMinInput.disabled = !isCreator();
      var hasPendingTime = !!(state && Number(state.pendingRoundMsAt));
      el.settingsNote.textContent = isCreator()
        ? (hasPendingTime
          ? 'Новое время раунда начнёт действовать со следующего раунда.'
          : 'Вы создатель комнаты: можно менять словари и время раунда.')
        : 'Сменять словари и время может только создатель комнаты.';
      el.dictNote.textContent = isCreator()
        ? 'Изменения начнут действовать со следующего раунда.'
        : 'Словари выбирает создатель комнаты.';
      var currentRoundMs = state && typeof state.roundMs === 'number' ? state.roundMs : DEFAULT_ROUND_MS;
      var shownRoundMs = hasPendingTime ? Number(state.pendingRoundMs) || 0 : currentRoundMs;
      var minutes = Math.round(shownRoundMs / 60000 * 10) / 10;
      if (document.activeElement !== el.roundMinInput) el.roundMinInput.value = minutes;
      el.disableHintsInput.checked = !!(state && state.hintsDisabled);
      el.disableHintsInput.disabled = !isCreator();
      if (el.noDrawInput && document.activeElement !== el.noDrawInput) el.noDrawInput.checked = !!noDraw;
      if (el.soundOffInput && document.activeElement !== el.soundOffInput) el.soundOffInput.checked = !soundEnabled;
      if (el.playPrefsNote) {
        el.playPrefsNote.textContent = soundEnabled
          ? 'Настройки сохраняются в этом браузере. Отказ от рисования действует со следующего раунда; если угадаете слово, вы всё равно станете художником.'
          : 'Звуки выключены в этом браузере. Настройки сохраняются здесь же.';
      }
      if (document.activeElement !== el.settingsName) el.settingsName.value = profile.name;
      renderDictChecks();
      renderInlineDicts();
      renderBanList();
    }
  
    function renderReveal() {
      var reveal = state && (state.reveal || state.lastWord);
      var active = !!reveal && Number(reveal.until) > Date.now();
      if (el.save) el.save.hidden = !active;
      if (!el.wordReveal || !active) {
        if (el.wordReveal) el.wordReveal.hidden = true;
        return;
      }
      if (el.revealReason) el.revealReason.textContent = reveal.reason || 'Раунд завершён';
      if (el.revealWord) el.revealWord.textContent = reveal.word || word();
      if (el.revealNote) {
        el.revealNote.textContent = state && state.reveal
          ? 'Следующий раунд скоро'
          : 'Новый раунд уже начался';
      }
      el.wordReveal.hidden = false;
    }

    function renderTimer() {
      if (!state) { setText(el.timer, '--:--'); return; }
      var pausedNow = isHitPaused() || !!state.reveal;
      if (wasHitPaused && !pausedNow) renderTools();
      wasHitPaused = pausedNow;
      if (!state.roundMs) { setText(el.timer, '∞'); return; }
      if (state.waitingForPlayers && !state.reveal) { setText(el.timer, '0:00 · ждём'); return; }
      var left = Math.ceil(remainingRoundMs() / 1000);
      setText(el.timer, String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0'));
    }
  
    function renderAll() {
      banned = isBannedMe();
      renderPlayers();
      renderMessages();
      renderSystemFeed();
      renderWord();
      renderTools();
      renderReveal();
      renderTimer();
      scheduleBaseRedraw();
      scheduleDrafts();
      if (typeof updateSounds === 'function') updateSounds();
      if (state && client && client.connected && !syncDone && typeof markSynced === 'function') markSynced();
    }
  
    G.renderPlayers = renderPlayers;
    G.renderBanList = renderBanList;
    G.isOldMessage = isOldMessage;
    G.reactionMarkup = reactionMarkup;
    G.renderMessages = renderMessages;
    G.renderSystemFeed = renderSystemFeed;
    G.renderWord = renderWord;
    G.swatchButton = swatchButton;
    G.renderPalettes = renderPalettes;
    G.applyColorInputs = applyColorInputs;
    G.renderToolGrid = renderToolGrid;
    G.renderDictChecks = renderDictChecks;
    G.renderInlineDicts = renderInlineDicts;
    G.renderSync = renderSync;
    G.renderTools = renderTools;
    G.renderReveal = renderReveal;
    G.renderTimer = renderTimer;
    G.renderAll = renderAll;
  }
})(window.KROKO_GAME);
