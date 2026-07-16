/* ============================================================
   ui.js — UI controls and overlays
   
   Manages:
   - Loading/error overlays
   - Color palette panel
   - Action buttons
   - Brush HUD
   - PiP preview
   ============================================================ */

export class UI {
  constructor() {
    // Cache DOM refs
    this.el = {
      loading: document.getElementById('loadingOverlay'),
      loadingText: document.getElementById('loadingText'),
      loadingProgress: document.getElementById('loadingProgress'),
      error: document.getElementById('errorOverlay'),
      errorMessage: document.getElementById('errorMessage'),
      retryBtn: document.getElementById('retryBtn'),
      colorPalette: document.getElementById('colorPalette'),
      colorGrid: document.getElementById('colorGrid'),
      quickColors: document.getElementById('quickColors'),
      brushDot: document.getElementById('brushDot'),
      brushSize: document.getElementById('brushSize'),
      gestureLabel: document.getElementById('gestureIndicator'),
      pipCanvas: document.getElementById('pipCanvas'),
      pipStatus: document.getElementById('pipStatus'),
      btnUndo: document.getElementById('btnUndo'),
      btnRedo: document.getElementById('btnRedo'),
      btnClear: document.getElementById('btnClear'),
      btnSave: document.getElementById('btnSave'),
      btnPalette: document.getElementById('btnPalette'),
    };

    // Color palette state
    this.isPaletteOpen = false;
    this._buildColorPalette();
  }

  /* ---- Loading & Error ---- */

  setLoadingProgress(percent, text) {
    this.el.loadingProgress.style.width = percent + '%';
    this.el.loadingText.textContent = text;
  }

  hideLoading() {
    this.el.loading.classList.add('fade-out');
    setTimeout(() => {
      this.el.loading.classList.add('hidden');
    }, 500);
  }

  showError(message) {
    this.el.errorMessage.textContent = message;
    this.el.error.classList.remove('hidden');
  }

  hideError() {
    this.el.error.classList.add('hidden');
  }

  onRetry(callback) {
    this.el.retryBtn.addEventListener('click', callback);
  }

  /* ---- Color Palette ---- */

  _buildColorPalette() {
    // Main color grid: 20 common colors
    const colors = [
      '#FFFFFF', '#FF0000', '#FF4500', '#FF8C00', '#FFD700',
      '#00FF00', '#00FF7F', '#00CED1', '#1E90FF', '#0000FF',
      '#8A2BE2', '#9400D3', '#FF1493', '#FF69B4', '#DC143C',
      '#FF6347', '#FFA500', '#32CD32', '#00BFFF', '#808080',
    ];

    this.el.colorGrid.innerHTML = '';
    colors.forEach(color => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.background = color;
      swatch.dataset.color = color;
      if (color === '#FFFFFF') swatch.classList.add('active');
      this.el.colorGrid.appendChild(swatch);
    });

    // Quick colors row
    const quickColors = [
      '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
      '#FFFF00', '#FF1493', '#00FFFF', '#FF8C00', '#808080'
    ];

    this.el.quickColors.innerHTML = '';
    quickColors.forEach(color => {
      const qc = document.createElement('div');
      qc.className = 'quick-color';
      qc.style.background = color;
      qc.dataset.color = color;
      this.el.quickColors.appendChild(qc);
    });
  }

  /**
   * Bind color selection events.
   * @param {function} onColorSelect - callback(color: string)
   */
  onColorSelect(callback) {
    const handleClick = (e) => {
      const target = e.target.closest('[data-color]');
      if (!target) return;

      const color = target.dataset.color;
      callback(color);

      // Update active state
      document.querySelectorAll('.color-swatch.active').forEach(el => el.classList.remove('active'));
      target.classList.add('active');
    };

    this.el.colorGrid.addEventListener('click', handleClick);
    this.el.quickColors.addEventListener('click', handleClick);
  }

  togglePalette() {
    this.isPaletteOpen = !this.isPaletteOpen;
    if (this.isPaletteOpen) {
      this.el.colorPalette.classList.remove('hidden');
    } else {
      this.el.colorPalette.classList.add('hidden');
    }
  }

  showPalette() {
    if (!this.isPaletteOpen) {
      this.isPaletteOpen = true;
      this.el.colorPalette.classList.remove('hidden');
    }
  }

  hidePalette() {
    if (this.isPaletteOpen) {
      this.isPaletteOpen = false;
      this.el.colorPalette.classList.add('hidden');
    }
  }

  /* ---- Brush HUD ---- */

  setBrushColor(color) {
    this.el.brushDot.style.background = color;
  }

  setBrushSize(size) {
    this.el.brushSize.textContent = Math.round(size) + 'px';
    this.el.brushDot.style.width = Math.min(size * 2, 40) + 'px';
    this.el.brushDot.style.height = Math.min(size * 2, 40) + 'px';
  }

  setGestureLabel(text) {
    this.el.gestureLabel.textContent = text;
  }

  /* ---- PiP Status ---- */

  setPipStatus(text) {
    this.el.pipStatus.textContent = text;
  }

  /* ---- Action buttons ---- */

  onAction(event, callback) {
    const map = {
      undo: this.el.btnUndo,
      redo: this.el.btnRedo,
      clear: this.el.btnClear,
      save: this.el.btnSave,
      palette: this.el.btnPalette,
    };
    const btn = map[event];
    if (btn) {
      btn.addEventListener('click', callback);
    }
  }

  /* ---- Gesture label ---- */

  setGesture(text, color = null) {
    this.el.gestureLabel.textContent = text;
    if (color) {
      this.el.gestureLabel.style.color = color;
    }
  }
}
