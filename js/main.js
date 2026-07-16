/* ============================================================
   main.js — Application orchestrator v2
   
   - Render loop at 60fps compositing camera→paint→skeleton
   - Gesture handling at 30fps from MediaPipe
   - Hysteresis stabilizer prevents gesture oscillation
   - Opacity controls for camera background and skeleton overlay
   ============================================================ */

import { HandTracker } from './handTracking.js';
import { PaintEngine } from './canvas.js';
import { classifyGesture, mapToCanvas } from './gestures.js';
import { UI } from './ui.js';

/**
 * Gesture stabilizer with hysteresis.
 * 
 * Continuous gestures (paint, hover, pinch): enter immediately, require N "exit"
 * frames before switching away. This prevents stroke interruption.
 * 
 * Discrete gestures (undo, menu, fist): require M confirmation frames before
 * entering. This prevents accidental triggers.
 */
class GestureStabilizer {
  constructor() {
    this.stable = 'unknown';
    this.exitCount = 0;       // Consecutive non-current frames
    this.entryType = null;    // Which discrete gesture we're trying to enter
    this.entryCount = 0;      // Consecutive frames of entryType

    this.EXIT_FRAMES = 6;     // Frames before leaving paint/hover/pinch
    this.ENTRY_FRAMES = 5;    // Frames before entering undo/menu/fist
  }

  /**
   * Feed a raw gesture type and get the stabilized type back.
   */
  update(rawType) {
    // Same as current → reset counters
    if (rawType === this.stable) {
      this.exitCount = 0;
      this.entryType = null;
      this.entryCount = 0;
      return this.stable;
    }

    // Different from current
    this.exitCount++;

    // For continuous gestures (paint, hover, pinch): require exit threshold
    const isContinuous = ['paint', 'hover', 'pinch'].includes(this.stable);
    if (isContinuous && this.exitCount < this.EXIT_FRAMES) {
      return this.stable; // Stay — not enough exit evidence
    }

    // For entering discrete gestures: require entry threshold
    const isDiscrete = ['undo', 'menu', 'fist'].includes(rawType);
    if (isDiscrete) {
      if (this.entryType !== rawType) {
        this.entryType = rawType;
        this.entryCount = 1;
      } else {
        this.entryCount++;
      }
      if (this.entryCount < this.ENTRY_FRAMES) {
        return this.stable; // Not enough entry evidence
      }
    }

    // For non-discrete target (or threshold met): switch immediately
    // UNLESS we're currently painting and target is 'unknown'
    // (unknown is noisy, give it extra exit frames)
    if (this.stable === 'paint' && rawType === 'unknown' && this.exitCount < this.EXIT_FRAMES + 4) {
      return this.stable;
    }

    // Switch
    this.stable = rawType;
    this.exitCount = 0;
    this.entryType = null;
    this.entryCount = 0;
    return this.stable;
  }

  /** Force-reset (e.g. hand lost) */
  reset() {
    this.stable = 'unknown';
    this.exitCount = 0;
    this.entryType = null;
    this.entryCount = 0;
  }
}

class HandPaintApp {
  constructor() {
    this.tracker = new HandTracker();
    this.engine = null;
    this.ui = new UI();
    this.stabilizer = new GestureStabilizer();

    // Gesture state
    this.currentGesture = 'unknown';
    this.isDrawing = false;

    // Action debounce timers
    this.lastUndoTime = 0;
    this.lastMenuToggle = 0;
    this.undoDebounce = 1200;
    this.menuDebounce = 1000;

    // Fist timer
    this.fistStartTime = 0;
    this.fistHoldRequired = 1500;
    this.fistCleared = false;

    // Pinch + vertical brush size control
    this.pinchActive = false;
    this.pinchStartY = null;
    this.pinchBaseSize = 8;

    // Render loop
    this._rafId = null;
  }

