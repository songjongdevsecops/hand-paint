/* ============================================================
   canvas.js — Painting engine v2
   
   Layer-based compositing:
   Layer 1 (bottom): Camera frame (adjustable opacity)
   Layer 2 (middle): Paint strokes (persistent offscreen canvas)  
   Layer 3 (top):    Hand skeleton overlay (adjustable opacity)
   
   Each animation frame recomposites all 3 layers.
   Paint strokes persist on an offscreen canvas.
   ============================================================ */

export class PaintEngine {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d', {
      alpha: false,
      desynchronized: true
    });

    // Offscreen canvas for persistent paint strokes
    this.paintLayer = document.createElement('canvas');
    this.paintCtx = this.paintLayer.getContext('2d', { alpha: true });

    // Brush state
    this.brush = {
      color: '#FF1493',    // Hot pink default — visible against most backgrounds
      size: 8,
      opacity: 1.0,
      type: 'round'
    };

    this.isDrawing = false;
    this.lastPoint = null;
    this.strokePoints = [];
    this.smoothingFactor = 0.25; // Low = responsive

    // History for undo/redo (snapshots of paintLayer only)
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 20;

    // Opacity controls
    this.cameraOpacity = 0.05;   // Start near-black, user adjusts up

    // Skeleton drawing callback (set by main.js)
    this.skeletonRenderer = null;
    // Camera frame callback (set by main.js)
    this.cameraRenderer = null;

    // Setup
    this._resize();
    this._saveHistoryState();
    this._bindResize();

    console.log('[PaintEngine] Initialized — layers: camera→paint→skeleton');
  }

  /* ---- Size & Resize ---- */

  _bindResize() {
    let timeout;
    const ro = new ResizeObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => this._resize(), 150);
    });
    ro.observe(this.canvas);
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    // Cap internal resolution
    const MAX_AREA = 1920 * 1080 * 2;
    const effectiveDpr = (w * h * dpr * dpr > MAX_AREA)
      ? Math.max(1, Math.sqrt(MAX_AREA / (w * h)))
      : dpr;

    if (this.canvas.width !== w * effectiveDpr || this.canvas.height !== h * effectiveDpr) {
      // Save paint layer before resize
      const oldPaint = (this.paintLayer.width > 0 && this.paintLayer.width < 5000)
        ? this.paintCtx.getImageData(0, 0, this.paintLayer.width, this.paintLayer.height)
        : null;

      // Resize main canvas
      this.canvas.width = w * effectiveDpr;
      this.canvas.height = h * effectiveDpr;
      this.ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

      // Resize paint layer
      this.paintLayer.width = w * effectiveDpr;
      this.paintLayer.height = h * effectiveDpr;
      this.paintCtx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

      // Restore paint layer
      if (oldPaint && oldPaint.width > 0) {
        try {
          const tmp = document.createElement('canvas');
          tmp.width = oldPaint.width;
          tmp.height = oldPaint.height;
          tmp.getContext('2d').putImageData(oldPaint, 0, 0);
          this.paintCtx.drawImage(tmp, 0, 0, w, h);
        } catch (e) {
          console.warn('[PaintEngine] Could not restore paint layer:', e.message);
        }
      }

      console.log('[PaintEngine] Resized to', w, 'x', h, '@', effectiveDpr.toFixed(1), 'x');
    }
  }

  /* ---- Frame compositing (called every rAF) ---- */

  /**
   * Composite all layers into the main canvas.
   * Called at 60fps by the render loop in main.js.
   */
  compositeFrame() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    if (w <= 0 || h <= 0) return;

    // Clear main canvas
    ctx.clearRect(0, 0, w, h);

    // DEBUG: solid dark background so we can see if compositeFrame runs
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    // Layer 1: Camera frame (adjustable opacity)
    ctx.save();
    ctx.globalAlpha = this.cameraOpacity;
    if (this.cameraRenderer) {
      this.cameraRenderer(ctx, w, h);
    }
    ctx.restore();

    // Layer 2: Paint strokes — only if paintLayer has valid dimensions
    if (this.paintLayer.width > 0 && this.paintLayer.height > 0) {
      ctx.drawImage(this.paintLayer, 0, 0, w, h);
    }

    // DEBUG: giant magenta rectangle to prove skeletonRenderer is called
    if (this.skeletonRenderer) {
      ctx.fillStyle = 'rgba(255,0,255,0.5)';
      ctx.fillRect(w - 60, 10, 50, 50);
      this.skeletonRenderer(ctx, w, h);
      // DEBUG: green rect after skeleton renderer returns
      ctx.fillStyle = 'rgba(0,255,0,0.5)';
      ctx.fillRect(w - 120, 10, 50, 50);
    }
  }

  /* ---- Opacity controls ---- */

  setCameraOpacity(val) {
    this.cameraOpacity = Math.max(0, Math.min(1, val));
  }

  /* ---- History (paintLayer only) ---- */

  _saveHistoryState() {
    const totalPx = this.paintLayer.width * this.paintLayer.height;
    if (totalPx > 25_000_000 || totalPx <= 0) return;

    // Trim future states
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    try {
      const data = this.paintCtx.getImageData(0, 0, this.paintLayer.width, this.paintLayer.height);
      this.history.push({ imageData: data, brush: { ...this.brush } });

      if (this.history.length > this.maxHistory) {
        this.history.shift();
      } else {
        this.historyIndex++;
      }
    } catch (e) {
      console.warn('[PaintEngine] Could not save history:', e.message);
    }
  }

  undo() {
    if (this.historyIndex <= 0) return false;
    this.historyIndex--;
    const state = this.history[this.historyIndex];
    this.paintCtx.clearRect(0, 0, this.paintLayer.width, this.paintLayer.height);
    this.paintCtx.putImageData(state.imageData, 0, 0);
    this.brush = { ...state.brush };
    return true;
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex++;
    const state = this.history[this.historyIndex];
    this.paintCtx.clearRect(0, 0, this.paintLayer.width, this.paintLayer.height);
    this.paintCtx.putImageData(state.imageData, 0, 0);
    this.brush = { ...state.brush };
    return true;
  }

  clear() {
    this._saveHistoryState();
    this.paintCtx.clearRect(0, 0, this.paintLayer.width, this.paintLayer.height);
  }

  /* ---- Brush settings ---- */

  setColor(color) {
    this.brush.color = color;
  }

  setSize(size) {
    this.brush.size = Math.max(1, Math.min(60, size));
  }

  /* ---- Drawing (on paintLayer) ---- */

  startStroke(point) {
    if (this.isDrawing) return;
    this.isDrawing = true;
    this._saveHistoryState();
    this.strokePoints = [point];
    this.lastPoint = point;
    this._drawDot(point);
  }

  continueStroke(point) {
    if (!this.isDrawing) return;

    const sf = this.smoothingFactor;
    const smoothed = this.lastPoint
      ? { x: this.lastPoint.x + (point.x - this.lastPoint.x) * (1 - sf),
          y: this.lastPoint.y + (point.y - this.lastPoint.y) * (1 - sf) }
      : point;

    this.strokePoints.push(smoothed);
    this.lastPoint = smoothed;

    if (this.strokePoints.length >= 2) {
      this._drawSegment(
        this.strokePoints[this.strokePoints.length - 2],
        smoothed
      );
    }
  }

  endStroke() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.lastPoint = null;
    this.strokePoints = [];
  }

  /* ---- Brush primitives (all draw on paintCtx) ---- */

  _drawDot(point) {
    const ctx = this.paintCtx;
    ctx.save();
    ctx.globalAlpha = this.brush.opacity;
    this._drawRound(point);
    ctx.restore();
  }

  _drawSegment(from, to) {
    const ctx = this.paintCtx;
    const size = this.brush.size;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);

    if (dist < 1.5) { this._drawDot(to); return; }

    ctx.save();
    ctx.globalAlpha = this.brush.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size;
    ctx.strokeStyle = this.brush.color;

    // Bezier for smooth curves
    if (this.strokePoints.length >= 3) {
      const p0 = this.strokePoints[this.strokePoints.length - 3];
      const p1 = from;
      const p2 = to;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(
        p1.x + (p1.x - p0.x) * 0.2,
        p1.y + (p1.y - p0.y) * 0.2,
        p2.x, p2.y
      );
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawRound(point) {
    const ctx = this.paintCtx;
    const r = this.brush.size / 2;
    const g = ctx.createRadialGradient(point.x, point.y, r * 0.2, point.x, point.y, r);
    g.addColorStop(0, this.brush.color);
    g.addColorStop(1, this.brush.color + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---- Export ---- */

  toDataURL(type = 'image/png') {
    // Export just the paint layer (not camera/skeleton)
    return this.paintLayer.toDataURL(type);
  }

  download() {
    const link = document.createElement('a');
    link.download = `handpaint-${Date.now()}.png`;
    link.href = this.toDataURL();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
