/* Canvas pointer and wheel handlers. */
(function (G) {
  with (G) {
    /* ---------- Холст ---------- */
  
    function drawingBlocked() {
      return !!state && (isHitPaused() || !!state.reveal || !!state.lastWord);
    }

    canvas.addEventListener('pointerdown', function (event) {
      if (!state || !isDrawer() || drawingBlocked()) return;
      event.preventDefault();
      updateCursor(event);
  
      if (tool.current === 'pipette') {
        var pos = pointFromEvent(event);
        var pixel = ctx.getImageData(
          Math.min(canvas.width - 1, Math.max(0, Math.floor(pos.x))),
          Math.min(canvas.height - 1, Math.max(0, Math.floor(pos.y))),
          1, 1
        ).data;
        setInk('#' + [pixel[0], pixel[1], pixel[2]].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''));
        tool.current = previousTool;
        renderTools();
        refreshCursor();
        return;
      }
  
      if (tool.current === 'fill') {
        var fillStroke = {
          id: K.uid(),
          owner: myId,
          tool: 'fill',
          color: tool.color,
          size: tool.size,
          alpha: tool.alpha / 100,
          smooth: false,
          shapeMode: tool.shapeMode,
          bg: tool.bg,
          points: [pointFromEvent(event)]
        };
        commitStroke(fillStroke);
        return;
      }
  
      drawing = true;
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* синтетические события */ }
      var startPoint = pointFromEvent(event);
      resetSmoothing(startPoint);
      localDraft = {
        id: K.uid(),
        owner: myId,
        tool: tool.current,
        color: tool.color,
        size: tool.size,
        alpha: tool.alpha / 100,
        smooth: tool.smooth,
        shapeMode: tool.shapeMode,
        bg: tool.bg,
        points: [startPoint]
      };
      scheduleDrafts();
    });
  
    canvas.addEventListener('pointermove', function (event) {
      updateCursor(event);
      if (!drawing || !localDraft) return;
      if (drawingBlocked()) { endStroke(event, false); return; }
      event.preventDefault();
      var raw = pointFromEvent(event);
      var next = tool.smooth && !isShape(tool.current) ? smoothInputPoint(raw, false) : raw;
      if (isShape(tool.current)) {
        localDraft.points = [localDraft.points[0], next];
      } else {
        var last = localDraft.points[localDraft.points.length - 1];
        if (Math.hypot(next.x - last.x, next.y - last.y) < 1) return;
        if (localDraft.points.length < 4000) localDraft.points.push(next);
      }
      scheduleDrafts();
      if (Date.now() - lastDraftPublish > 300) {
        lastDraftPublish = Date.now();
        publishDraft(localDraft);
      }
    });
  
    function endStroke(event, discard) {
      if (!drawing) return;
      drawing = false;
      var skip = !!discard;
      if (localDraft) {
        if (!skip && event && event.type === 'pointerup') {
          var rawEnd = pointFromEvent(event);
          var endPoint = localDraft.smooth && !isShape(localDraft.tool)
            ? smoothInputPoint(rawEnd, true) : rawEnd;
          if (localDraft.tool === 'shape') {
            if (localDraft.points.length < 2) localDraft.points.push(endPoint);
            else localDraft.points[localDraft.points.length - 1] = endPoint;
          } else {
            localDraft.points.push(endPoint);
          }
        }
        smoothPoint = null;
        if (!skip) commitStroke(localDraft);
        localDraft = null;
        publishDraft(null);
        scheduleDrafts();
      }
      if (event) updateCursor(event);
    }
  
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    document.addEventListener('pointerup', function (event) { if (drawing) endStroke(event); });
    document.addEventListener('pointercancel', function (event) { if (drawing) endStroke(event); });
    canvas.addEventListener('pointerleave', function () { if (!drawing) el.cursor.hidden = true; });
    canvas.addEventListener('wheel', function (event) {
      if (!isDrawer() || isBannedMe()) return;
      event.preventDefault();
      setKnobValue('size', tool.size + (event.deltaY < 0 ? 2 : -2));
      K.setProfile(profile);
      updateCursor(event);
    }, { passive: false });
    G.endStroke = endStroke;
  }
})(window.KROKO_GAME);
