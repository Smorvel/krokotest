/* Dictionaries, phrases and round words. */
(function (G) {
  with (G) {
    /* ---------- Словари и фразы ---------- */
  
    function fallbackDictionary() {
      return K.BUILTIN_DICTIONARIES[0];
    }
  
    function getDictionary() {
      if (state && state.dictionary && Array.isArray(state.dictionary.words) && state.dictionary.words.length) return state.dictionary;
      if (meta && meta.dictionary && Array.isArray(meta.dictionary.words) && meta.dictionary.words.length) return meta.dictionary;
      return fallbackDictionary();
    }
  
    function word() {
      var words = getDictionary().words;
      var index = ((state && state.wordIndex) || 0) % words.length;
      return words[index];
    }
  
    function normToken(token) {
      return String(token || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/gi, '');
    }
  
    function normPhrase(text) {
      return phraseWords(text).join(' ');
    }
  
    function phraseWords(text) {
      return String(text || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]+/gi) || [];
    }
  
    function phraseTargets() {
      var seen = {};
      var result = [];
      phraseWords(word()).forEach(function (token) {
        if (!token || seen[token]) return;
        seen[token] = true;
        result.push({ key: token, display: token });
      });
      return result;
    }
  
    function maskPhrase(text) {
      return displayCharacters(text, true).map(function (item) { return item.char; }).join('');
    }
  
    function displayCharacters(text, forceGuesser) {
      var guessed = {};
      (state && state.guessedWords || []).forEach(function (key) { guessed[key] = true; });
      var drawerView = !forceGuesser && isDrawer();
      var hintDue = !!(state && !state.hintsDisabled && state.roundMs > 0 &&
        Date.now() - state.startedAt >= state.roundMs * 0.9);
      var hintLeft = hintDue && !drawerView;
      var parts = String(text || '').split(/(\s+)/);
      var result = [];
      parts.forEach(function (part) {
        if (!part.trim()) {
          result.push({ char: part, space: true });
          return;
        }
        var key = normToken(part);
        var revealAll = drawerView || (key && guessed[key]);
        for (var i = 0; i < part.length; i++) {
          var ch = part.charAt(i);
          var isLetter = /[a-zа-яё0-9]/i.test(ch);
          if (!isLetter) {
            result.push({ char: ch, plain: true });
          } else if (revealAll || hintLeft) {
            if (hintLeft && !revealAll) hintLeft = false;
            result.push({ char: ch, revealed: true });
          } else {
            result.push({ char: '•', masked: true });
          }
        }
      });
      return result;
    }
  
    function reactionValue(id) {
      var reaction = state && state.reactions && state.reactions[id];
      if (!reaction) return '';
      if (reaction.value === 'like' || reaction.value === 'dislike') return reaction.value;
      if (Array.isArray(reaction.likes) && reaction.likes.length) return 'like';
      if (Array.isArray(reaction.dislikes) && reaction.dislikes.length) return 'dislike';
      return '';
    }
  
    function reactionInfo(id) {
      var reaction = state && state.reactions && state.reactions[id];
      if (!reaction) return { value: '', muted: false };
      if (reaction.value === 'like' || reaction.value === 'dislike') {
        return { value: reaction.value, muted: false };
      }
      var previous = reaction.lastValue === 'like' || reaction.lastValue === 'dislike'
        ? reaction.lastValue
        : (Array.isArray(reaction.likes) && reaction.likes.length
          ? 'like'
          : (Array.isArray(reaction.dislikes) && reaction.dislikes.length ? 'dislike' : ''));
      return { value: previous, muted: !!previous };
    }

    function reactionIcon(value, muted) {
      if (value !== 'like' && value !== 'dislike') return '';
      var icon = value === 'like' ? ICONS.like : ICONS.dislike;
      var label = value === 'like' ? 'Лайк' : 'Дизлайк';
      return '<span class="react-mark ' + value + (muted ? ' muted' : '') +
        '" aria-label="' + label + (muted ? ' (снято)' : '') + '">' + (icon || '') + '</span>';
    }
  
    function selectedDictionaryIds() {
      if (state && Array.isArray(state.dictionaryIds) && state.dictionaryIds.length) return state.dictionaryIds.slice();
      if (meta && Array.isArray(meta.dictionaryIds) && meta.dictionaryIds.length) return meta.dictionaryIds.slice();
      return [getDictionary().id];
    }
  
    function dictionariesByIds(ids) {
      var result = [];
      ids.forEach(function (id) {
        var dict = K.findDictionary(id);
        if (dict && dict.id === id && Array.isArray(dict.words) && dict.words.length && !result.some(function (d) { return d.id === dict.id; })) {
          result.push(dict);
        }
      });
      return result.length ? result : [fallbackDictionary()];
    }
  
    function availableDictionaries() {
      var source = null;
      if (state && Array.isArray(state.dictionaryPool) && state.dictionaryPool.length) source = state.dictionaryPool;
      else if (meta && Array.isArray(meta.dictionaryPool) && meta.dictionaryPool.length) source = meta.dictionaryPool;
      if (source) {
        var pool = source.filter(function (dict) {
          return dict && dict.id && dict.name && Array.isArray(dict.words) && dict.words.length;
        }).map(function (dict) {
          return { id: dict.id, name: dict.name, words: dict.words.slice(0, K.MAX_DICTIONARY_WORDS) };
        });
        if (pool.length) return pool;
      }
      return dictionariesByIds(selectedDictionaryIds());
    }
  
    function chooseNextWord() {
      if (!state) return;
      var dicts = availableDictionaries();
      var history = Array.isArray(state.wordHistory) ? state.wordHistory.slice() : [];
      var current = normPhrase(word());
      var pool = [];
      var all = [];
  
      dicts.forEach(function (dict) {
        dict.words.slice(0, K.MAX_DICTIONARY_WORDS).forEach(function (phrase, index) {
          var full = normPhrase(phrase);
          if (!full) return;
          var item = { dict: dict, index: index, full: full };
          all.push(item);
          if (full !== current && history.indexOf(full) < 0) pool.push(item);
        });
      });
  
      var choices = pool.length ? pool : (all.length ? all : [{ dict: fallbackDictionary(), index: 0, full: normPhrase(fallbackDictionary().words[0]) }]);
      var pick = choices[Math.floor(Math.random() * choices.length)];
      state.dictionary = { id: pick.dict.id, name: pick.dict.name, words: pick.dict.words.slice(0, K.MAX_DICTIONARY_WORDS) };
      state.wordIndex = pick.index;
      state.wordHistory = history.concat(pick.full).slice(-HISTORY_LIMIT);
      state.guessedWords = [];
      state.hintSent = false;
    }
  
    /* ---------- Бан: ID + отпечаток браузера ---------- */
  
    G.fallbackDictionary = fallbackDictionary;
    G.getDictionary = getDictionary;
    G.word = word;
    G.normToken = normToken;
    G.normPhrase = normPhrase;
    G.phraseWords = phraseWords;
    G.phraseTargets = phraseTargets;
    G.maskPhrase = maskPhrase;
    G.displayCharacters = displayCharacters;
    G.reactionValue = reactionValue;
    G.reactionInfo = reactionInfo;
    G.reactionIcon = reactionIcon;
    G.selectedDictionaryIds = selectedDictionaryIds;
    G.dictionariesByIds = dictionariesByIds;
    G.availableDictionaries = availableDictionaries;
    G.chooseNextWord = chooseNextWord;
  }
})(window.KROKO_GAME);
