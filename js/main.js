/* ============================================================
   main.js — Application orchestrator
   
   Ties together:
   - HandTracker (MediaPipe Holistic)
   - PaintCanvas (drawing engine)
   - Gesture recognition
   - UI management
   ============================================================ */

import { HandTracker } from './handTracking.js';
import { PaintCanvas } from './canvas.js';
import { classifyGesture, mapToCanvas, LM } from './gestures.js';
import { UI } from './ui.js';

class HandPaintApp {
  constructor() {
    this.tracker = new HandTracker();
    this.canvas = null;
    this.ui = new UI();

    // State
    this.currentGesture = null;
    this.previousGesture = null;
    this.gestureHoldTime = 0;
    this.gestureStartTime = 0;

    // Fist timer for clear canvas
    this.fistStartTime = 0;
    this.fistHoldRequired = 1500; // 1.5 seconds
    this.fistCleared = false;

    // Menu gesture debounce
    this.lastMenuToggle = 0;
    this.menuDebounceTime = 800;

    // Save gesture debounce
    this.lastSaveTime = 0;
    this.saveDebounceTime = 1500;

    // Undo gesture debounce
    this.lastUndoTime = 0;
    this.undoDebounceTime = 1000;

    // Gesture stability: require N frames of same gesture before acting
    this.gestureVotes = {};
    this.gestureStabilityFrames = 3;

    // Draw mode tracking
    this.isDrawing = false;
    this.hoverPosition = null;
  }

  /**
   * Initialize and start the application
   */
  async start() {
    console.log('[HandPaint] Starting...');

    // Setup canvas
    const canvasEl = document.getElementById('paintCanvas');
    this.canvas = new PaintCanvas(canvasEl);

    // Setup UI event bindings
    this._bindUI();

    // Initialize tracker
    const videoEl = document.getElementById('webcam');
    try {
      await this.tracker.initialize(videoEl, (pct, text) => {
        this.ui.setLoadingProgress(pct, text);
      });

      // Set results callback
      this.tracker.onResults = (results, timestamp) => {
        this._onFrame(results, timestamp);
      };

      // Hide loading, start PiP rendering
      this.ui.hideLoading();
      this._startPiPRender();

      console.log('[HandPaint] Ready!');
    } catch (err) {
      console.error('[HandPaint] Initialization failed:', err);
      this.ui.showError(err.message);
      this.ui.onRetry(() => {
        this.ui.hideError();
        this.start();
      });
    }
  }

  /**
   * Bind UI button events
   */
  _bindUI() {
    this.ui.onColorSelect(color => {
      this.canvas.setColor(color);
      this.ui.setBrushColor(color);
    });

    this.ui.onAction('undo', () => this._doUndo());
    this.ui.onAction('redo', () => this._doRedo());
    this.ui.onAction('clear', () => this._doClear());
    this.ui.onAction('save', () => this._doSave());
    this.ui.onAction('palette', () => this.ui.togglePalette());
  }

  /* ---- Frame Processing ---- */

  /**
   * Called on every processed frame from MediaPipe
   */
  _onFrame(results, timestamp) {
    // Get the preferred painting hand
    const paintHand = this.tracker.getPaintHand();
    if (!paintHand) {
      this._setGestureState('searching', '#888');
      // If we were drawing, stop
      if (this.isDrawing) {
        this.canvas.endStroke();
        this.isDrawing = false;
      }
      return;
    }

    const landmarks = paintHand.landmarks;

    // Classify gesture
    const gesture = classifyGesture(landmarks);
    const stableGesture = this._getStableGesture(gesture.type);

    // Act on gesture
    this._handleGesture(gesture, landmarks, timestamp);

    // Update gesture display
    this.previousGesture = this.currentGesture;
    this.currentGesture = gesture.type;
  }

  /**
   * Get a stable gesture by requiring N consecutive frames of the same type
   */
  _getStableGesture(type) {
    // Reset votes on different gesture
    if (this.previousGesture !== type) {
      this.gestureVotes = {};
      this.gestureHoldTime = 0;
      this.gestureStartTime = performance.now();
      return this.previousGesture; // Use previous until stable
    }

    // Increment vote
    this.gestureVotes[type] = (this.gestureVotes[type] || 0) + 1;
    this.gestureHoldTime = performance.now() - this.gestureStartTime;

    if (this.gestureVotes[type] >= this.gestureStabilityFrames) {
      return type; // Stable
    }

    return this.previousGesture || type;
  }

  /**
   * Handle the classified gesture
   */
  _handleGesture(gesture, landmarks, timestamp) {
    const type = gesture.type;
    const data = gesture.data;

    switch (type) {
      case 'paint':
        this._handlePaint(data, landmarks);
        this._setGestureState('🎨 Paint', '#ff1493');
        break;

      case 'hover':
        this._handleHover(data, landmarks);
        this._setGestureState('👆 Hover', '#00bfff');
        break;

      case 'fist':
        this._handleFist(timestamp);
        this._setGestureState('✊ Fist', '#ff4444');
        break;

      case 'undo':
        this._handleUndoGesture(timestamp);
        this._setGestureState('↩ Undo', '#ffd700');
        break;

      case 'save':
        this._handleSaveGesture(timestamp);
        this._setGestureState('👍 Save', '#00ff7f');
        break;

      case 'menu':
        this._handleMenuGesture(timestamp);
        this._setGestureState('🖐 Menu', '#ff8c00');
        break;

      case 'pinch':
        this._handlePinch(data, landmarks);
        this._setGestureState('🤏 Brush', '#ff69b4');
        break;

      default:
        // If we were drawing, stop
        if (this.isDrawing) {
          this.canvas.endStroke();
          this.isDrawing = false;
        }
        this._setGestureState('...', '#888');
        break;
    }

    // Reset fist timer if gesture changed from fist
    if (type !== 'fist') {
      this.fistStartTime = 0;
      this.fistCleared = false;
    }
  }

