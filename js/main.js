// main.js v5.2 — Dynamic roles: pincher=clicker, other=pointer

import { HandTracker } from './handTracking.js';
import { PaintEngine } from './canvas.js';
import { toCanvas } from './gestures.js';
import { PinchClickFSM, PINCH_CLOSE } from './interaction.js';

const $ = id => document.getElementById(id);
const COLORS = ['#ff1493','#fff','#f00','#f80','#fd0','#0f0','#0ff','#08f','#00f','#80f','#f0f','#808080','#000'];
let colorIdx = 0, activeTool = 'brush';

function isPointing(lm) {
  if (!lm || lm.length < 21) return false;
  const wt = Math.hypot(lm[0].x - lm[8].x, lm[0].y - lm[8].y);
  const wp = Math.hypot(lm[0].x - lm[6].x, lm[0].y - lm[6].y);
  return wt > wp * 1.05;
}

class App {
  constructor() {
    this.tracker = new HandTracker();
    this.engine = null;
    this.fsm = new PinchClickFSM();
    this.pointerPx = null;
    this.pointerHand = null;  // hand data for pointer
    this.clickerHand = null;  // hand data for clicker
    this.drawing = false;
    this.pressTarget = null;
    this.lost = 0;
    this.pinchNow = false;
  }

  async start() {
    this.engine = new PaintEngine($('canvas'));
    this.engine.camFn = (ctx, w, h) => this.tracker.drawCamera(ctx, w, h);
    this.engine.skelFn = (ctx, w, h) => {
      const hands = [this.pointerHand, this.clickerHand].filter(Boolean);
      this.tracker.drawSkeletons(ctx, w, h, hands);
    };
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
    document.querySelectorAll('.tool-btn').forEach(b => {
      if (b.dataset.tool === 'brush') b.classList.add('active');
      b.onclick = () => {
        document.querySelectorAll('.tool-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); activeTool = b.dataset.tool;
        this.engine.setMode(activeTool === 'eraser' ? 'erase' : 'draw');
        $('gestureLabel').textContent = { brush: '🖌️', eraser: '🧹', fill: '🪣' }[activeTool] || '';
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
    // Draw mouse cursor at pointer position
    if (this.pointerPx) {
      const ctx = this.engine.ctx, x = this.pointerPx.x, y = this.pointerPx.y;
      // Cursor shadow
      ctx.fillStyle = '#00000080';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y + 12); ctx.lineTo(x + 10, y + 16); ctx.lineTo(x + 12, y + 22); ctx.lineTo(x + 4, y + 20); ctx.lineTo(x, y + 28); ctx.closePath(); ctx.fill();
      // Cursor body (arrow)
      ctx.fillStyle = this.pinchNow ? '#ff1493' : '#fff';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 14, y + 10); ctx.lineTo(x + 9, y + 14); ctx.lineTo(x + 10, y + 19); ctx.lineTo(x + 3, y + 17); ctx.lineTo(x, y + 24); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    }
    requestAnimationFrame(() => this._render());
  }

  _onFrame() {
    const hands = this.tracker.getHands();
    if (hands.length === 0) {
      this.lost++;
      if (this.lost > 25) {
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        this.fsm.reset(); this.pointerPx = null; this.pointerHand = null; this.clickerHand = null; this.pressTarget = null;
      }
      $('gestureLabel').textContent = this.lost > 25 ? 'Searching...' : 'Lost ' + (25 - this.lost + 1);
      return;
    }
    this.lost = 0;

    // Dynamic role assignment: pincher = clicker, other = pointer
    const pinchingIdx = hands.findIndex(h => h.pinchDist < PINCH_CLOSE);
    let ptrIdx, clkIdx;

    if (pinchingIdx >= 0) {
      // One hand is pinching: it's the clicker, find another hand for pointer
      clkIdx = pinchingIdx;
      ptrIdx = hands.findIndex((h, i) => i !== pinchingIdx && isPointing(h.landmarks));
      if (ptrIdx < 0) ptrIdx = hands.findIndex((h, i) => i !== pinchingIdx); // any other hand
      if (ptrIdx < 0) ptrIdx = pinchingIdx; // only one hand, does both
    } else {
      // No hand pinching: first pointing hand = pointer, other = clicker (or same)
      ptrIdx = hands.findIndex(h => isPointing(h.landmarks));
      if (ptrIdx < 0) ptrIdx = 0;
      clkIdx = hands.length > 1 ? (ptrIdx === 0 ? 1 : 0) : ptrIdx;
    }

    this.pointerHand = hands[ptrIdx];
    this.clickerHand = hands[clkIdx];
    this.pointerPx = toCanvas(hands[ptrIdx].pointer, this.engine.c.clientWidth, this.engine.c.clientHeight);
    this.pinchNow = hands[clkIdx].pinchDist < PINCH_CLOSE;

    // FSM on clicker hand
    const fsmR = this.fsm.update(hands[clkIdx].pinchDist, performance.now());
    this._handleClick(fsmR);

    // Update gesture label
    const ptrLabel = ptrIdx === clkIdx ? '1 hand' : '2 hands';
    $('gestureLabel').textContent = ptrLabel + ' | ' + (this.pinchNow ? '✊ pinching' : '✋ open');
  }

  _handleClick(fsmR) {
    if (!this.pointerPx) return;
    const px = this.pointerPx;
    const el = document.elementFromPoint(px.x, px.y);
    const target = el?.closest('[data-hand]') || el?.closest('.tool-btn') || null;

    // UI click
    if (fsmR.event === 'press' && target) {
      target.classList.add('hand-press'); this.pressTarget = target;
    }
    if (fsmR.event === 'release' && this.pressTarget) {
      const t = this.pressTarget; t.classList.remove('hand-press');
      const rect = t.getBoundingClientRect();
      if (px && px.x >= rect.left - 40 && px.x <= rect.right + 40 && px.y >= rect.top - 40 && px.y <= rect.bottom + 40) {
        t.classList.add('hand-click'); t.addEventListener('animationend', () => t.classList.remove('hand-click'), { once: true }); t.click();
      }
      this.pressTarget = null;
    }
    if (fsmR.event === 'cancel') { if (this.pressTarget) { this.pressTarget.classList.remove('hand-press'); this.pressTarget = null; } }

    // Canvas draw (only when NOT over UI)
    if (!target && !this.pressTarget) {
      if (fsmR.event === 'press') {
        if (activeTool === 'fill') {
          this.engine.clear();
          this.engine.pctx.fillStyle = COLORS[colorIdx];
          this.engine.pctx.fillRect(0, 0, this.engine.paint.width, this.engine.paint.height);
        } else {
          this.engine.setColor(COLORS[colorIdx]);
          this.engine.start(px); this.drawing = true;
        }
      } else if (this.drawing && this.pinchNow) {
        this.engine.move(px);
      } else if (this.drawing && !this.pinchNow) {
        this.engine.end(); this.drawing = false;
      }
    }
  }
}

new App().start();
