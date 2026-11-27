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
      el.sizeCaption.textContent = tool.size + 'px';
      el.alphaCaption.textContent = tool.alpha + '%';
      el.sizeKnob.title = 'Размер: ' + tool.size + ' пикселей. Тяните вверх или вниз, клик — палитра цвета.';
      el.alphaKnob.title = 'Прозрачность: ' + tool.alpha + '%. Тяните вверх или вниз, клик — 100%.';
      syncPopoverSliders();
    }

    function syncPopoverSliders() {
      if (!el.popoverSize || !el.popoverAlpha) return;
      el.popoverSize.value = tool.size;
      el.popoverSizeValue.textContent = tool.size + 'px';
      el.popoverAlpha.value = tool.alpha;
      el.popoverAlphaValue.textContent = tool.alpha + '%';
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
      if (!drag.moved) {
        if (drag.kind === 'size') openPalettePopover(drag.button, 'ink');
        else if (drag.kind === 'alpha') {
          setKnobValue('alpha', 100);
          K.setProfile(profile);
        }
      }
    });
  
    el.sizeKnob.addEventListener('pointerdown', function (event) { beginKnobDrag(event, 'size'); });
    el.alphaKnob.addEventListener('pointerdown', function (event) { beginKnobDrag(event, 'alpha'); });

    /* Горизонтальные ползунки в верхней части палитры. Старый способ —
       нажать на кружок и тянуть вверх/вниз — остаётся без изменений. */
    if (el.popoverSize) {
      el.popoverSize.addEventListener('input', function () {
        setKnobValue('size', Number(this.value));
        refreshCursor();
      });
      el.popoverSize.addEventListener('change', function () { K.setProfile(profile); });
    }
    if (el.popoverAlpha) {
      el.popoverAlpha.addEventListener('input', function () {
        setKnobValue('alpha', Number(this.value));
        refreshCursor();
      });
      el.popoverAlpha.addEventListener('change', function () { K.setProfile(profile); });
    }

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
      syncPopoverSliders();
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
        var previous = tool.current;
        tool.current = btn.dataset.tool;
        if (tool.current === 'eraser') {
          if (previous !== 'eraser') previousTool = previous;
        } else if (tool.current !== 'pipette') {
          previousTool = tool.current;
        }
      }
      renderTools();
      refreshCursor();
    });
  
    document.addEventListener('click', function (event) {
      var swatch = event.target.closest('#inkBlobs [data-color]');
      if (swatch && !swatch.disabled) setInk(swatch.dataset.color);
    });
  
    el.pipetteBtn.addEventListener('click', function () {
      if (tool.current !== 'pipette') {
        previousTool = tool.current === 'eraser'
          ? (previousTool && previousTool !== 'eraser' ? previousTool : 'brush')
          : tool.current;
      }
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
  
    function undoStroke() {
      if (!state || !isDrawer() || isHitPaused() || state.reveal || state.lastWord) return;
      for (var i = state.strokes.length - 1; i >= 0; i--) {
        if (state.strokes[i].owner === myId) {
          var id = state.strokes[i].id;
          state.canvasSeq = (Number(state.canvasSeq) || 0) + 1;
          publishStrokeDeletion(id, state.canvasSeq);
          state.strokes.splice(i, 1);
          publishCanvasSnapshot();
          publishState();
          scheduleBaseRedraw();
          return;
        }
      }
    }

    el.undo.addEventListener('click', undoStroke);
  
    el.clear.addEventListener('click', function () {
      if (!state || !isDrawer()) return;
      state.canvasSeq = (Number(state.canvasSeq) || 0) + 1;
      state.strokes.forEach(function (stroke) { publishStrokeDeletion(stroke.id, state.canvasSeq); });
      state.strokes = [];
      localDraft = null;
      remoteDrafts = {};
      publishDraft(null, true);
      publishCanvasSnapshot();
      publishState();
      scheduleBaseRedraw();
      scheduleDrafts();
    });
  
    if (el.save) el.save.addEventListener('click', function () { saveCanvasPng(); });

    document.addEventListener('keydown', function (event) {
      if (sessionKicked) return;
      var key = String(event.key || '').toLowerCase();
      var command = event.ctrlKey || event.metaKey;
      if (command && (key === 'z' || event.code === 'KeyZ')) {
        event.preventDefault();
        undoStroke();
      } else if (command && (key === 's' || event.code === 'KeyS')) {
        event.preventDefault();
        if (el.save && !el.save.hidden) saveCanvasPng();
      }
    });
    G.renderKnobs = renderKnobs;
    G.setKnobValue = setKnobValue;
    G.beginKnobDrag = beginKnobDrag;
    G.renderToolsOnce = renderToolsOnce;
    G.renderRailIcons = renderRailIcons;
    G.undoStroke = undoStroke;
  }
})(window.KROKO_GAME);