  async start() {
    console.log('[HandPaint] Starting v2...');

    const canvasEl = document.getElementById('paintCanvas');
    this.engine = new PaintEngine(canvasEl);

    // Wire up renderers: camera frame and skeleton overlay
    this.engine.cameraRenderer = (ctx, w, h) => {
      this.tracker.drawCameraFrame(ctx, w, h);
    };
    this.engine.skeletonRenderer = (ctx, w, h) => {
      this.tracker.drawSkeleton(ctx, w, h);
    };

    // Setup UI
    this._bindUI();

    // Initialize tracker
    const videoEl = document.getElementById('webcam');
    try {
      await this.tracker.initialize(videoEl, (pct, text) => {
        this.ui.setLoadingProgress(pct, text);
      });

      this.tracker.onResults = (results, ts) => this._onFrame(results, ts);

      this.ui.hideLoading();
      this._startRenderLoop();

      console.log('[HandPaint] Ready!');
    } catch (err) {
      console.error('[HandPaint] Init failed:', err);
      this.ui.showError(err.message);
      this.ui.onRetry(() => { this.ui.hideError(); this.start(); });
    }
  }

  /* ---- UI bindings ---- */

  _bindUI() {
    this.ui.onColorSelect(color => {
      this.engine.setColor(color);
      this.ui.setBrushColor(color);
    });

    this.ui.onAction('undo', () => this._doUndo());
    this.ui.onAction('redo', () => this._doRedo());
    this.ui.onAction('clear', () => this._doClear());
    this.ui.onAction('save', () => this._doSave());
    this.ui.onAction('palette', () => this.ui.togglePalette());

    // Opacity sliders
    this.ui.onCameraOpacity(val => this.engine.setCameraOpacity(val));
  }

  /* ---- Render loop (60fps composite) ---- */

