/* ============================================================
   main.js — Application orchestrator v2
   
   - Render loop at 60fps compositing camera→paint→skeleton
   - Gesture handling at 30fps from MediaPipe
   - Opacity controls for camera background and skeleton overlay
   ============================================================ */

import { HandTracker } from './handTracking.js';
import { PaintEngine } from './canvas.js';
import { classifyGesture, mapToCanvas } from './gestures.js';
import { UI } from './ui.js';

class HandPaintApp {
  constructor() {
    this.tracker = new HandTracker();
    this.engine = null;
    this.ui = new UI();

    // Gesture state
    this.currentGesture = 'unknown';
    this.previousGesture = null;
    this.isDrawing = false;

    // Action debounce timers
    this.lastUndoTime = 0;
    this.lastMenuToggle = 0;
    this.undoDebounce = 1000;
    this.menuDebounce = 800;

    // Fist timer
    this.fistStartTime = 0;
    this.fistHoldRequired = 1500;
    this.fistCleared = false;

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
    this.ui.onSkeletonOpacity(val => this.engine.setSkeletonOpacity(val));
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
      return;
    }

    const landmarks = paintHand.landmarks;
    const gesture = classifyGesture(landmarks);
    this._handleGesture(gesture, landmarks, timestamp);

    this.previousGesture = this.currentGesture;
    this.currentGesture = gesture.type;
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

    // Update brush size from gesture data
    if (data.brushSize) {
      this.engine.setSize(data.brushSize);
      this.ui.setBrushSize(data.brushSize);
    }

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
    if (data && data.brushSize) {
      this.engine.setSize(data.brushSize);
      this.ui.setBrushSize(data.brushSize);
    }
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
