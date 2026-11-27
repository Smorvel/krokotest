/* Internal color palette plugin: compact HSV picker and HEX, no native dialog. */
(function (G) {
  with (G) {
    var paletteMode = 'ink';
    var paletteHsv = { h: 210, s: 0.75, v: 0.4 };
    var svDragging = false;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function normalizeHex(color) {
      var value = String(color || '').trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{3}$/.test(value)) {
        value = value.split('').map(function (c) { return c + c; }).join('');
      }
      return /^[0-9a-fA-F]{6}$/.test(value) ? '#' + value.toLowerCase() : '';
    }

    function hexToRgbValue(color) {
      var value = normalizeHex(color) || '#000000';
      var num = parseInt(value.slice(1), 16);
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }

    function rgbToHexValue(r, g, b) {
      return '#' + [r, g, b].map(function (v) {
        return ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2);
      }).join('');
    }

    function rgbToHsv(color) {
      var rgb = hexToRgbValue(color);
      var r = rgb[0] / 255;
      var g = rgb[1] / 255;
      var b = rgb[2] / 255;
      var max = Math.max(r, g, b);
      var min = Math.min(r, g, b);
      var delta = max - min;
      var hue = 0;
      if (delta) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
      }
      if (hue < 0) hue += 360;
      return { h: hue, s: max ? delta / max : 0, v: max };
    }

    function hsvToHex(hue, sat, val) {
      var h = ((Number(hue) || 0) % 360 + 360) % 360;
      var s = clamp(Number(sat) || 0, 0, 1);
      var v = clamp(Number(val) || 0, 0, 1);
      var c = v * s;
      var x = c * (1 - Math.abs((h / 60) % 2 - 1));
      var m = v - c;
      var parts = [
        [c, x, 0], [x, c, 0], [0, c, x],
        [0, x, c], [x, 0, c], [c, 0, x]
      ][Math.floor(h / 60) % 6];
      return rgbToHexValue((parts[0] + m) * 255, (parts[1] + m) * 255, (parts[2] + m) * 255);
    }

    function currentColor() {
      return (paletteMode === 'bg' ? tool.bg : tool.color) || '#111827';
    }

    function setInk(color) {
      var value = normalizeHex(color);
      if (!value) return false;
      var wasEraser = tool.current === 'eraser';
      tool.color = value;
      profile.inkColor = value;
      K.setProfile(profile);
      applyColorInputs();
      renderKnobs();
      renderPalettes();
      syncPaletteInputs();
      if (wasEraser) {
        /* Выбор цвета всегда возвращает к последней обычной кисти. */
        var next = previousTool && previousTool !== 'eraser' && previousTool !== 'pipette'
          ? previousTool
          : 'brush';
        tool.current = next;
        renderTools();
        refreshCursor();
      }
      return true;
    }

    function setBg(color, quiet) {
      var value = normalizeHex(color);
      if (!value) return false;
      tool.bg = value;
      profile.bgColor = value;
      K.setProfile(profile);
      applyColorInputs();
      if (state && isDrawer()) {
        state.bg = value;
        if (!quiet) publishState();
      }
      scheduleBaseRedraw();
      renderPalettes();
      syncPaletteInputs();
      return true;
    }

    function applyPaletteColor(color, quiet) {
      return paletteMode === 'bg' ? setBg(color, quiet) : setInk(color);
    }

    function syncPaletteInputs() {
      if (!el.palettePopover || !el.paletteHue || !el.paletteSv) return;
      var color = currentColor();
      paletteHsv = rgbToHsv(color);
      el.paletteTitle.textContent = paletteMode === 'bg' ? 'Цвет фона' : 'Цвет кисти';
      el.paletteCurrent.style.background = color;
      el.paletteCurrent.textContent = color.toUpperCase();
      el.paletteHex.value = color;
      el.paletteHue.value = Math.round(paletteHsv.h);
      el.paletteSv.style.setProperty('--palette-hue', String(paletteHsv.h));
      el.paletteSvHandle.style.left = (paletteHsv.s * 100).toFixed(2) + '%';
      el.paletteSvHandle.style.top = ((1 - paletteHsv.v) * 100).toFixed(2) + '%';
    }

    function openPalettePopover(anchor, mode) {
      if (sessionKicked || !anchor || !el.palettePopover) return;
      paletteMode = mode === 'bg' ? 'bg' : 'ink';
      syncPaletteInputs();
      el.palettePopover.hidden = false;
      var rect = anchor.getBoundingClientRect();
      var popoverWidth = 240;
      var popoverHeight = 300;
      el.palettePopover.style.left = clamp(rect.right + 10, 8, Math.max(8, window.innerWidth - popoverWidth - 8)) + 'px';
      el.palettePopover.style.top = clamp(rect.top, 8, Math.max(8, window.innerHeight - popoverHeight - 8)) + 'px';
    }

    function closePalettePopover() {
      if (!el.palettePopover) return;
      el.palettePopover.hidden = true;
      svDragging = false;
    }

    function updateSvFromEvent(event) {
      var rect = el.paletteSv.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      paletteHsv.s = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      paletteHsv.v = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
      el.paletteSvHandle.style.left = (paletteHsv.s * 100).toFixed(2) + '%';
      el.paletteSvHandle.style.top = ((1 - paletteHsv.v) * 100).toFixed(2) + '%';
      applyPaletteColor(hsvToHex(paletteHsv.h, paletteHsv.s, paletteHsv.v), true);
    }

    el.palettePopoverClose.addEventListener('click', closePalettePopover);

    el.paletteSv.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      svDragging = true;
      try { el.paletteSv.setPointerCapture(event.pointerId); } catch (err) { /* синтетические события */ }
      updateSvFromEvent(event);
    });
    el.paletteSv.addEventListener('pointermove', function (event) {
      if (svDragging) updateSvFromEvent(event);
    });
    el.paletteSv.addEventListener('pointerup', function () {
      if (!svDragging) return;
      svDragging = false;
      K.setProfile(profile);
      if (paletteMode === 'bg' && state && isDrawer()) publishState();
    });
    el.paletteSv.addEventListener('pointercancel', function () { svDragging = false; });

    el.paletteHue.addEventListener('input', function () {
      paletteHsv.h = Number(el.paletteHue.value) || 0;
      el.paletteSv.style.setProperty('--palette-hue', String(paletteHsv.h));
      applyPaletteColor(hsvToHex(paletteHsv.h, paletteHsv.s, paletteHsv.v), true);
    });
    el.paletteHue.addEventListener('change', function () {
      K.setProfile(profile);
      if (paletteMode === 'bg' && state && isDrawer()) publishState();
    });

    el.paletteHex.addEventListener('change', function () {
      if (!applyPaletteColor(el.paletteHex.value)) el.paletteHex.value = currentColor();
    });

    el.bgSquare.addEventListener('click', function () { openPalettePopover(el.bgSquare, 'bg'); });

    document.addEventListener('pointerdown', function (event) {
      if (el.palettePopover.hidden) return;
      if (el.palettePopover.contains(event.target)) return;
      if (event.target === el.sizeKnob || el.sizeKnob.contains(event.target)) return;
      if (event.target === el.bgSquare || el.bgSquare.contains(event.target)) return;
      closePalettePopover();
    });

    syncPaletteInputs();

    G.setInk = setInk;
    G.setBg = setBg;
    G.applyPaletteColor = applyPaletteColor;
    G.syncPaletteInputs = syncPaletteInputs;
    G.openPalettePopover = openPalettePopover;
    G.closePalettePopover = closePalettePopover;
  }
})(window.KROKO_GAME);
