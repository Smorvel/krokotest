/* Brushes, shapes, smoothing and artist cursor. */
(function (G) {
  /* Hot pixel loop: kept outside `with (G)` so V8 can optimize variable access. */
  function hexToRgb(color) {
    var value = String(color || '#000000').replace('#', '');
    if (value.length === 3) value = value.split('').map(function (c) { return c + c; }).join('');
    var num = parseInt(value, 16);
    if (isNaN(num)) return [0, 0, 0];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function floodFill(context, point, color, alpha) {
    var w = context.canvas.width;
    var h = context.canvas.height;
    var total = w * h;
    if (!total) return;
    var px = Math.max(0, Math.min(w - 1, Math.round(point.x)));
    var py = Math.max(0, Math.min(h - 1, Math.round(point.y)));
    var image = context.getImageData(0, 0, w, h);
    var data = image.data;
    var start = (py * w + px) * 4;
    var tr = data[start], tg = data[start + 1], tb = data[start + 2], ta = data[start + 3];
    var cr = hexToRgb(color);
    var a = Math.max(0.05, Math.min(1, alpha));
    var keep = 1 - a;
    var mixR = cr[0] * a, mixG = cr[1] * a, mixB = cr[2] * a, mixA = 255 * a;
    var mask = new Uint8Array(total);
    var stackIndex = new Int32Array(total);
    var stackLeft = new Int32Array(total);
    var stackRight = new Int32Array(total);
    var stackSize = 0;
    var i, offset;

    for (i = 0, offset = 0; i < total; i++, offset += 4) {
      if (Math.abs(data[offset] - tr) <= 12 &&
          Math.abs(data[offset + 1] - tg) <= 12 &&
          Math.abs(data[offset + 2] - tb) <= 12 &&
          Math.abs(data[offset + 3] - ta) <= 12) mask[i] = 1;
    }

    function push(index, left, right) {
      stackIndex[stackSize] = index;
      stackLeft[stackSize] = left;
      stackRight[stackSize] = right;
      stackSize++;
    }

    function scanRow(row, left, right) {
      if (row < 0 || row >= h) return;
      var base = row * w;
      var x = left;
      while (x <= right) {
        while (x <= right && !mask[base + x]) x++;
        if (x > right) break;
        var spanStart = x;
        while (x <= right && mask[base + x]) x++;
        push(base + spanStart, spanStart, x - 1);
      }
    }

    push(py * w + px, px, px);
    while (stackSize) {
      stackSize--;
      var index = stackIndex[stackSize];
      var left = stackLeft[stackSize];
      var right = stackRight[stackSize];
      var y = (index / w) | 0;
      var base = y * w;
      while (left > 0 && mask[base + left - 1]) left--;
      while (right < w - 1 && mask[base + right + 1]) right++;
      for (var x2 = left; x2 <= right; x2++) {
        var pixel = base + x2;
        if (!mask[pixel]) continue;
        mask[pixel] = 0;
        var o = pixel * 4;
        data[o] = mixR + data[o] * keep;
        data[o + 1] = mixG + data[o + 1] * keep;
        data[o + 2] = mixB + data[o + 2] * keep;
        data[o + 3] = mixA + data[o + 3] * keep;
      }
      scanRow(y - 1, left, right);
      scanRow(y + 1, left, right);
    }
    context.putImageData(image, 0, 0);
  }

  G.hexToRgb = hexToRgb;
  G.floodFill = floodFill;

  with (G) {
    /* ---------- Отрисовка ---------- */
  
    function pointFromEvent(event) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * canvas.width / rect.width,
        y: (event.clientY - rect.top) * canvas.height / rect.height,
        p: event.pressure || 0.5,
        t: Date.now()
      };
    }
  
    function clockMs() {
      return (window.performance && performance.now) ? performance.now() : Date.now();
    }
  
    function resetSmoothing(point) {
      smoothPoint = {
        x: point.x, y: point.y,
        rawX: point.x, rawY: point.y,
        t: clockMs()
      };
    }
  
    function smoothInputPoint(raw, forceEnd) {
      var current = smoothPoint;
      if (!current) {
        resetSmoothing(raw);
        return raw;
      }
      var elapsed = (clockMs() - current.t) / 1000;
      var dt = Math.max(0.004, Math.min(0.05, elapsed > 0 ? elapsed : 0.016));
      var speed = Math.hypot(raw.x - current.rawX, raw.y - current.rawY) / dt;
      var cutoff = 1 + speed / 260;
      var alpha = forceEnd ? 1 : 1 - Math.exp(-dt * 2 * Math.PI * cutoff);
      var point = {
        x: current.x + (raw.x - current.x) * alpha,
        y: current.y + (raw.y - current.y) * alpha,
        p: raw.p,
        t: raw.t
      };
      smoothPoint = { x: point.x, y: point.y, rawX: raw.x, rawY: raw.y, t: clockMs() };
      return point;
    }
  
    function isShape(toolId) {
      return toolId === 'shape';
    }
  
    function polyline(context, points) {
      context.beginPath();
      if (!points.length) return;
      context.moveTo(points[0].x, points[0].y);
      for (var i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
    }
  
    function smoothPath(context, points) {
      context.beginPath();
      if (!points.length) return;
      if (points.length === 1) {
        context.moveTo(points[0].x, points[0].y);
        context.lineTo(points[0].x + 0.01, points[0].y + 0.01);
        return;
      }
      if (points.length === 2) {
        context.moveTo(points[0].x, points[0].y);
        context.lineTo(points[1].x, points[1].y);
        return;
      }
      context.moveTo(points[0].x, points[0].y);
      for (var i = 0; i < points.length - 1; i++) {
        var p0 = points[i === 0 ? 0 : i - 1];
        var p1 = points[i];
        var p2 = points[i + 1];
        var p3 = points[i + 2] || p2;
        var cp1x = p1.x + (p2.x - p0.x) / 6;
        var cp1y = p1.y + (p2.y - p0.y) / 6;
        var cp2x = p2.x - (p3.x - p1.x) / 6;
        var cp2y = p2.y - (p3.y - p1.y) / 6;
        context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
    }
  
    function strokePath(context, points, smooth) {
      if (smooth) smoothPath(context, points);
      else polyline(context, points);
    }
  
    function stampAlong(points, spacing, callback) {
      if (!points.length) return;
      callback(points[0].x, points[0].y, points[0]);
      var carry = 0;
      for (var i = 1; i < points.length; i++) {
        var a = points[i - 1];
        var b = points[i];
        var dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist < 0.01) continue;
        var step = Math.max(1, spacing);
        var t = carry;
        while (t < dist) {
          var ratio = t / dist;
          callback(a.x + (b.x - a.x) * ratio, a.y + (b.y - a.y) * ratio, b);
          t += step;
        }
        carry = t - dist;
      }
    }
  
    function cachedStamp(key, diameter, draw) {
      var cached = stampCache[key];
      if (!cached) {
        var pad = 3;
        var side = Math.ceil(diameter) + pad * 2;
        var stamp = document.createElement('canvas');
        stamp.width = side;
        stamp.height = side;
        var stampCtx = stamp.getContext('2d');
        draw(stampCtx, side / 2, diameter);
        cached = { canvas: stamp, half: side / 2 };
        stampCache[key] = cached;
      }
      return cached;
    }
  
    function paintStroke(context, stroke, transparentErase) {
      if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return;
      var points = stroke.points;
      var size = Math.max(2, Number(stroke.size) || 18);
      var color = stroke.color || '#111827';
      var alpha = stroke.alpha == null ? 1 : Math.max(0.05, Math.min(1, Number(stroke.alpha)));
      var smooth = !!stroke.smooth;
      var start = points[0];
      var end = points[points.length - 1];
  
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = color;
      context.fillStyle = color;
      context.globalAlpha = alpha;
      context.globalCompositeOperation = 'source-over';
  
      if (stroke.tool === 'eraser') {
        context.globalAlpha = 1;
        context.lineWidth = size * 1.5;
        if (transparentErase) {
          /* В архиве ластик вырезает прозрачность, чтобы фон оставался сменным. */
          context.globalCompositeOperation = 'destination-out';
          context.strokeStyle = '#000000';
        } else {
          /* Всегда рисуем текущим фоном: старый цвет в штрихе не хранится. */
          context.strokeStyle = (state && state.bg) || tool.bg || '#ffffff';
        }
        context.fillStyle = context.strokeStyle;
        strokePath(context, points, smooth);
        context.stroke();
        context.restore();
        return;
      }
  
      if (stroke.tool === 'soft') {
        var rgb = hexToRgb(color);
        var radius = size * 1.05;
        var stamp = cachedStamp('soft|' + color + '|' + alpha.toFixed(2) + '|' + radius.toFixed(1), radius * 2, function (c, center, diameter) {
          var r = diameter / 2;
          var gradient = c.createRadialGradient(center, center, 0, center, center, r);
          gradient.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.72 * alpha).toFixed(3) + ')');
          gradient.addColorStop(0.45, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.28 * alpha).toFixed(3) + ')');
          gradient.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
          c.fillStyle = gradient;
          c.beginPath();
          c.arc(center, center, r, 0, Math.PI * 2);
          c.fill();
        });
        context.globalAlpha = 1;
        stampAlong(points, Math.max(2, radius * 0.3), function (x, y) {
          context.drawImage(stamp.canvas, x - stamp.half, y - stamp.half);
        });
        context.restore();
        return;
      }
  
      if (stroke.tool === 'tablet') {
        var lastWidth = size;
        context.globalAlpha = alpha;
        for (var i = 1; i < points.length; i++) {
          var a = points[i - 1];
          var b = points[i];
          var dist = Math.hypot(b.x - a.x, b.y - a.y);
          var dt = a.t && b.t ? Math.max(1, b.t - a.t) : 16;
          var speed = dist / dt;
          var target = size * Math.max(0.6, Math.min(1.9, 1.85 - speed * 0.5));
          if (b.p && b.p > 0 && b.p !== 0.5) target *= Math.max(0.75, Math.min(1.3, 0.7 + b.p * 0.6));
          var width = lastWidth * 0.55 + target * 0.45;
          lastWidth = width;
          context.lineWidth = width;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
        if (points.length === 1) {
          context.beginPath();
          context.arc(points[0].x, points[0].y, size * 0.8, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
        return;
      }
  
      if (stroke.tool === 'shape') {
        var mode = SHAPE_LABELS[stroke.shapeMode] ? stroke.shapeMode : tool.shapeMode;
        var shapeStart = points[0];
        var shapeEnd = points[points.length - 1];
        var dx = shapeEnd.x - shapeStart.x;
        var dy = shapeEnd.y - shapeStart.y;
        context.lineWidth = Math.max(2, size);
        context.beginPath();
        if (mode === 'stripe') {
          context.moveTo(shapeStart.x, shapeStart.y);
          context.lineTo(shapeEnd.x, shapeEnd.y);
          context.stroke();
        } else if (mode === 'circle') {
          var radiusX = Math.max(2, Math.abs(dx) / 2);
          var radiusY = Math.max(2, Math.abs(dy) / 2);
          context.ellipse((shapeStart.x + shapeEnd.x) / 2, (shapeStart.y + shapeEnd.y) / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
          context.stroke();
        } else {
          context.rect(shapeStart.x, shapeStart.y, dx || 2, dy || 2);
          context.stroke();
        }
        context.restore();
        return;
      }
  
      switch (stroke.tool) {
        case 'pencil':
          context.globalAlpha = 0.92 * alpha;
          context.lineWidth = Math.max(1, size * 0.45);
          strokePath(context, points, smooth);
          context.stroke();
          break;
        case 'marker':
          context.globalAlpha = 0.34 * alpha;
          context.lineWidth = size * 1.5;
          strokePath(context, points, smooth);
          context.stroke();
          break;
        case 'airbrush':
          points.forEach(function (point) {
            var radius = size * 0.75;
            var gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            context.globalAlpha = 0.075 * alpha;
            context.fillStyle = gradient;
            context.beginPath();
            context.arc(point.x, point.y, radius, 0, Math.PI * 2);
            context.fill();
          });
          break;
        case 'line':
          context.lineWidth = size;
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
          context.stroke();
          break;
        case 'rect': {
          var minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
          var minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
          context.lineWidth = size;
          context.strokeRect(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
          break;
        }
        case 'ellipse': {
          var cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
          var rx = Math.max(1, Math.abs(end.x - start.x) / 2);
          var ry = Math.max(1, Math.abs(end.y - start.y) / 2);
          context.lineWidth = size;
          context.beginPath();
          context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          context.stroke();
          break;
        }
        case 'fill':
          context.restore();
          floodFill(context, start, color, alpha);
          return;
        default:
          context.lineWidth = size;
          strokePath(context, points, smooth);
          context.stroke();
      }
      context.restore();
    }
  
    function rememberFillCache(key, image) {
      fillCache[key] = { image: image, w: canvas.width, h: canvas.height };
      fillCacheKeys.push(key);
      while (fillCacheKeys.length > 12) {
        var old = fillCacheKeys.shift();
        if (fillCache[old]) delete fillCache[old];
      }
    }

    function loadRasterImages(strokes) {
      if (!Array.isArray(strokes)) return;
      strokes.forEach(function (stroke) {
        if (!stroke || stroke.tool !== 'raster' || !stroke.image || rasterImages[stroke.id]) return;
        var img = new Image();
        img.onload = function () { scheduleBaseRedraw(); };
        img.src = stroke.image;
        rasterImages[stroke.id] = img;
      });
    }

    function rasterSource(stroke, img) {
      var oldBg = typeof stroke.bg === 'string' ? stroke.bg.toLowerCase() : '';
      var bg = String((state && state.bg) || tool.bg || '#ffffff').toLowerCase();
      if (!oldBg || oldBg === bg) return img;
      var key = stroke.id + '|' + bg;
      if (rasterBgCache[key]) return rasterBgCache[key];
      var recolored = document.createElement('canvas');
      recolored.width = img.naturalWidth;
      recolored.height = img.naturalHeight;
      var c = recolored.getContext('2d', { willReadFrequently: true });
      c.drawImage(img, 0, 0);
      var image = c.getImageData(0, 0, recolored.width, recolored.height);
      var data = image.data;
      var from = hexToRgb(oldBg);
      var to = hexToRgb(bg);
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] && Math.abs(data[i] - from[0]) <= 6 &&
            Math.abs(data[i + 1] - from[1]) <= 6 && Math.abs(data[i + 2] - from[2]) <= 6) {
          data[i] = to[0];
          data[i + 1] = to[1];
          data[i + 2] = to[2];
        }
      }
      c.putImageData(image, 0, 0);
      rasterBgCache[key] = recolored;
      rasterBgCacheKeys.push(key);
      while (rasterBgCacheKeys.length > 4) {
        delete rasterBgCache[rasterBgCacheKeys.shift()];
      }
      return recolored;
    }

    function drawRasterStroke(context, stroke) {
      var img = stroke && rasterImages[stroke.id];
      if (!img || !img.complete || !img.naturalWidth) return false;
      var sw = Number(stroke.w) || img.naturalWidth;
      var sh = Number(stroke.h) || img.naturalHeight;
      var scale = Math.min(canvas.width / sw, canvas.height / sh);
      var dw = sw * scale;
      var dh = sh * scale;
      var dx = (canvas.width - dw) / 2;
      var dy = (canvas.height - dh) / 2;
      context.drawImage(rasterSource(stroke, img), dx, dy, dw, dh);
      return true;
    }

    function drawArchivedStroke(context, stroke) {
      if (!stroke) return;
      if (stroke.tool === 'raster') {
        drawRasterStroke(context, stroke);
        return;
      }
      if (stroke.tool === 'fill' && stroke.points && stroke.points.length) {
        floodFill(context, stroke.points[0], stroke.color, stroke.alpha);
        return;
      }
      paintStroke(context, stroke, true);
    }

    function compactStrokes() {
      if (!state || !isDrawer() || !Array.isArray(state.strokes) || state.strokes.length < 2) return;
      var tooMany = state.strokes.length > STROKE_SOFT_LIMIT;
      var tooBig = false;
      if (!tooMany && STROKE_BYTES_LIMIT > 0) {
        try { tooBig = JSON.stringify(state.strokes).length > STROKE_BYTES_LIMIT; } catch (err) { /* ignore */ }
      }
      if (!tooMany && !tooBig) return;

      var keep = Math.min(STROKE_KEEP_RECENT, Math.max(0, state.strokes.length - 1));
      var cut = state.strokes.length - keep;
      if (cut < 2) return;
      var old = state.strokes.slice(0, cut);
      var notReady = old.some(function (stroke) {
        return stroke && stroke.tool === 'raster' && stroke.image &&
          (!rasterImages[stroke.id] || !rasterImages[stroke.id].complete);
      });
      if (notReady) return;

      var archive = document.createElement('canvas');
      archive.width = canvas.width;
      archive.height = canvas.height;
      var archiveCtx = archive.getContext('2d', { willReadFrequently: true });
      old.forEach(function (stroke) { drawArchivedStroke(archiveCtx, stroke); });

      var image = archive.toDataURL('image/png');
      var raster = {
        id: K.uid(),
        owner: '',
        tool: 'raster',
        image: image,
        w: archive.width,
        h: archive.height,
        cw: canvas.width,
        ch: canvas.height,
        bg: '',
        points: [],
        at: Date.now()
      };
      var img = new Image();
      img.onload = function () { scheduleBaseRedraw(); };
      img.src = image;
      rasterImages[raster.id] = img;
      state.strokes = [raster].concat(state.strokes.slice(cut));
      var seq = (Number(state.canvasSeq) || 0) + 1;
      state.canvasSeq = seq;
      publishStroke(raster, seq);
      old.forEach(function (stroke) { publishStrokeDeletion(stroke.id, seq); });
    }

    function commitStroke(stroke) {
      if (!state || !stroke) return;
      stroke.cw = canvas.width;
      stroke.ch = canvas.height;
      state.canvasSeq = (Number(state.canvasSeq) || 0) + 1;
      stroke.seq = state.canvasSeq;
      state.strokes.push(stroke);
      publishStroke(stroke, stroke.seq);
      compactStrokes();
      publishState();
      scheduleBaseRedraw();
    }

    function redrawBase() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = (state && state.bg) || tool.bg || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (state) {
        var prefix = '';
        loadRasterImages(state.strokes);
        state.strokes.forEach(function (stroke) {
          if (stroke.tool === 'raster' && stroke.image) {
            drawRasterStroke(ctx, stroke);
          } else if (stroke.tool === 'fill' && stroke.points && stroke.points.length) {
            var key = stroke.id + '|' + prefix + '|' + (state.bg || '') + '|' + stroke.color + '|' + stroke.alpha;
            var cached = fillCache[key];
            if (cached && cached.w === canvas.width && cached.h === canvas.height) {
              ctx.putImageData(cached.image, 0, 0);
            } else {
              floodFill(ctx, stroke.points[0], stroke.color, stroke.alpha);
              rememberFillCache(key, ctx.getImageData(0, 0, canvas.width, canvas.height));
            }
          } else {
            paintStroke(ctx, stroke);
          }
          prefix += (prefix ? ',' : '') + stroke.id;
        });
      }
      ctx.restore();
    }

    function scheduleBaseRedraw() {
      if (baseFrame) return;
      baseFrame = requestAnimationFrame(function () {
        baseFrame = null;
        redrawBase();
      });
    }
  
    function redrawDrafts() {
      draftFrame = null;
      draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
      Object.keys(remoteDrafts).forEach(function (id) {
        var draft = remoteDrafts[id];
        if (!draft || id === myId || draft.tool === 'fill') return;
        if (draft.pendingUntil && Date.now() > draft.pendingUntil) return;
        paintStroke(draftCtx, draft);
      });
      if (localDraft) paintStroke(draftCtx, localDraft);
    }
  
    function scheduleDrafts() {
      if (draftFrame) return;
      draftFrame = requestAnimationFrame(redrawDrafts);
    }

    function saveCanvasPng() {
      redrawBase();
      var stamp = new Date().toISOString().replace(/[:.]/g, '-');
      var safeRoom = String(room || 'drawing').replace(/[^a-z0-9_-]+/gi, '-');
      var link = document.createElement('a');
      link.download = 'krokotest-' + safeRoom + '-' + stamp + '.png';
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  
    function cursorFactor() {
      if (tool.current === 'soft') return 2.1;
      if (tool.current === 'eraser') return 1.5;
      if (tool.current === 'tablet') return 1.8;
      return 1;
    }
  
    function updateCursor(event) {
      if (isBannedMe() || !isDrawer()) { el.cursor.hidden = true; return; }
      lastCursorEvent = { clientX: event.clientX, clientY: event.clientY };
      var rect = el.wrap.getBoundingClientRect();
      var scale = rect.width / canvas.width;
      var picking = tool.current === 'pipette';
      var diameter = picking ? 30 : Math.max(4, Math.round(tool.size * cursorFactor() * scale));
      el.cursor.style.width = diameter + 'px';
      el.cursor.style.height = diameter + 'px';
      el.cursor.style.left = (event.clientX - rect.left) + 'px';
      el.cursor.style.top = (event.clientY - rect.top) + 'px';
      el.cursor.style.borderColor = picking ? '#34d399' : (tool.current === 'eraser' ? '#fb7185' : '#111827');
      el.cursor.style.borderStyle = picking ? 'dashed' : 'solid';
      el.cursor.className = 'brush-cursor ' + (picking ? 'pipette-cursor' : 'shape-' + (tool.current === 'shape' ? tool.shapeMode : 'circle'));
      el.cursor.textContent = picking ? '💧' : '';
      el.cursor.hidden = false;
    }
  
    function refreshCursor() {
      if (lastCursorEvent) updateCursor(lastCursorEvent);
    }
  
    /* ---------- Интерфейс ---------- */
    G.pointFromEvent = pointFromEvent;
    G.clockMs = clockMs;
    G.resetSmoothing = resetSmoothing;
    G.smoothInputPoint = smoothInputPoint;
    G.isShape = isShape;
    G.polyline = polyline;
    G.smoothPath = smoothPath;
    G.strokePath = strokePath;
    G.stampAlong = stampAlong;
    G.cachedStamp = cachedStamp;
    G.paintStroke = paintStroke;
    G.loadRasterImages = loadRasterImages;
    G.drawRasterStroke = drawRasterStroke;
    G.compactStrokes = compactStrokes;
    G.commitStroke = commitStroke;
    G.redrawBase = redrawBase;
    G.scheduleBaseRedraw = scheduleBaseRedraw;
    G.redrawDrafts = redrawDrafts;
    G.scheduleDrafts = scheduleDrafts;
    G.saveCanvasPng = saveCanvasPng;
    G.cursorFactor = cursorFactor;
    G.updateCursor = updateCursor;
    G.refreshCursor = refreshCursor;
  }
})(window.KROKO_GAME);
