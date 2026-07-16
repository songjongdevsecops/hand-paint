/* ============================================================
   ui.js — UI controls v2
   
   - Loading/error overlays
   - Color palette
   - Action buttons
   - Brush HUD
   - Opacity sliders (camera & skeleton)
   ============================================================ */

export class UI {
  constructor() {
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
      gestureLabel: document.getElementById('gestureLabel'),
      pipStatus: document.getElementById('pipStatus'),
      btnUndo: document.getElementById('btnUndo'),
      btnRedo: document.getElementById('btnRedo'),
      btnClear: document.getElementById('btnClear'),
      btnSave: document.getElementById('btnSave'),
      btnPalette: document.getElementById('btnPalette'),
      cameraOpacitySlider: document.getElementById('cameraOpacitySlider'),
      cameraOpacityVal: document.getElementById('cameraOpacityVal'),
    };

    this.isPaletteOpen = false;
    this._buildColorPalette();
  }

  /* ---- Loading & Error ---- */

  setLoadingProgress(pct, text) {
    this.el.loadingProgress.style.width = pct + '%';
    this.el.loadingText.textContent = text;
  }

  hideLoading() {
    this.el.loading.classList.add('fade-out');
    setTimeout(() => this.el.loading.classList.add('hidden'), 500);
  }

  showError(msg) {
    this.el.errorMessage.textContent = msg;
    this.el.error.classList.remove('hidden');
  }

  hideError() {
    this.el.error.classList.add('hidden');
  }

  onRetry(cb) {
    this.el.retryBtn.addEventListener('click', cb);
  }

  /* ---- Color Palette ---- */

  _buildColorPalette() {
    const colors = [
      '#FF1493','#FFFFFF','#FF0000','#FF4500','#FF8C00','#FFD700',
      '#00FF00','#00FF7F','#00CED1','#1E90FF','#0000FF',
      '#8A2BE2','#9400D3','#FF69B4','#DC143C',
      '#FF6347','#FFA500','#32CD32','#00BFFF','#808080',
    ];

    this.el.colorGrid.innerHTML = '';
    colors.forEach(color => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.background = color;
      swatch.dataset.color = color;
      if (color === '#FF1493') swatch.classList.add('active');
      this.el.colorGrid.appendChild(swatch);
    });

    const quickColors = [
      '#000000','#FFFFFF','#FF1493','#FF0000','#00FF00','#0000FF',
      '#FFFF00','#00FFFF','#FF8C00','#808080'
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

  onColorSelect(cb) {
    const handler = (e) => {
      const target = e.target.closest('[data-color]');
      if (!target) return;
      const color = target.dataset.color;
      cb(color);
      document.querySelectorAll('.color-swatch.active').forEach(el => el.classList.remove('active'));
      target.classList.add('active');
    };
    this.el.colorGrid.addEventListener('click', handler);
    this.el.quickColors.addEventListener('click', handler);
  }

  togglePalette() {
    this.isPaletteOpen = !this.isPaletteOpen;
    this.el.colorPalette.classList.toggle('hidden', !this.isPaletteOpen);
  }

  /* ---- Brush HUD ---- */

  setBrushColor(color) {
    this.el.brushDot.style.background = color;
  }

  setBrushSize(size) {
    this.el.brushSize.textContent = Math.round(size) + 'px';
    this.el.brushDot.style.width = Math.min(size * 2, 36) + 'px';
    this.el.brushDot.style.height = Math.min(size * 2, 36) + 'px';
  }

  setGesture(text, color) {
    this.el.gestureLabel.textContent = text;
    if (color) this.el.gestureLabel.style.color = color;
  }

  setPipStatus(text) {
    this.el.pipStatus.textContent = text;
  }

  /* ---- Opacity sliders ---- */

  onCameraOpacity(cb) {
    this.el.cameraOpacitySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.el.cameraOpacityVal.textContent = Math.round(val * 100) + '%';
      cb(val);
    });
    this.el.cameraOpacityVal.textContent = '5%';
  }

  /* ---- Action buttons ---- */

  onAction(event, cb) {
    const map = {
      undo: this.el.btnUndo,
      redo: this.el.btnRedo,
      clear: this.el.btnClear,
      save: this.el.btnSave,
      palette: this.el.btnPalette,
    };
    const btn = map[event];
    if (btn) btn.addEventListener('click', cb);
  }
}
