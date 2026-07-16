// main.js — Uses pre-trained gestures from GestureRecognizer

import { HandTracker } from './handTracking.js';
import { PaintEngine } from './canvas.js';
import { toCanvas } from './gestures.js';

const $ = id => document.getElementById(id);

class Stabilizer {
  constructor() { this.s = 'none'; this.exit = 0; this.entry = null; this.ec = 0; }
  update(raw) {
    if (raw === this.s) { this.exit = 0; this.entry = null; this.ec = 0; return this.s; }
    this.exit++;
    if (['paint','hover','pinch'].includes(this.s) && this.exit < 10) return this.s;
    if (this.s === 'paint' && raw === 'none' && this.exit < 16) return this.s;
    if (['fist','menu'].includes(raw)) {
      if (this.entry !== raw) { this.entry = raw; this.ec = 1; }
      else this.ec++;
      if (this.ec < (raw === 'fist' ? 12 : 8)) return this.s;
    }
    this.s = raw; this.exit = 0; this.entry = null; this.ec = 0; return this.s;
  }
  reset() { this.s = 'none'; this.exit = 0; this.entry = null; this.ec = 0; }
}

class App {
  constructor() {
    this.tracker = new HandTracker();
    this.engine = null;
    this.stab = new Stabilizer();
    this.drawing = false; this.lost = 0; this.lastPos = null;
    this.pinchOn = false; this.pinchY0 = 0; this.pinchBase = 8;
    this.fistClear = 0;
    this.waveX = []; this.waveLast = 0;
  }

  async start() {
    this.engine = new PaintEngine($('canvas'));
    this.engine.camFn = (ctx, w, h) => this.tracker.drawCamera(ctx, w, h);
    this.engine.skelFn = (ctx, w, h) => this.tracker.drawSkeleton(ctx, w, h);
    this._ui();
    try {
      await this.tracker.init($('webcam'), (n, t) => { $('loadingFill').style.width = n + '%'; $('loadingText').textContent = t; });
      this.tracker.onResults = (r, ts) => this._onFrame(r, ts);
      $('loading').classList.add('hidden');
      this._render();
    } catch (e) {
      $('loading').classList.add('hidden');
      $('error').classList.remove('hidden');
      $('errorMsg').textContent = e.message;
      $('btnRetry').onclick = () => { $('error').classList.add('hidden'); $('loading').classList.remove('hidden'); this.start(); };
    }
  }

  _ui() {
    const colors = ['#ff1493','#fff','#f00','#f80','#fd0','#0f0','#0ff','#08f','#00f','#80f','#f0f','#808080','#000'];
    const g = $('colorGrid');
    colors.forEach(c => { const d = document.createElement('div'); d.style.background = c; d.dataset.c = c; if (c === '#ff1493') d.classList.add('active'); g.appendChild(d); });
    g.onclick = e => {
      const t = e.target.closest('[data-c]'); if (!t) return;
      this.engine.setColor(t.dataset.c);
      g.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
      t.classList.add('active');
    };
    $('camOpacity').oninput = e => { this.engine.camAlpha = +e.target.value; $('camOpacityVal').textContent = Math.round(+e.target.value * 100) + '%'; };
    $('btnUndo').onclick = () => this.engine.undo();
    $('btnClear').onclick = () => this.engine.clear();
    $('btnSave').onclick = () => this.engine.download();
    $('btnPalette').onclick = () => $('palette').classList.toggle('hidden');
  }

  _render() {
    this.engine.frame();
    $('fps').textContent = this.tracker.fps + ' fps · ' + this.tracker._dt.toFixed(0) + 'ms';
    requestAnimationFrame(() => this._render());
  }

