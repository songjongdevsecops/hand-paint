// main.js v5.1 — One hand points, other hand clicks (pinch)

import { HandTracker } from './handTracking.js';
import { PaintEngine } from './canvas.js';
import { toCanvas } from './gestures.js';
import { PinchClickFSM, withinSlop, SLOP_PX, PINCH_CLOSE } from './interaction.js';

const $ = id => document.getElementById(id);
const COLORS = ['#ff1493','#fff','#f00','#f80','#fd0','#0f0','#0ff','#08f','#00f','#80f','#f0f','#808080','#000'];
let colorIdx = 0, activeTool = 'brush';

// Detect if index finger is extended (simple Y-distance check)
function isPointing(lm) {
  if (!lm || lm.length < 21) return false;
  const wrist = lm[0], tip = lm[8], pip = lm[6];
  const wt = Math.hypot(wrist.x - tip.x, wrist.y - tip.y);
  const wp = Math.hypot(wrist.x - pip.x, wrist.y - pip.y);
  return wt > wp * 1.05;
}

class App {
  constructor() {
    this.tracker = new HandTracker();
    this.engine = null;
    this.fsm = new PinchClickFSM();
    this.pointerPx = null;    // Screen position of pointer hand's index
    this.pointerData = null;  // Pointer hand data (for skeleton)
    this.clickerData = null;  // Clicker hand data (for skeleton)
    this.drawing = false;
    this.pressTarget = null;
    this.lost = 0;
    this.pinchNow = false;
  }

  async start() {
    this.engine = new PaintEngine($('canvas'));
    this.engine.camFn = (ctx, w, h) => this.tracker.drawCamera(ctx, w, h);
    this.engine.skelFn = (ctx, w, h) => {
      const hands = [this.pointerData, this.clickerData].filter(Boolean);
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
    // Draw pointer cursor
    if (this.pointerPx) {
      const ctx = this.engine.ctx;
      const r = this.pinchNow ? 12 : 8;
      ctx.fillStyle = '#ff1493'; ctx.beginPath(); ctx.arc(this.pointerPx.x, this.pointerPx.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(this.pointerPx.x, this.pointerPx.y, r + 2, 0, Math.PI * 2); ctx.stroke();
    }
    requestAnimationFrame(() => this._render());
  }

  _onFrame() {
    const hands = this.tracker.getHands();
    if (hands.length === 0) {
      this.lost++;
      if (this.lost > 25) {
        if (this.drawing) { this.engine.end(); this.drawing = false; }
        this.fsm.reset(); this.pointerPx = null; this.pointerData = null; this.clickerData = null; this.pressTarget = null;
      }
      $('gestureLabel').textContent = this.lost > 25 ? 'Searching...' : 'Lost ' + (25 - this.lost + 1);
      return;
    }
    this.lost = 0;

    // Assign roles: pointer hand (index extended) vs clicker hand (pinching)
    this.pointerData = null; this.clickerData = null;
    let pointerIdx = -1, clickerIdx = -1;

    // First pass: find pointing hands
    const pointing = hands.map((h, i) => isPointing(h.landmarks) ? i : -1).filter(i => i >= 0);

    if (pointing.length >= 1) {
      // First pointing hand = pointer
      pointerIdx = pointing[0];
      // If there's another hand that's NOT pointing, it's the clicker
      for (let i = 0; i < hands.length; i++) {
        if (i !== pointerIdx) { clickerIdx = i; break; }
      }
    }
    // If no pointing hand found, use first hand as both
    if (pointerIdx < 0) {
      pointerIdx = 0;
      clickerIdx = hands.length > 1 ? 1 : 0;
    }
    // If no separate clicker, pointer hand also does clicking
    if (clickerIdx < 0) clickerIdx = pointerIdx;

    this.pointerData = hands[pointerIdx];
    this.clickerData = hands[clickerIdx];
    this.pointerPx = toCanvas(hands[pointerIdx].pointer, this.engine.c.clientWidth, this.engine.c.clientHeight);
    this.pinchNow = hands[clickerIdx].pinchDist < PINCH_CLOSE;

    // FSM on clicker hand
    const fsmR = this.fsm.update(hands[clickerIdx].pinchDist, performance.now());
    this._handleClick(fsmR);

    // UI hit test from pointer position
    const el = document.elementFromPoint(this.pointerPx.x, this.pointerPx.y);
    const target = el?.closest('[data-hand]') || el?.closest('.tool-btn') || null;

    // UI interaction: pinch over button = click
    if (fsmR.event === 'press' && target) {
      target.classList.add('hand-press'); this.pressTarget = target;
    }
    if (fsmR.event === 'release' && this.pressTarget) {
      const t = this.pressTarget; t.classList.remove('hand-press');
      if (target === t) { t.classList.add('hand-click'); t.addEventListener('animationend', () => t.classList.remove('hand-click'), { once: true }); t.click(); }
      this.pressTarget = null;
    }
    if (fsmR.event === 'cancel') { if (this.pressTarget) { this.pressTarget.classList.remove('hand-press'); this.pressTarget = null; } }

    // Canvas interaction: pinch = draw (only if NOT over UI)
    if (!target && !this.pressTarget) {
      if (fsmR.event === 'press') {
        if (activeTool === 'fill') {
          this.engine.clear();
          const fctx = this.engine.pctx;
          fctx.fillStyle = COLORS[colorIdx];
          fctx.fillRect(0, 0, this.engine.paint.width, this.engine.paint.height);
        } else {
          this.engine.setColor(COLORS[colorIdx]);
          this.engine.start(this.pointerPx); this.drawing = true;
        }
      } else if (this.drawing && this.pinchNow) {
        this.engine.move(this.pointerPx);
      } else if (this.drawing && !this.pinchNow) {
        this.engine.end(); this.drawing = false;
      }
    }

    $('gestureLabel').textContent = (pointerIdx === clickerIdx ? '1 hand (both)' : '2 hands') + ' | ' + (this.pinchNow ? '✊' : '✋');
  }
}

new App().start();
