// main.js — Pre-trained gestures, legend, palette always open

import { HandTracker } from './handTracking.js';
import { PaintEngine } from './canvas.js';
import { toCanvas } from './gestures.js';

const $ = id => document.getElementById(id);
const COLORS = ['#ff1493','#fff','#f00','#f80','#fd0','#0f0','#0ff','#08f','#00f','#80f','#f0f','#808080','#000'];
let colorIdx = 0;

class Stabilizer {
  constructor() { this.s = 'none'; this.exit = 0; this.entry = null; this.ec = 0; }
  update(raw) {
    if (raw === this.s) { this.exit = 0; this.entry = null; this.ec = 0; return this.s; }
    this.exit++;
    if (['paint','pinch'].includes(this.s) && this.exit < 10) return this.s;
    if (this.s === 'paint' && raw === 'none' && this.exit < 16) return this.s;
    if (['clear','undo','redo','nextColor','prevColor'].includes(raw)) {
      if (this.entry !== raw) { this.entry = raw; this.ec = 1; }
      else this.ec++;
      if (this.ec < 8) return this.s;
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
    this.clearLast = 0; this.undoLast = 0; this.redoLast = 0; this.colorLast = 0;
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
    const g = $('colorGrid');
    COLORS.forEach((c, i) => { const d = document.createElement('div'); d.style.background = c; d.dataset.c = c; d.dataset.i = i; if (i === 0) d.classList.add('active'); g.appendChild(d); });
    g.onclick = e => {
      const t = e.target.closest('[data-c]'); if (!t) return;
      colorIdx = +t.dataset.i;
      this.engine.setColor(t.dataset.c);
      g.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
      t.classList.add('active');
    };
    $('camOpacity').oninput = e => { this.engine.camAlpha = +e.target.value; $('camOpacityVal').textContent = Math.round(+e.target.value * 100) + '%'; };
    $('btnClear').onclick = () => this.engine.clear();
    $('btnSave').onclick = () => this.engine.download();
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
      this.stab.reset(); this.pinchOn = false; return;
    }
    this.lost = 0;
    const rawType = hand.gesture;
    // Custom pinch
    const it = hand.landmarks[8], tt = hand.landmarks[4];
    const pinching = Math.hypot(it.x - tt.x, it.y - tt.y) < 0.05;
    const type = pinching ? 'pinch' : rawType;
    const st = this.stab.update(type);
    this._act(st, hand, ts);
  }

  _act(type, hand, ts) {
    $('gestureLabel').style.color = '#ff1493';
    switch (type) {
      case 'paint':
        this._paint(hand.landmarks[8]);
        $('gestureLabel').textContent = '☝️ Paint'; break;
      case 'pinch':
        this._pinch(hand.landmarks[0]);
        $('gestureLabel').textContent = '🤏 ' + Math.round(this.engine.brush.size) + 'px'; break;
      case 'clear':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        if (ts - this.clearLast > 2000) { this.engine.clear(); this.clearLast = ts; $('gestureLabel').textContent = '🖐 Cleared!'; }
        else $('gestureLabel').textContent = '🖐 Clear'; break;
      case 'undo':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        if (ts - this.undoLast > 1200) { this.engine.undo(); this.undoLast = ts; $('gestureLabel').textContent = '👎 Undo'; }
        break;
      case 'redo':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        if (ts - this.redoLast > 1200) { this.engine.redo(); this.redoLast = ts; $('gestureLabel').textContent = '👍 Redo'; }
        break;
      case 'nextColor':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        if (ts - this.colorLast > 1000) { this._nextColor(); this.colorLast = ts; $('gestureLabel').textContent = '✌️ Next'; }
        break;
      case 'prevColor':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        if (ts - this.colorLast > 1000) { this._prevColor(); this.colorLast = ts; $('gestureLabel').textContent = '🤟 Prev'; }
        break;
      default:
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        $('gestureLabel').textContent = '···'; $('gestureLabel').style.color = '#888';
    }
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
    else this.engine.setSize(this.pinchBase + (this.pinchY0 - y) * 60);
  }

  _nextColor() {
    colorIdx = (colorIdx + 1) % COLORS.length;
    this._applyColor();
  }

  _prevColor() {
    colorIdx = (colorIdx - 1 + COLORS.length) % COLORS.length;
    this._applyColor();
  }

  _applyColor() {
    const c = COLORS[colorIdx];
    this.engine.setColor(c);
    const g = $('colorGrid');
    g.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
    const swatch = g.querySelector(`[data-i="${colorIdx}"]`);
    if (swatch) swatch.classList.add('active');
  }
}

new App().start();
