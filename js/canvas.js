/* ============================================================
   canvas.js — Painting engine
   
   Full-viewport canvas with:
   - Smooth bezier curve drawing
   - Undo/redo history
   - Variable brush size, color, opacity
   - Multiple brush types (round, flat, spray)
   - Offscreen rendering for performance
   ============================================================ */

export class PaintCanvas {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d', {
      alpha: true,
      desynchronized: true,  // Hint for low-latency rendering
      willReadFrequently: false
    });

    // Offscreen canvas for the active stroke (smoothing)
    this.offscreen = document.createElement('canvas');
    this.offscreenCtx = this.offscreen.getContext('2d', { alpha: true });

    // State
    this.brush = {
      color: '#FFFFFF',
      size: 5,
      opacity: 1.0,
      type: 'round',       // 'round' | 'flat' | 'spray'
      hardness: 0.8
    };

    this.isDrawing = false;
    this.lastPoint = null;
    this.strokePoints = []; // Points for current stroke
    this.currentStrokeImageData = null; // Snapshot before stroke started

    // History for undo/redo
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 20;  // Reduced from 50 — ImageData at 2x DPR can be 30+ MB each

    // Smoothing — lower = more responsive, higher = more lag
    this.smoothingFactor = 0.3; // 0 = no smoothing, 1 = max

    // Setup canvas size
    this._resize();
    this._saveState();
    this._bindResize();

    console.log('[PaintCanvas] Initialized', this.canvas.width, 'x', this.canvas.height, '@', this.canvas.width / (this.canvas.clientWidth || 1), 'x DPR');
  }

  /* ---- Resize handling ---- */

  _bindResize() {
    let resizeTimeout;
    const ro = new ResizeObserver(() => {
      // Debounce resize events
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => this._resize(), 100);
    });
    ro.observe(this.canvas);
  }

  _resize() {
    let dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for perf
    let w = this.canvas.clientWidth;
    let h = this.canvas.clientHeight;

    // Guard: don't resize to zero
    if (w <= 0 || h <= 0) return;

    // Cap internal resolution to prevent memory blowout
    // Max ~1920x1080 at 2x = 3840x2160 internal ≈ 33 MB per snapshot
    const MAX_INTERNAL_PX = 1920 * 1080 * 2;
    if (w * h * dpr * dpr > MAX_INTERNAL_PX) {
      dpr = Math.max(1, Math.sqrt(MAX_INTERNAL_PX / (w * h)));
    }

    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      // Save current canvas content before resize
      const oldData = (this.canvas.width > 0 && this.canvas.width * this.canvas.height < 50_000_000)
        ? this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
        : null;

      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.offscreen.width = w * dpr;
      this.offscreen.height = h * dpr;

      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.offscreenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Restore old content scaled to new size
      if (oldData && oldData.width > 0) {
        try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = oldData.width;
          tempCanvas.height = oldData.height;
          tempCanvas.getContext('2d').putImageData(oldData, 0, 0);
          this.ctx.drawImage(tempCanvas, 0, 0, w, h);
        } catch (e) {
          console.warn('[PaintCanvas] Could not restore canvas after resize:', e.message);
        }
      }

      console.log('[PaintCanvas] Resized to', w, 'x', h, '@', dpr, 'x');
    }
  }

  /* ---- History management ---- */

  _saveState() {
    // Safety: skip if canvas is too large (would cause memory issues)
    const totalPx = this.canvas.width * this.canvas.height;
    if (totalPx > 25_000_000) {
      console.warn('[PaintCanvas] Skipping history save — canvas too large:', totalPx, 'px');
      return;
    }

    // Remove any future states if we're in the middle of history
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    // Capture current canvas state
    let data;
    try {
      data = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    } catch (e) {
      console.warn('[PaintCanvas] Could not save state:', e.message);
      return;
    }

    this.history.push({
      imageData: data,
      brush: { ...this.brush }
    });

    // Trim history
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }
  }

  undo() {
    if (this.historyIndex <= 0) return false;

    this.historyIndex--;
    const state = this.history[this.historyIndex];
    this.ctx.putImageData(state.imageData, 0, 0);
    this.brush = { ...state.brush };
    console.log('[PaintCanvas] Undo → step', this.historyIndex);
    return true;
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return false;

    this.historyIndex++;
    const state = this.history[this.historyIndex];
    this.ctx.putImageData(state.imageData, 0, 0);
    this.brush = { ...state.brush };
    console.log('[PaintCanvas] Redo → step', this.historyIndex);
    return true;
  }

  canUndo() { return this.historyIndex > 0; }
  canRedo() { return this.historyIndex < this.history.length - 1; }

  /* ---- Brush settings ---- */

  setColor(color) {
    this.brush.color = color;
    document.getElementById('brushDot').style.background = color;
  }

  setSize(size) {
    this.brush.size = Math.max(1, Math.min(80, size));
    document.getElementById('brushSize').textContent = Math.round(this.brush.size) + 'px';
  }

  setOpacity(opacity) {
    this.brush.opacity = Math.max(0.05, Math.min(1, opacity));
  }

  setType(type) {
    this.brush.type = type;
  }

  /* ---- Drawing ---- */

  /**
   * Start a new stroke at the given point
   */
  startStroke(point) {
    if (this.isDrawing) return;
    this.isDrawing = true;
    this._saveState();
    this.strokePoints = [point];
    this.lastPoint = point;

    // Apply the first dot
    this._drawDot(point);
  }

  /**
   * Continue the current stroke
   */
  continueStroke(point) {
    if (!this.isDrawing) return;

    // Smooth the point (exponential moving average)
    const smoothed = this.lastPoint ? {
      x: this.lastPoint.x + (point.x - this.lastPoint.x) * (1 - this.smoothingFactor),
      y: this.lastPoint.y + (point.y - this.lastPoint.y) * (1 - this.smoothingFactor)
    } : point;

    this.strokePoints.push(smoothed);
    this.lastPoint = smoothed;

    // Draw segment from second-to-last to current smoothed point
    if (this.strokePoints.length >= 2) {
      const prev = this.strokePoints[this.strokePoints.length - 2];
      this._drawSegment(prev, smoothed);
    }

    return smoothed;
  }

  /**
   * End the current stroke
   */
  endStroke() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.lastPoint = null;
    this.strokePoints = [];
  }

  /**
   * Draw a single dot (used for taps and stroke start)
   */
  _drawDot(point) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = this.brush.opacity;

    switch (this.brush.type) {
      case 'spray':
        this._drawSpray(point);
        break;
      case 'flat':
        this._drawFlatBrush(point);
        break;
      case 'round':
      default:
        this._drawRoundBrush(point);
        break;
    }

    ctx.restore();
  }

  /**
   * Draw a segment between two points
   */
  _drawSegment(from, to) {
    const ctx = this.ctx;
    const size = this.brush.size;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);

    // If points are very close, just draw dots
    if (dist < 2) {
      this._drawDot(to);
      return;
    }

    ctx.save();
    ctx.globalAlpha = this.brush.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (this.brush.type) {
      case 'spray':
        // For spray, sample points along the segment
        const steps = Math.ceil(dist / (size * 0.3));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          this._drawSpray({
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t
          });
        }
        break;

      case 'flat':
        ctx.lineWidth = size;
        ctx.strokeStyle = this.brush.color;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        break;

      case 'round':
      default:
        // Variable-width line based on pressure simulation
        const baseWidth = size;
        ctx.lineWidth = baseWidth;
        ctx.strokeStyle = this.brush.color;

        // Use quadratic bezier for smooth curves
        if (this.strokePoints.length >= 3) {
          const p0 = this.strokePoints[this.strokePoints.length - 3];
          const p1 = from;
          const p2 = to;
          const cpX = p1.x + (p1.x - p0.x) * 0.2;
          const cpY = p1.y + (p1.y - p0.y) * 0.2;

          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.quadraticCurveTo(cpX, cpY, p2.x, p2.y);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        }
        break;
    }

    ctx.restore();
  }

  _drawRoundBrush(point) {
    const ctx = this.ctx;
    const r = this.brush.size / 2;

    // Radial gradient for soft edge
    const gradient = ctx.createRadialGradient(point.x, point.y, r * 0.3, point.x, point.y, r);
    gradient.addColorStop(0, this.brush.color);
    gradient.addColorStop(1, this.brush.color + '00'); // Fade to transparent

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawFlatBrush(point) {
    const ctx = this.ctx;
    const w = this.brush.size;
    const h = this.brush.size * 0.4;

    ctx.fillStyle = this.brush.color;
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawSpray(point) {
    const ctx = this.ctx;
    const r = this.brush.size / 2;
    const density = Math.floor(this.brush.size * 2);

    ctx.fillStyle = this.brush.color;
    for (let i = 0; i < density; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * r;
      const sx = point.x + Math.cos(angle) * dist;
      const sy = point.y + Math.sin(angle) * dist;
      const dotSize = Math.random() * 2 + 0.5;

      ctx.fillRect(sx - dotSize / 2, sy - dotSize / 2, dotSize, dotSize);
    }
  }

  /* ---- Clear ---- */

  clear() {
    this._saveState();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    console.log('[PaintCanvas] Canvas cleared');
  }

  /* ---- Export ---- */

  toDataURL(type = 'image/png') {
    return this.canvas.toDataURL(type);
  }

  download() {
    const link = document.createElement('a');
    link.download = `handpaint-${Date.now()}.png`;
    link.href = this.toDataURL();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log('[PaintCanvas] Downloaded');
  }
}
