// main.js — Orchestrator

import { HandTracker } from './handTracking.js';
import { PaintEngine } from './canvas.js';
import { classify as cl, toCanvas } from './gestures.js';

const $ = id => document.getElementById(id);

// ---- Stabilizer with hysteresis ----
class Stabilizer {
  constructor() {
    this.s = 'none';
    this.exit = 0;
    this.entry = null; this.ec = 0;
  }
  update(raw) {
    if (raw === this.s) { this.exit = 0; this.entry = null; this.ec = 0; return this.s; }
    this.exit++;
    const cont = ['paint', 'hover', 'pinch'].includes(this.s);
    if (cont && this.exit < 8) return this.s;
    if (this.s === 'paint' && raw === 'none' && this.exit < 14) return this.s;
    const disc = ['undo', 'menu', 'fist'].includes(raw);
    if (disc) {
      if (this.entry !== raw) { this.entry = raw; this.ec = 1; }
      else this.ec++;
      if (this.ec < 5) return this.s;
    }
    this.s = raw; this.exit = 0; this.entry = null; this.ec = 0;
    return this.s;
  }
  reset() { this.s = 'none'; this.exit = 0; this.entry = null; this.ec = 0; }
}

// ---- App ----
class App {
  constructor() {
    this.tracker = new HandTracker();
    this.engine = null;
    this.stab = new Stabilizer();
    this.gesture = 'none';
    this.drawing = false;
    this.lost = 0;
    this.lastPos = null;
    // Pinch brush
    this.pinchOn = false;
    this.pinchY0 = 0;
    this.pinchBase = 8;
    // Wave detection
    this.waveX = [];
    this.waveLast = 0;
    // Debounce
    this.undoLast = 0;
    this.menuLast = 0;
  }

  async start() {
    this.engine = new PaintEngine($('canvas'));
    this.engine.camFn = (ctx, w, h) => this.tracker.drawCamera(ctx, w, h);
    this.engine.skelFn = (ctx, w, h) => this.tracker.drawSkeleton(ctx, w, h);
    this._ui();
    const video = $('webcam');
    try {
      await this.tracker.init(video, (n, t) => { $('loadingFill').style.width = n + '%'; $('loadingText').textContent = t; });
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
      if (this.lost <= 25) {
        if (this.drawing && this.lastPos) this.engine.move(this.lastPos);
        $('gestureLabel').textContent = 'Lost ' + (25 - this.lost + 1);
        return;
      }
      $('gestureLabel').textContent = 'Searching...';
      if (this.drawing) { this.engine.end(); this.drawing = false; }
      this.stab.reset();
      this.pinchOn = false;
      return;
    }
    this.lost = 0;
    const g = cl(hand.landmarks, hand.worldLandmarks);
    const st = this.stab.update(g.type);
    this._act({ ...g, type: st }, ts);
    this.gesture = st;
  }

  _act(g, ts) {
    const { type, pos } = g;
    $('gestureLabel').style.color = '#ff1493';

    switch (type) {
      case 'paint':
        this._paint(pos);
        $('gestureLabel').textContent = '🎨 Paint';
        break;
      case 'hover':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        $('gestureLabel').textContent = '👆 Hover'; $('gestureLabel').style.color = '#0bf';
        break;
      case 'pinch':
        this._pinch(pos);
        $('gestureLabel').textContent = '🤏 ' + Math.round(this.engine.brush.size) + 'px';
        break;
      case 'undo':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        if (ts - this.undoLast > 1200) { this.engine.undo(); this.undoLast = ts; }
        $('gestureLabel').textContent = '↩ Undo'; $('gestureLabel').style.color = '#fd0';
        break;
      case 'menu':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        if (ts - this.menuLast > 1000) { $('palette').classList.toggle('hidden'); this.menuLast = ts; }
        $('gestureLabel').textContent = '🖐 Menu'; $('gestureLabel').style.color = '#f80';
        break;
      case 'fist':
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        $('gestureLabel').textContent = '✊ Fist'; $('gestureLabel').style.color = '#f44';
        break;
      default:
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        $('gestureLabel').textContent = '···'; $('gestureLabel').style.color = '#888';
    }
    // Wave detection
    const h = this.tracker.getHand();
    if (h) this._wave(h.landmarks[0]);
    // Reset pinch
    if (type !== 'pinch') this.pinchOn = false;
  }

  _paint(pos) {
    if (!pos) return;
    const p = toCanvas(pos, this.engine.c.clientWidth, this.engine.c.clientHeight);
    this.lastPos = p;
    this.pinchOn = false;
    if (!this.drawing) { this.engine.start(p); this.drawing = true; }
    else this.engine.move(p);
  }

  _pinch(pos) {
    if (this.drawing) { this.engine.end(); this.drawing = false; }
    if (!pos) return;
    const y = pos.y;
    if (!this.pinchOn) { this.pinchOn = true; this.pinchY0 = y; this.pinchBase = this.engine.brush.size; }
    else { const ns = this.pinchBase + (this.pinchY0 - y) * 60; this.engine.setSize(ns); }
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
    const amp = Math.max(...this.waveX) - Math.min(...this.waveX);
    const now = performance.now();
    if (cross >= 4 && amp > 0.08 && now - this.waveLast > 2500) {
      this.waveLast = now; this.waveX = [];
      if (this.drawing) { this.engine.end(); this.drawing = false; }
      this.engine.clear();
      $('gestureLabel').textContent = '👋 Cleared!'; $('gestureLabel').style.color = '#f80';
      setTimeout(() => { $('gestureLabel').textContent = 'Ready'; $('gestureLabel').style.color = '#ff1493'; }, 1000);
    }
  }
}

new App().start();