  _onFrame(r, ts) {
    const hand = this.tracker.getHand();
    if (!hand) {
      this.lost++;
      if (this.lost <= 25) { if (this.drawing && this.lastPos) this.engine.move(this.lastPos); $('gestureLabel').textContent = 'Lost ' + (25 - this.lost + 1); return; }
      $('gestureLabel').textContent = 'Searching...';
      if (this.drawing) { this.engine.end(); this.drawing = false; }
      this.stab.reset(); this.pinchOn = false;
      return;
    }
    this.lost = 0;

    // Use pre-trained gesture from the model!
    const rawType = hand.gesture;

    // Custom pinch detection (not in pre-trained set)
    const indexTip = hand.landmarks[8], thumbTip = hand.landmarks[4];
    const dx = indexTip.x - thumbTip.x, dy = indexTip.y - thumbTip.y;
    const pinching = Math.sqrt(dx * dx + dy * dy) < 0.05;
    const gestureType = pinching ? 'pinch' : rawType;

    const st = this.stab.update(gestureType);
    this._act(st, hand, ts);
  }

  _act(type, hand, ts) {
    $('gestureLabel').style.color = '#ff1493';
    const idx = hand.landmarks[8], wrist = hand.landmarks[0];

    switch (type) {
      case 'paint':
        this._paint(idx);
        $('gestureLabel').textContent = '🎨 Paint';
        break;
      case 'hover':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        $('gestureLabel').textContent = '👆 Hover'; $('gestureLabel').style.color = '#0bf';
        break;
      case 'pinch':
        this._pinch(wrist);
        $('gestureLabel').textContent = '🤏 ' + Math.round(this.engine.brush.size) + 'px';
        break;
      case 'fist':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        if (ts - this.fistClear > 1500) { this.engine.clear(); this.fistClear = ts; $('gestureLabel').textContent = '✊ Cleared!'; }
        else $('gestureLabel').textContent = '✊ Fist';
        $('gestureLabel').style.color = '#f44';
        break;
      case 'menu':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        $('palette').classList.toggle('hidden');
        $('gestureLabel').textContent = '🖐 Colors'; $('gestureLabel').style.color = '#f80';
        break;
      default:
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        $('gestureLabel').textContent = '···'; $('gestureLabel').style.color = '#888';
    }
    // Wave for color cycling
    if (hand) this._wave(wrist);
    if (type !== 'pinch') this.pinchOn = false;
  }

  _paint(pos) {
    if (!pos) return;
    const p = toCanvas(pos, this.engine.c.clientWidth, this.engine.c.clientHeight);
    this.lastPos = p; this.pinchOn = false;
    if (!this.drawing) { this.engine.start(p); this.drawing = true; }
    else this.engine.move(p);
  }

  _pinch(pos) {
    if (this.drawing) { this.engine.end(); this.drawing = false; }
    if (!pos) return;
    const y = pos.y;
    if (!this.pinchOn) { this.pinchOn = true; this.pinchY0 = y; this.pinchBase = this.engine.brush.size; }
    else { this.engine.setSize(this.pinchBase + (this.pinchY0 - y) * 60); }
  }

  _wave(wrist) {
    const x = 1 - wrist.x;
    this.waveX.push(x);
    if (this.waveX.length > 25) this.waveX.shift();
    if (this.waveX.length < 25) return;
    let cross = 0, prev = 0;
    for (let i = 1; i < this.waveX.length; i++) {
      const d = this.waveX[i] - this.waveX[i - 1];
      const dir = d > 0.005 ? 1 : d < -0.005 ? -1 : 0;
      if (dir && dir !== prev && prev) cross++;
      if (dir) prev = dir;
    }
    if (cross >= 1) $('gestureLabel').textContent = '👋 Wave ' + cross + '/3';
    const amp = Math.max(...this.waveX) - Math.min(...this.waveX);
    if (cross >= 3 && amp > 0.04 && performance.now() - this.waveLast > 1500) {
      this.waveLast = performance.now(); this.waveX = [];
      const colors = ['#ff1493','#f00','#f80','#fd0','#0f0','#0ff','#08f','#00f','#80f','#fff','#000'];
      const cur = this.engine.brush.color;
      const next = colors[(colors.indexOf(cur) + 1) % colors.length];
      this.engine.setColor(next);
      $('gestureLabel').textContent = '👋 ' + next; $('gestureLabel').style.color = next;
      setTimeout(() => { $('gestureLabel').textContent = 'Ready'; $('gestureLabel').style.color = '#ff1493'; }, 1000);
    }
  }
}

new App().start();