  _startRenderLoop() {
    const loop = () => {
      this.engine.compositeFrame();

      // Update FPS in HUD
      this.ui.setPipStatus(`${this.tracker.fps} FPS · ${this.tracker.detectionTime.toFixed(0)}ms`);

      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  /* ---- MediaPipe results callback (30fps) ---- */

  _onFrame(results, timestamp) {
    const paintHand = this.tracker.getPaintHand();
    if (!paintHand) {
      this.ui.setGesture('Searching...', '#888');
      if (this.isDrawing) { this.engine.endStroke(); this.isDrawing = false; }
      this.stabilizer.reset();
      return;
    }

    const landmarks = paintHand.landmarks;
    const rawGesture = classifyGesture(landmarks);
    const stableType = this.stabilizer.update(rawGesture.type);

    // Build a stabilized gesture object using the raw gesture's data
    // but the stabilized type
    const stableGesture = { ...rawGesture, type: stableType };

    this._handleGesture(stableGesture, landmarks, timestamp);
    this.currentGesture = stableType;
  }

  _handleGesture(gesture, landmarks, timestamp) {
    const { type, data } = gesture;

    switch (type) {
      case 'paint':
        this._handlePaint(data);
        this.ui.setGesture('🎨 Paint', '#ff1493');
        break;
      case 'hover':
        this._handleHover();
        this.ui.setGesture('👆 Hover', '#00bfff');
        break;
      case 'fist':
        this._handleFist(timestamp);
        this.ui.setGesture('✊ Fist', '#ff4444');
        break;
      case 'undo':
        this._handleUndoGesture(timestamp);
        this.ui.setGesture('↩ Undo', '#ffd700');
        break;
      case 'menu':
        this._handleMenuGesture(timestamp);
        this.ui.setGesture('🖐 Menu', '#ff8c00');
        break;
      case 'pinch':
        this._handlePinch(data);
        this.ui.setGesture('🤏 Brush', '#ff69b4');
        break;
      default:
        if (this.isDrawing) { this.engine.endStroke(); this.isDrawing = false; }
        this.ui.setGesture('···', '#888');
        break;
    }

    if (type !== 'fist') {
      this.fistStartTime = 0;
      this.fistCleared = false;
    }
  }

  /* ---- Gesture handlers ---- */

  _handlePaint(data) {
    if (!data || !data.position) return;

    const cw = this.engine.canvas.clientWidth;
    const ch = this.engine.canvas.clientHeight;
    if (cw <= 0 || ch <= 0) return;

    const pos = mapToCanvas(data.position, cw, ch);

    // Reset pinch state when entering paint mode
    this.pinchActive = false;
    this.pinchStartY = null;

    if (!this.isDrawing) {
      this.engine.startStroke(pos);
      this.isDrawing = true;
    } else {
      this.engine.continueStroke(pos);
    }
  }

  _handleHover() {
    if (this.isDrawing) { this.engine.endStroke(); this.isDrawing = false; }
  }

  _handleFist(timestamp) {
    if (this.isDrawing) { this.engine.endStroke(); this.isDrawing = false; }

    if (this.fistStartTime === 0) {
      this.fistStartTime = timestamp;
      this.fistCleared = false;
    }

    const elapsed = timestamp - this.fistStartTime;
    const remaining = Math.ceil((this.fistHoldRequired - elapsed) / 1000);
    if (remaining > 0) {
      this.ui.setGesture(`✊ Hold ${remaining}s to clear`, '#ff4444');
    }

    if (elapsed >= this.fistHoldRequired && !this.fistCleared) {
      this._doClear();
      this.fistCleared = true;
    }
  }

  _handleUndoGesture(timestamp) {
    if (this.isDrawing) { this.engine.endStroke(); this.isDrawing = false; }
    if (timestamp - this.lastUndoTime > this.undoDebounce) {
      this._doUndo();
      this.lastUndoTime = timestamp;
    }
  }

  _handleMenuGesture(timestamp) {
    if (this.isDrawing) { this.engine.endStroke(); this.isDrawing = false; }
    if (timestamp - this.lastMenuToggle > this.menuDebounce) {
      this.ui.togglePalette();
      this.lastMenuToggle = timestamp;
    }
  }

  _handlePinch(data) {
    if (this.isDrawing) { this.engine.endStroke(); this.isDrawing = false; }
    if (!data || !data.position) return;

    // Brush size controlled by vertical movement during pinch
    const y = data.position.y; // Normalized 0..1 (0 = top, 1 = bottom)

    if (!this.pinchActive) {
      // Pinch just started — record starting position and base size
      this.pinchActive = true;
      this.pinchStartY = y;
      this.pinchBaseSize = this.engine.brush.size;
    } else {
      // Moving: size = base + delta based on vertical displacement
      // Moving UP (y decreases) = bigger brush
      // Moving DOWN (y increases) = smaller brush
      const deltaY = this.pinchStartY - y; // Positive = moving up
      const sensitivity = 60; // How much Y movement affects brush size
      const newSize = this.pinchBaseSize + deltaY * sensitivity;
      const clamped = Math.max(2, Math.min(60, Math.round(newSize)));

      this.engine.setSize(clamped);
      this.ui.setBrushSize(clamped);
    }

    // Show current size in gesture label
    this.ui.setGesture(`🤏 ${Math.round(this.engine.brush.size)}px`, '#ff69b4');
  }

  /* ---- Actions ---- */

  _doUndo() {
    if (this.engine.undo()) {
      this.ui.setGesture('↩ Undone!', '#ffd700');
      setTimeout(() => this.ui.setGesture(this.currentGesture || 'Ready', '#888'), 600);
    }
  }

  _doRedo() {
    if (this.engine.redo()) {
      this.ui.setGesture('↪ Redone!', '#ffd700');
      setTimeout(() => this.ui.setGesture(this.currentGesture || 'Ready', '#888'), 600);
    }
  }

  _doClear() {
    this.engine.clear();
    this.ui.setGesture('🗑 Cleared!', '#ff4444');
    setTimeout(() => this.ui.setGesture(this.currentGesture || 'Ready', '#888'), 800);
  }

  _doSave() {
    this.engine.download();
    this.ui.setGesture('💾 Saved!', '#00ff7f');
    setTimeout(() => this.ui.setGesture(this.currentGesture || 'Ready', '#888'), 800);
  }
}

// Boot
const app = new HandPaintApp();
app.start().catch(err => console.error('[HandPaint] Fatal:', err));
