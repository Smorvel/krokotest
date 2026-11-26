/* Brush knobs, palette and tool controls. */
(function (G) {
  with (G) {
    /* Кружки размера и прозрачности */
  
    function renderKnobs() {
      var scale = (tool.size - 2) / (64 - 2);
      var dot = Math.round(6 + Math.max(0, Math.min(1, scale)) * 20);
      el.sizeKnob.style.setProperty('--knob-size', dot + 'px');
      el.sizeKnob.style.setProperty('--knob-fill', tool.color);
      el.alphaKnob.style.setProperty('--knob-fill', tool.color);
      el.alphaKnob.style.setProperty('--knob-alpha', (tool.alpha / 100).toFixed(2));
      el.sizeKnob.title = 'Размер: ' + tool.size + ' пикселей. Тяните вверх или вниз, клик — палитра.';
      el.alphaKnob.title = 'Прозрачность: ' + tool.alpha + '%. Тяните вверх или вниз, клик — палитра.';
    }
  
    function setKnobValue(kind, value) {
      var min = kind === 'size' ? 2 : 5;
      var max = kind === 'size' ? 64 : 100;
      var next = Math.max(min, Math.min(max, Math.round(value)));
      if (kind === 'size') {
        tool.size = next;
        profile.brushSize = next;
      } else {
        tool.alpha = next;
        profile.brushAlpha = next;
      }
      renderKnobs();
      return next;
    }
  
    function beginKnobDrag(event, kind) {
      if (event.button !== 0) return;
      event.preventDefault();
      knobDrag = {
        kind: kind,
        startY: event.clientY,
        startValue: kind === 'size' ? tool.size : tool.alpha,
        sensitivity: kind === 'size' ? 0.5 : 1,
        moved: false,
        button: event.currentTarget
      };
      knobDrag.button.classList.add('dragging');
      try { knobDrag.button.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
  
    document.addEventListener('pointermove', function (event) {
      if (!knobDrag) return;
      var delta = knobDrag.startY - event.clientY;
      if (Math.abs(delta) > 3) knobDrag.moved = true;
      if (knobDrag.moved) setKnobValue(knobDrag.kind, knobDrag.startValue + delta * knobDrag.sensitivity);
    });
  
    document.addEventListener('pointerup', function () {
      if (!knobDrag) return;
      var drag = knobDrag;
      knobDrag = null;
      drag.button.classList.remove('dragging');
      K.setProfile(profile);
      if (!drag.moved) openPalettePopover(drag.button);
    });
  
    function openPalettePopover(anchor) {
      var rect = anchor.getBoundingClientRect();
      el.popoverColorInput.value = tool.color;
      el.popoverHexInput.value = tool.color;
      el.palettePopover.hidden = false;
      el.palettePopover.style.left = Math.min(window.innerWidth - 270, rect.right + 10) + 'px';
      el.palettePopover.style.top = Math.min(window.innerHeight - 300, rect.top) + 'px';
    }
  
    function closePalettePopover() {
      el.palettePopover.hidden = true;
    }
  
    el.sizeKnob.addEventListener('pointerdown', function (event) { beginKnobDrag(event, 'size'); });
    el.alphaKnob.addEventListener('pointerdown', function (event) { beginKnobDrag(event, 'alpha'); });
    el.palettePopoverClose.addEventListener('click', closePalettePopover);
    el.popoverColorInput.addEventListener('input', function () { setInk(el.popoverColorInput.value); });
    el.popoverHexInput.addEventListener('change', function () {
      setInk(el.popoverHexInput.value);
      el.popoverHexInput.value = tool.color;
    });
    document.addEventListener('pointerdown', function (event) {
      if (el.palettePopover.hidden) return;
      if (el.palettePopover.contains(event.target) || event.target === el.sizeKnob || event.target === el.alphaKnob) return;
      closePalettePopover();
    });
  
    /* Панель инструментов и цвета */
  
    function renderToolsOnce() {
      renderToolGrid();
      applyColorInputs();
    }
  
    el.toolGrid.addEventListener('click', function (event) {
      var btn = event.target.closest('.tool-btn[data-tool]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.tool === 'shape' && tool.current === 'shape') {
        var modes = ['square', 'circle', 'stripe'];
        tool.shapeMode = modes[(modes.indexOf(tool.shapeMode) + 1) % modes.length];
        profile.shapeMode = tool.shapeMode;
        K.setProfile(profile);
      } else {
        tool.current = btn.dataset.tool;
        if (tool.current !== 'pipette') previousTool = tool.current;
      }
      renderTools();
      refreshCursor();
    });
  
    function rememberColor(color) {
      var colors = profile.recentColors || [];
      colors = [color].concat(colors.filter(function (c) { return c !== color; })).slice(0, 9);
      profile.recentColors = colors;
      K.setProfile(profile);
      renderPalettes();
    }
  
    function setInk(color) {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
      tool.color = color.toLowerCase();
      profile.inkColor = tool.color;
      rememberColor(tool.color);
      applyColorInputs();
      renderKnobs();
    }
  
    function setBg(color) {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
      tool.bg = color.toLowerCase();
      profile.bgColor = tool.bg;
      K.setProfile(profile);
      applyColorInputs();
      if (state && isDrawer()) { state.bg = tool.bg; publishState(); }
      redrawBase();
      renderPalettes();
    }
  
    document.addEventListener('click', function (event) {
      var swatch = event.target.closest('[data-color]');
      if (swatch && !swatch.disabled) setInk(swatch.dataset.color);
    });
  
    [].forEach.call(el.inkColorInputs, function (input) { input.addEventListener('input', function () { setInk(input.value); }); });
    [].forEach.call(el.inkHexInputs, function (input) { input.addEventListener('change', function () { setInk(input.value); applyColorInputs(); }); });
    [].forEach.call(el.bgColorInputs, function (input) { input.addEventListener('input', function () { setBg(input.value); }); });
    [].forEach.call(el.bgHexInputs, function (input) { input.addEventListener('change', function () { setBg(input.value); applyColorInputs(); }); });
  
    el.bgSquare.addEventListener('click', function () {
      el.colorEditor.hidden = !el.colorEditor.hidden;
      if (!el.colorEditor.hidden && el.bgColorInputs.length) el.bgColorInputs[0].focus();
    });
    el.colorEditorBtn.addEventListener('click', function () { el.colorEditor.hidden = !el.colorEditor.hidden; });
  
    el.pipetteBtn.addEventListener('click', function () {
      if (tool.current !== 'pipette') previousTool = tool.current;
      tool.current = 'pipette';
      renderTools();
      refreshCursor();
    });
  
    el.smoothBtn.addEventListener('click', function () {
      tool.smooth = !tool.smooth;
      profile.smoothing = tool.smooth;
      K.setProfile(profile);
      renderTools();
      refreshCursor();
    });
  
    el.undo.addEventListener('click', function () {
      if (!state || !isDrawer()) return;
      for (var i = state.strokes.length - 1; i >= 0; i--) {
        if (state.strokes[i].owner === myId) { state.strokes.splice(i, 1); break; }
      }
      publishState();
      redrawBase();
    });
  
    el.clear.addEventListener('click', function () {
      if (!state || !isDrawer()) return;
      state.strokes = [];
      localDraft = null;
      remoteDrafts = {};
      publishDraft(null);
      publishState();
      redrawBase();
      scheduleDrafts();
    });
  
    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        el.undo.click();
      }
    });
    G.renderKnobs = renderKnobs;
    G.setKnobValue = setKnobValue;
    G.beginKnobDrag = beginKnobDrag;
    G.openPalettePopover = openPalettePopover;
    G.closePalettePopover = closePalettePopover;
    G.renderToolsOnce = renderToolsOnce;
    G.rememberColor = rememberColor;
    G.setInk = setInk;
    G.setBg = setBg;
  }
})(window.KROKO_GAME);
