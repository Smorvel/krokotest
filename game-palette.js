/* Internal color palette plugin: custom picker, presets and HEX, no native dialog. */
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

    function hslToHex(hue, sat, light) {
      var s = clamp(Number(sat) || 0, 0, 1);
      var l = clamp(Number(light) || 0, 0, 1);
      var c = (1 - Math.abs(2 * l - 1)) * s;
      var x = c * (1 - Math.abs(((Number(hue) || 0) / 60) % 2 - 1));
      var m = l - c / 2;
      var h = ((Number(hue) || 0) % 360 + 360) % 360;
      var parts = [
        [c, x, 0], [x, c, 0], [0, c, x],
        [0, x, c], [x, 0, c], [c, 0, x]
      ][Math.floor(h / 60) % 6];
      return rgbToHexValue((parts[0] + m) * 255, (parts[1] + m) * 255, (parts[2] + m) * 255);
    }

    function paletteColors() {
      var colors = ['#111827', '#ffffff', '#252932', '#9ca3af', '#6b7280', '#000000'];
      [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].forEach(function (hue) {
        [0.92, 0.72, 0.52, 0.32].forEach(function (light) {
          colors.push(hslToHex(hue, 0.78, light));
        });
      });
      return colors;
    }

    function swatchMarkup(color, className) {
      var active = color.toLowerCase() === currentColor().toLowerCase() ? ' active' : '';
      return '<button class="' + className + active + '" type="button" data-color="' + color + '" style="background:' + color + '" title="' + color + '" aria-label="' + color + '"></button>';
    }

    function renderPaletteGrid() {
      el.paletteGrid.innerHTML = paletteColors().map(function (color) {
        return swatchMarkup(color, 'palette-swatch');
      }).join('');
    }

    function recentDefaults() {
      return paletteMode === 'bg'
        ? ['#252932', '#ffffff', '#111827', '#3f4654', '#0f1115']
        : ['#111827', '#ffffff', '#ef4444', '#38bdf8'];
    }

    function renderPaletteRecent() {
      var key = paletteMode === 'bg' ? 'recentBgColors' : 'recentColors';
      var colors = (Array.isArray(profile[key]) && profile[key].length ? profile[key] : recentDefaults()).slice(0, 9);
      while (colors.length < 9) colors.push('');
      el.paletteRecent.innerHTML = colors.map(function (color) {
        return color ? swatchMarkup(color, 'palette-swatch recent-swatch') : '<span class="palette-swatch empty-swatch"></span>';
      }).join('');
    }

    function markActiveSwatches() {
      var current = currentColor();
      el.palettePopover.querySelectorAll('[data-color]').forEach(function (button) {
        button.classList.toggle('active', button.dataset.color.toLowerCase() === current);
      });
    }

    function currentColor() {
      return (paletteMode === 'bg' ? tool.bg : tool.color) || '#111827';
    }

    function rememberColor(color) {
      var key = paletteMode === 'bg' ? 'recentBgColors' : 'recentColors';
      var colors = Array.isArray(profile[key]) && profile[key].length ? profile[key] : recentDefaults();
      profile[key] = [color].concat(colors.filter(function (c) { return c !== color; })).slice(0, 9);
      K.setProfile(profile);
      renderPaletteRecent();
    }

    function setInk(color) {
      var value = normalizeHex(color);
      if (!value) return false;
      tool.color = value;
      profile.inkColor = value;
      rememberColor(value);
      applyColorInputs();
      renderKnobs();
      renderPalettes();
      syncPaletteInputs();
      return true;
    }

    function setBg(color, quiet) {
      var value = normalizeHex(color);
      if (!value) return false;
      tool.bg = value;
      profile.bgColor = value;
      rememberColor(value);
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
      var applied = paletteMode === 'bg' ? setBg(color, quiet) : setInk(color);
      if (applied) markActiveSwatches();
      return applied;
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
      el.paletteTargets.querySelectorAll('[data-target]').forEach(function (button) {
        button.classList.toggle('active', button.dataset.target === paletteMode);
      });
      renderPaletteRecent();
      markActiveSwatches();
    }

    function openPalettePopover(anchor, mode) {
      if (sessionKicked || !anchor || !el.palettePopover) return;
      paletteMode = mode === 'bg' ? 'bg' : 'ink';
      syncPaletteInputs();
      el.palettePopover.hidden = false;
      var rect = anchor.getBoundingClientRect();
      var popoverWidth = 272;
      var popoverHeight = 410;
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
      el.paletteCurrent.style.background = hsvToHex(paletteHsv.h, paletteHsv.s, paletteHsv.v);
      applyPaletteColor(hsvToHex(paletteHsv.h, paletteHsv.s, paletteHsv.v), true);
    }

    el.palettePopoverClose.addEventListener('click', closePalettePopover);

    el.paletteTargets.addEventListener('click', function (event) {
      var button = event.target.closest('[data-target]');
      if (!button) return;
      paletteMode = button.dataset.target === 'bg' ? 'bg' : 'ink';
      syncPaletteInputs();
    });

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

    function handlePaletteSwatch(event) {
      var swatch = event.target.closest('[data-color]');
      if (!swatch || !el.palettePopover.contains(swatch)) return;
      applyPaletteColor(swatch.dataset.color);
    }
    el.paletteGrid.addEventListener('click', handlePaletteSwatch);
    el.paletteRecent.addEventListener('click', handlePaletteSwatch);

    el.bgSquare.addEventListener('click', function () { openPalettePopover(el.bgSquare, 'bg'); });
    el.colorEditorBtn.addEventListener('click', function () { openPalettePopover(el.colorEditorBtn, 'ink'); });

    document.addEventListener('pointerdown', function (event) {
      if (el.palettePopover.hidden) return;
      if (el.palettePopover.contains(event.target)) return;
      if (event.target === el.sizeKnob || el.sizeKnob.contains(event.target)) return;
      if (event.target === el.bgSquare || el.bgSquare.contains(event.target)) return;
      if (event.target === el.colorEditorBtn || el.colorEditorBtn.contains(event.target)) return;
      closePalettePopover();
    });

    renderPaletteGrid();
    syncPaletteInputs();

    G.hslToHex = hslToHex;
    G.paletteColors = paletteColors;
    G.renderPaletteGrid = renderPaletteGrid;
    G.renderPaletteRecent = renderPaletteRecent;
    G.rememberColor = rememberColor;
    G.setInk = setInk;
    G.setBg = setBg;
    G.applyPaletteColor = applyPaletteColor;
    G.syncPaletteInputs = syncPaletteInputs;
    G.openPalettePopover = openPalettePopover;
    G.closePalettePopover = closePalettePopover;
  }
})(window.KROKO_GAME);
