/* Личный кабинет: имя, свои словари и созданные комнаты. */
(function () {
  'use strict';

  var K = window.KROKO;
  if (!K) return;

  var profile = K.getProfile();
  var editingId = null;

  var profileForm = document.getElementById('profileForm');
  var profileName = document.getElementById('profileName');
  var profileSaved = document.getElementById('profileSaved');
  var dictList = document.getElementById('dictList');
  var dictForm = document.getElementById('dictForm');
  var dictName = document.getElementById('dictName');
  var dictWords = document.getElementById('dictWords');
  var dictDelete = document.getElementById('dictDelete');
  var dictNew = document.getElementById('dictNew');
  var myRooms = document.getElementById('myRooms');

  function renderRooms() {
    var rooms = K.getRooms();
    myRooms.innerHTML = rooms.length
      ? rooms.map(function (room) {
          return '<div class="my-room"><span>' + K.escapeHtml(room.name) + '</span>' +
            '<a href="game.html?room=' + encodeURIComponent(room.slug) + '">Открыть →</a></div>';
        }).join('')
      : '<p class="empty">Вы ещё не создавали комнату. Это можно сделать на главной странице.</p>';
  }

  function renderDicts() {
    var custom = K.getCustomDictionaries();
    dictList.innerHTML = custom.length
      ? custom.map(function (dict) {
          return '<button class="dict-item' + (dict.id === editingId ? ' active' : '') + '" type="button" data-id="' + K.escapeHtml(dict.id) + '">' +
            '<span>' + K.escapeHtml(dict.name) + '</span><small>' + dict.words.length + ' слов</small></button>';
        }).join('')
      : '<p class="empty">Своих словарей пока нет. Заполните форму справа.</p>';

    dictDelete.disabled = !editingId;
  }

  function selectDict(id) {
    var dict = null;
    K.getCustomDictionaries().forEach(function (d) { if (d.id === id) dict = d; });
    editingId = dict ? dict.id : null;
    dictName.value = dict ? dict.name : '';
    dictWords.value = dict ? dict.words.join('\n') : '';
    renderDicts();
  }

  profileName.value = profile.name;
  profileForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var name = profileName.value.trim();
    if (!name) return;
    profile.name = name;
    profile.color = K.colorFor(name);
    K.setProfile(profile);
    profileSaved.hidden = false;
    setTimeout(function () { profileSaved.hidden = true; }, 2200);
  });

  dictList.addEventListener('click', function (event) {
    var item = event.target.closest('.dict-item');
    if (item) selectDict(item.dataset.id);
  });

  dictForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var name = dictName.value.trim();
    var words = K.wordsFromText(dictWords.value);
    if (!name || !words.length) return;

    var list = K.getCustomDictionaries();
    var existing = null;
    list.forEach(function (d) { if (d.id === editingId) existing = d; });
    if (existing) {
      existing.name = name;
      existing.words = words;
    } else {
      existing = { id: 'custom-' + K.uid(), name: name, words: words, createdAt: Date.now() };
      list.push(existing);
    }
    K.saveCustomDictionaries(list);
    selectDict(existing.id);
  });

  dictDelete.addEventListener('click', function () {
    if (!editingId) return;
    var list = K.getCustomDictionaries().filter(function (d) { return d.id !== editingId; });
    K.saveCustomDictionaries(list);
    selectDict(null);
  });

  dictNew.addEventListener('click', function () { selectDict(null); });

  renderRooms();
  renderDicts();
})();
