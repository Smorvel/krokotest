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
      el.sizeKnob.title = 'Размер: ' + tool.size + ' пикселей. Тяните вверх или вниз, клик — палитра цвета.';
      el.alphaKnob.title = 'Прозрачность: ' + tool.alpha + '%. Тяните вверх или вниз.';
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
      if (!drag.moved && drag.kind === 'size') openPalettePopover(drag.button);
    });
  
    function hslToHex(hue, sat, light) {
      var s = sat, l = light;
      var c = (1 - Math.abs(2 * l - 1)) * s;
      var x = c * (1 - Math.abs((hue / 60) % 2 - 1));
      var m = l - c / 2;
      var rgb = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] :
        hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
      return '#' + rgb.map(function (v) {
        return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2);
      }).join('');
    }

    function paletteColors() {
      var colors = ['#111827', '#ffffff', '#9ca3af', '#6b7280', '#374151', '#000000'];
      [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].forEach(function (hue) {
        [0.92, 0.72, 0.52, 0.32].forEach(function (light) {
          colors.push(hslToHex(hue, 0.78, light));
        });
      });
      return colors;
    }

    function renderPaletteGrid() {
      el.paletteGrid.innerHTML = paletteColors().map(function (color) {
        return '<button class="palette-swatch" type="button" data-color="' + color + '" style="background:' + color + '" title="' + color + '" aria-label="' + color + '"></button>';
      }).join('');
    }

    function syncPaletteInputs() {
      el.popoverSwatch.style.background = tool.color;
      el.paletteNativeInput.value = tool.color;
      el.popoverHexInput.value = tool.color;
    }

    function setInlinePalette(open) {
      el.paletteGrid.hidden = !open;
      el.paletteNativeWrap.hidden = !open;
      el.popoverColorInput.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function openPalettePopover(anchor) {
      var rect = anchor.getBoundingClientRect();
      syncPaletteInputs();
      setInlinePalette(false);
      el.palettePopover.hidden = false;
      el.palettePopover.style.left = Math.min(window.innerWidth - 270, rect.right + 10) + 'px';
      el.palettePopover.style.top = Math.max(8, Math.min(window.innerHeight - 260, rect.top)) + 'px';
    }

    function closePalettePopover() {
      el.palettePopover.hidden = true;
      setInlinePalette(false);
    }

    el.sizeKnob.addEventListener('pointerdown', function (event) { beginKnobDrag(event, 'size'); });
    el.alphaKnob.addEventListener('pointerdown', function (event) { beginKnobDrag(event, 'alpha'); });
    el.palettePopoverClose.addEventListener('click', closePalettePopover);
    el.popoverColorInput.addEventListener('click', function () {
      setInlinePalette(el.paletteGrid.hidden);
    });
    el.paletteGrid.addEventListener('click', function (event) {
      var swatch = event.target.closest('.palette-swatch');
      if (!swatch) return;
      setInk(swatch.dataset.color);
      setInlinePalette(false);
    });
    el.paletteNativeInput.addEventListener('input', function () { setInk(el.paletteNativeInput.value); });
    el.popoverHexInput.addEventListener('change', function () {
      setInk(el.popoverHexInput.value);
      el.popoverHexInput.value = tool.color;
    });
    document.addEventListener('pointerdown', function (event) {
      if (el.palettePopover.hidden) return;
      if (el.palettePopover.contains(event.target) || event.target === el.sizeKnob) return;
      closePalettePopover();
    });
    renderPaletteGrid();
  
    /* Панель инструментов и цвета */
  
    function renderRailIcons() {
      el.pipetteBtn.innerHTML = ICONS.pipette || '';
      el.smoothBtn.innerHTML = ICONS.smooth || '';
      el.undo.innerHTML = ICONS.undo || '';
      el.clear.innerHTML = ICONS.clear || '';
    }

    function renderToolsOnce() {
      renderRailIcons();
      renderToolGrid();
      applyColorInputs();
      syncPaletteInputs();
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
      syncPaletteInputs();
    }
  
    function setBg(color) {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
      tool.bg = color.toLowerCase();
      profile.bgColor = tool.bg;
      K.setProfile(profile);
      applyColorInputs();
      if (state && isDrawer()) { state.bg = tool.bg; publishState(); }
      scheduleBaseRedraw();
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
      scheduleBaseRedraw();
    });
  
    el.clear.addEventListener('click', function () {
      if (!state || !isDrawer()) return;
      state.strokes = [];
      localDraft = null;
      remoteDrafts = {};
      publishDraft(null);
      publishState();
      scheduleBaseRedraw();
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
    G.renderRailIcons = renderRailIcons;
    G.rememberColor = rememberColor;
    G.setInk = setInk;
    G.setBg = setBg;
  }
})(window.KROKO_GAME);