  /* ---- Gesture Handlers ---- */

  _handlePaint(data, landmarks) {
    if (!data || !data.position) return;

    const pos = mapToCanvas(
      data.position,
      this.canvas.canvas.clientWidth,
      this.canvas.canvas.clientHeight
    );

    // Update brush size from thumb-index distance
    if (data.brushSize) {
      this.canvas.setSize(data.brushSize);
      this.ui.setBrushSize(data.brushSize);
    }

    if (!this.isDrawing) {
      this.canvas.startStroke(pos);
      this.isDrawing = true;
    } else {
      this.canvas.continueStroke(pos);
    }

    this.hoverPosition = pos;
  }

  _handleHover(data, landmarks) {
    if (this.isDrawing) {
      this.canvas.endStroke();
      this.isDrawing = false;
    }

    if (data && data.position) {
      this.hoverPosition = mapToCanvas(
        data.position,
        this.canvas.canvas.clientWidth,
        this.canvas.canvas.clientHeight
      );
    }
  }

  _handleFist(timestamp) {
    // Stop drawing if we were
    if (this.isDrawing) {
      this.canvas.endStroke();
      this.isDrawing = false;
    }

    // Start tracking fist duration
    if (this.fistStartTime === 0) {
      this.fistStartTime = timestamp;
      this.fistCleared = false;
    }

    const elapsed = timestamp - this.fistStartTime;
    this.ui.setGesture('✊ Hold to clear... ' + Math.max(0, Math.ceil((this.fistHoldRequired - elapsed) / 1000)) + 's', '#ff4444');

    // Trigger clear after holding fist for required duration
    if (elapsed >= this.fistHoldRequired && !this.fistCleared) {
      this._doClear();
      this.fistCleared = true;
    }
  }

  _handleUndoGesture(timestamp) {
    if (this.isDrawing) {
      this.canvas.endStroke();
      this.isDrawing = false;
    }

    // Debounce undo
    if (timestamp - this.lastUndoTime > this.undoDebounceTime) {
      this._doUndo();
      this.lastUndoTime = timestamp;
    }
  }

  _handleSaveGesture(timestamp) {
    if (this.isDrawing) {
      this.canvas.endStroke();
      this.isDrawing = false;
    }

    // Debounce save
    if (timestamp - this.lastSaveTime > this.saveDebounceTime) {
      this._doSave();
      this.lastSaveTime = timestamp;
    }
  }

  _handleMenuGesture(timestamp) {
    if (this.isDrawing) {
      this.canvas.endStroke();
      this.isDrawing = false;
    }

    // Debounce menu toggle
    if (timestamp - this.lastMenuToggle > this.menuDebounceTime) {
      this.ui.togglePalette();
      this.lastMenuToggle = timestamp;
    }
  }

  _handlePinch(data, landmarks) {
    if (this.isDrawing) {
      this.canvas.endStroke();
      this.isDrawing = false;
    }

    // Use pinch distance for brush size
    if (data && data.brushSize) {
      this.canvas.setSize(data.brushSize);
      this.ui.setBrushSize(data.brushSize);
    }
  }

  /* ---- Actions ---- */

  _doUndo() {
    if (this.canvas.undo()) {
      this.ui.setGesture('↩ Undone!', '#ffd700');
      setTimeout(() => this.ui.setGesture(this.currentGesture || 'Ready', '#888'), 600);
    }
  }

  _doRedo() {
    if (this.canvas.redo()) {
      this.ui.setGesture('↪ Redone!', '#ffd700');
      setTimeout(() => this.ui.setGesture(this.currentGesture || 'Ready', '#888'), 600);
    }
  }

  _doClear() {
    this.canvas.clear();
    this.ui.setGesture('🗑 Cleared!', '#ff4444');
    setTimeout(() => this.ui.setGesture(this.currentGesture || 'Ready', '#888'), 800);
  }

  _doSave() {
    this.canvas.download();
    this.ui.setGesture('💾 Saved!', '#00ff7f');
    setTimeout(() => this.ui.setGesture(this.currentGesture || 'Ready', '#888'), 800);
  }

  /* ---- Helpers ---- */

  _setGestureState(text, color) {
    this.ui.setGesture(text, color);
  }

  /**
   * Start the Picture-in-Picture preview render loop
   */
  _startPiPRender() {
    const pipCanvas = this.ui.el.pipCanvas;
    const pipCtx = pipCanvas.getContext('2d');
    const pipW = pipCanvas.width;
    const pipH = pipCanvas.height;

    const renderPip = () => {
      this.tracker.drawPreview(pipCtx, pipW, pipH);

      // Update status with FPS and detection time
      const fps = this.tracker.fps;
      const dt = this.tracker.detectionTime.toFixed(1);
      const delegate = 'GPU'; // We try GPU first
      this.ui.setPipStatus(`${fps} FPS · ${dt}ms · ${delegate}`);

      requestAnimationFrame(renderPip);
    };

    requestAnimationFrame(renderPip);
  }
}

// Boot the app
const app = new HandPaintApp();
app.start().catch(err => {
  console.error('[HandPaint] Fatal error:', err);
});
