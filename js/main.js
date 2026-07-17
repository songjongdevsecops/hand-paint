// main.js — Pre-trained gestures, legend, palette always open

import { HandTracker } from './handTracking.js';
import { PaintEngine } from './canvas.js';
import { toCanvas } from './gestures.js';
import { PinchClickFSM, withinSlop, SLOP_PX } from './interaction.js';

const $ = id => document.getElementById(id);
const COLORS = ['#ff1493','#fff','#f00','#f80','#fd0','#0f0','#0ff','#08f','#00f','#80f','#f0f','#808080','#000'];
let colorIdx = 0;

class Stabilizer {
  constructor() { this.s = 'none'; this.exit = 0; this.entry = null; this.ec = 0; }
  update(raw) {
    if (raw === this.s) { this.exit = 0; this.entry = null; this.ec = 0; return this.s; }
    this.exit++;
    if (['paint'].includes(this.s) && this.exit < 10) return this.s;
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
    this.fsm = new PinchClickFSM(); this.pressTarget = null; this.uiMode = false;
    this.drawing = false; this.lost = 0; this.lastPos = null;
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
    $('btnSizeUp').onclick = () => this.engine.setSize(this.engine.brush.size + 1);
    $('btnSizeUp').addEventListener('mousedown', e => { e.preventDefault(); const rpt = setInterval(() => this.engine.setSize(this.engine.brush.size + 1), 80); const up = () => { clearInterval(rpt); document.removeEventListener('mouseup', up); }; document.addEventListener('mouseup', up); });
    $('btnSizeDown').onclick = () => this.engine.setSize(this.engine.brush.size - 1);
    $('btnSizeDown').addEventListener('mousedown', e => { e.preventDefault(); const rpt = setInterval(() => this.engine.setSize(this.engine.brush.size - 1), 80); const up = () => { clearInterval(rpt); document.removeEventListener('mouseup', up); }; document.addEventListener('mouseup', up); });
    this._initHandCursor();
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
      this.stab.reset(); this.fsm.reset(); $('handCursor').classList.add('hidden'); this.pressTarget = null; return;
    }
    this.lost = 0;
    const rawType = hand.gesture;

    // Hand cursor tracking (after hand is valid)
    const cursorPx = hand.cursor ? {
      x: (1 - hand.cursor.x) * window.innerWidth,
      y: hand.cursor.y * window.innerHeight
    } : null;

    // Hit-test UI elements
    let target = null;
    if (cursorPx) {
      const el = document.elementFromPoint(cursorPx.x, cursorPx.y);
      target = el?.closest('[data-hand]') || null;
    }

    // UI mode: finger over button OR press is captured
    this.uiMode = (target !== null || this.pressTarget !== null);

    if (this.uiMode) {
      // UI interaction mode
      if (this.drawing) { this.engine.end(); this.drawing = false; }

      const fsmResult = this.fsm.update(hand.pinchDist, ts);
      this._handleUI(cursorPx, target, fsmResult, ts);

      // Skip gesture pipeline when in UI mode
      this.stab.reset();
      $('gestureLabel').textContent = '🖱 UI';
      $('gestureLabel').style.color = '#0bf';
    } else {
      // Painting mode — hide cursor, run normal gesture pipeline
      $('handCursor').classList.add('hidden');
      this.pressTarget = null;
      const st = this.stab.update(rawType);
      this._act(st, hand, ts);
    }
  }

  _act(type, hand, ts) {
    $('gestureLabel').style.color = '#ff1493';
    switch (type) {
      case 'paint':
        this._paint(hand.landmarks[8]);
        $('gestureLabel').textContent = '☝️ Paint'; break;
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
  }

  _paint(pos) {
    if (!pos) return;
    const p = toCanvas(pos, this.engine.c.clientWidth, this.engine.c.clientHeight);
    this.lastPos = p;
    if (!this.drawing) { this.engine.start(p); this.drawing = true; }
    else this.engine.move(p);
  }

  _handleUI(cursorPx, target, fsmResult, ts) {
    const cursor = $('handCursor');

    // Position cursor
    if (cursorPx) {
      cursor.style.left = cursorPx.x + 'px';
      cursor.style.top = cursorPx.y + 'px';
      cursor.classList.remove('hidden');
    }

    // Clear previous hover
    document.querySelectorAll('.hand-hover').forEach(el => {
      if (el !== target) el.classList.remove('hand-hover');
    });

    // Hover state
    if (target && !this.pressTarget) {
      target.classList.add('hand-hover');
      cursor.classList.add('hover');
      cursor.classList.remove('pressed');
    }

    // Press event
    if (fsmResult.event === 'press' && target) {
      this.pressTarget = target;
      target.classList.remove('hand-hover');
      target.classList.add('hand-press');
      cursor.classList.remove('hover');
      cursor.classList.add('pressed');
    }

    // Release event
    if (fsmResult.event === 'release' && this.pressTarget) {
      const pressed = this.pressTarget;
      const rect = pressed.getBoundingClientRect();
      const slopOk = cursorPx && withinSlop(
        { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        cursorPx, SLOP_PX
      );

      pressed.classList.remove('hand-press');
      cursor.classList.remove('pressed');

      if (slopOk) {
        pressed.classList.add('hand-click');
        pressed.addEventListener('animationend', () => pressed.classList.remove('hand-click'), { once: true });
        cursor.classList.add('clicked');
        cursor.addEventListener('animationend', () => cursor.classList.remove('clicked'), { once: true });
        pressed.click(); // Fire click event
      }

      this.pressTarget = null;
    }

    // Cancel (hand lost during press)
    if (fsmResult.event === 'cancel') {
      if (this.pressTarget) {
        this.pressTarget.classList.remove('hand-press');
        this.pressTarget = null;
      }
      cursor.classList.remove('pressed', 'hover');
      cursor.classList.add('hidden');
    }
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

  _initHandCursor() {
    const cursor = $('handCursor');
    document.addEventListener('mousemove', (e) => {
      document.querySelectorAll('.hand-hover,.hand-press').forEach(el => el.classList.remove('hand-hover','hand-press'));
      const target = e.target.closest('[data-hand]');
      if (!target) { cursor.classList.add('hidden'); cursor.classList.remove('hover','pressed'); return; }
      cursor.classList.remove('hidden');
      target.classList.add('hand-hover');
      const rect = target.getBoundingClientRect();
      cursor.style.left = rect.left + rect.width / 2 + 'px';
      cursor.style.top = rect.top + rect.height / 2 + 'px';
    });
    document.addEventListener('mousedown', (e) => {
      const target = e.target.closest('[data-hand]');
      if (!target) return;
      target.classList.remove('hand-hover');
      target.classList.add('hand-press');
      cursor.classList.add('pressed');
    });
    document.addEventListener('mouseup', (e) => {
      document.querySelectorAll('.hand-press').forEach(el => {
        el.classList.remove('hand-press');
        el.classList.add('hand-click');
        el.addEventListener('animationend', () => el.classList.remove('hand-click'), { once: true });
      });
      cursor.classList.remove('pressed');
      cursor.classList.add('clicked');
      cursor.addEventListener('animationend', () => cursor.classList.remove('clicked'), { once: true });
    });
  }
}

new App().start();
