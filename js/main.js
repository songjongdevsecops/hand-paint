// main.js v5 — Two-hand pointers, pinch=click, Paint-style toolbar

import { HandTracker } from './handTracking.js';
import { PaintEngine } from './canvas.js';
import { toCanvas } from './gestures.js';
import { PinchClickFSM, withinSlop, SLOP_PX, PINCH_CLOSE } from './interaction.js';

const $ = id => document.getElementById(id);
const COLORS = ['#ff1493','#fff','#f00','#f80','#fd0','#0f0','#0ff','#08f','#00f','#80f','#f0f','#808080','#000'];
let colorIdx = 0, activeTool = 'brush';

class App {
  constructor() {
    this.tracker = new HandTracker();
    this.engine = null;
    this.hands = {}; // handedness → { fsm, drawing, px, target, pressTarget }
    this.lost = 0;
  }

  async start() {
    this.engine = new PaintEngine($('canvas'));
    this.engine.camFn = (ctx, w, h) => this.tracker.drawCamera(ctx, w, h);
    this.engine.skelFn = (ctx, w, h) => this.tracker.drawSkeletons(ctx, w, h, Object.values(this.hands).map(s => s.data).filter(Boolean));
    this._ui();
    try {
      await this.tracker.init($('webcam'), (n, t) => { $('loadingFill').style.width = n + '%'; $('loadingText').textContent = t; });
      this.tracker.onResults = () => this._onFrame();
      $('loading').classList.add('hidden');
      this._render();
    } catch (e) {
      $('loading').classList.add('hidden'); $('error').classList.remove('hidden');
      $('errorMsg').textContent = e.message;
      $('btnRetry').onclick = () => { $('error').classList.add('hidden'); $('loading').classList.remove('hidden'); this.start(); };
    }
  }

  _ui() {
    const g = $('colorGrid');
    COLORS.forEach((c, i) => { const d = document.createElement('div'); d.style.background = c; d.dataset.c = c; d.dataset.i = i; d.setAttribute('data-hand', ''); if (i === 0) d.classList.add('active'); g.appendChild(d); });
    g.onclick = e => { const t = e.target.closest('[data-c]'); if (!t) return; colorIdx = +t.dataset.i; this.engine.setColor(t.dataset.c); g.querySelectorAll('.active').forEach(el => el.classList.remove('active')); t.classList.add('active'); };

    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(b => {
      if (b.dataset.tool === 'brush') b.classList.add('active');
      b.onclick = () => {
        document.querySelectorAll('.tool-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); activeTool = b.dataset.tool;
        this.engine.setMode(activeTool === 'eraser' ? 'erase' : 'draw');
        $('gestureLabel').textContent = { brush: '🖌️ Brush', eraser: '🧹 Eraser', fill: '🪣 Fill' }[activeTool] || '';
      };
    });

    $('btnUndo').onclick = () => this.engine.undo();
    $('btnClear').onclick = () => this.engine.clear();
    $('btnSave').onclick = () => this.engine.download();
    $('btnSizeUp').onclick = () => this.engine.setSize(this.engine.brush.size + 2);
    $('btnSizeDown').onclick = () => this.engine.setSize(this.engine.brush.size - 2);
    $('camOpacity').oninput = e => { this.engine.camAlpha = +e.target.value; $('camOpacityVal').textContent = Math.round(+e.target.value * 100) + '%'; };
  }

  _render() {
    this.engine.frame();
    $('fps').textContent = this.tracker.fps + ' fps';
    // Draw mouse pointers on top (after frame composites everything)
    const ctx = this.engine.ctx, W = this.engine.c.clientWidth, H = this.engine.c.clientHeight;
    for (const [h, s] of Object.entries(this.hands)) {
      if (!s.px) continue;
      const c = h === 'Right' ? '#ff1493' : '#00ffff';
      const r = s.pinching ? 10 : 7;
      // Outer ring
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.px.x, s.px.y, r + 2, 0, Math.PI * 2); ctx.stroke();
      // Inner dot
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(s.px.x, s.px.y, r, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(() => this._render());
  }

  _onFrame() {
    const hands = this.tracker.getHands();
    if (hands.length === 0) {
      this.lost++;
      if (this.lost > 25) {
        for (const s of Object.values(this.hands)) { if (s.drawing) { this.engine.end(); s.drawing = false; } s.fsm?.reset(); }
        this.hands = {};
      }
      $('gestureLabel').textContent = this.lost > 25 ? 'Searching...' : 'Lost ' + (25 - this.lost + 1);
      return;
    }
    this.lost = 0;
    const seen = new Set();
    for (const hand of hands) {
      const h = hand.handedness; seen.add(h);
      if (!this.hands[h]) this.hands[h] = { fsm: new PinchClickFSM(), drawing: false, px: null, target: null, pressTarget: null, pinching: false, data: null };
      const s = this.hands[h];
      s.data = hand;
      s.pinching = hand.pinchDist < PINCH_CLOSE;
      s.px = toCanvas(hand.pointer, this.engine.c.clientWidth, this.engine.c.clientHeight);
      const el = document.elementFromPoint(s.px.x, s.px.y);
      s.target = el?.closest('[data-hand]') || el?.closest('.tool-btn') || null;
      const fsmR = s.fsm.update(hand.pinchDist, performance.now());
      this._handleHand(h, s, fsmR);
    }
    for (const h of Object.keys(this.hands)) {
      if (!seen.has(h)) { const s = this.hands[h]; if (s.drawing) { this.engine.end(); s.drawing = false; } s.fsm?.reset(); delete this.hands[h]; }
    }
    this.engine.skelFn = (ctx, w, h) => this.tracker.drawSkeletons(ctx, w, h, Object.values(this.hands).map(s => s.data).filter(Boolean));
    $('gestureLabel').textContent = hands.length + ' hand' + (hands.length > 1 ? 's' : '');
  }

  _handleHand(h, s, fsmR) {
    // Press over UI
    if (fsmR.event === 'press' && s.target) {
      s.target.classList.add('hand-press'); s.pressTarget = s.target;
    }
    // Release over UI = click
    if (fsmR.event === 'release' && s.pressTarget) {
      const t = s.pressTarget; t.classList.remove('hand-press');
      const rect = t.getBoundingClientRect();
      if (s.px && withinSlop({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, s.px, SLOP_PX)) {
        t.classList.add('hand-click'); t.addEventListener('animationend', () => t.classList.remove('hand-click'), { once: true });
        t.click();
      }
      s.pressTarget = null;
    }
    if (fsmR.event === 'cancel') { if (s.pressTarget) { s.pressTarget.classList.remove('hand-press'); s.pressTarget = null; } }

    // Canvas interaction (only when NOT over UI)
    if (!s.target && !s.pressTarget) {
      if (fsmR.event === 'press') {
        // Start action on canvas
        if (activeTool === 'fill') {
          this.engine.clear();
          const fctx = this.engine.pctx;
          fctx.fillStyle = COLORS[colorIdx];
          fctx.fillRect(0, 0, this.engine.paint.width, this.engine.paint.height);
        } else {
          this.engine.setColor(COLORS[colorIdx]);
          this.engine.start(s.px); s.drawing = true;
        }
      } else if (s.drawing && s.pinching) {
        this.engine.move(s.px);
      } else if (s.drawing && !s.pinching) {
        this.engine.end(); s.drawing = false;
      }
    }
  }
}

new App().start();
