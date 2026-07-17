// js/interaction.js — pinch-click FSM, zero DOM dependencies
export const PINCH_CLOSE = 0.05;
export const PINCH_OPEN = 0.08;
export const DEBOUNCE_FRAMES = 3;
export const CLICK_COOLDOWN_MS = 300;
export const SLOP_PX = 40;

/** Euclidean distance between thumb tip (lm[4]) and index tip (lm[8]). Infinity if missing. */
export function pinchDistance(landmarks) {
  if (!landmarks || !landmarks[4] || !landmarks[8]) return Infinity;
  const a = landmarks[4];
  const b = landmarks[8];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when pt (x,y) is inside rect {left,top,right,bottom} expanded by slop px on every side, edge-inclusive. */
export function withinSlop(rect, pt, slop) {
  return pt.x >= rect.left - slop
      && pt.x <= rect.right + slop
      && pt.y >= rect.top - slop
      && pt.y <= rect.bottom + slop;
}

export class PinchClickFSM {
  constructor() {
    this._state = 'open';
    this._counter = 0;
    this._lastReleaseAt = null;
  }

  /**
   * @param {number} dist — pinchDistance result
   * @param {number} now  — injected timestamp (ms), never Date.now()
   * @returns {{ state: 'open'|'closed', event: null|'press'|'release' }}
   */
  update(dist, now) {
    if (this._state === 'open') {
      if (this._isClose(dist) && this._cooldownPassed(now)) {
        if (++this._counter >= DEBOUNCE_FRAMES) {
          this._state = 'closed';
          this._counter = 0;
          return { state: 'closed', event: 'press' };
        }
      } else {
        this._counter = 0;
      }
      return { state: 'open', event: null };
    }

    // state === 'closed'
    if (this._isOpen(dist)) {
      if (++this._counter >= DEBOUNCE_FRAMES) {
        this._state = 'open';
        this._counter = 0;
        this._lastReleaseAt = now;
        return { state: 'open', event: 'release' };
      }
    } else {
      // dead zone [PINCH_CLOSE, PINCH_OPEN] or close → reset release progress
      this._counter = 0;
    }
    return { state: 'closed', event: null };
  }

  /** Reset on hand-loss. Returns {event:'cancel'} if was closed, else {event:null}. */
  reset() {
    const wasClosed = this._state === 'closed';
    this._state = 'open';
    this._counter = 0;
    this._lastReleaseAt = null;
    return { event: wasClosed ? 'cancel' : null };
  }

  _isClose(dist) {
    return Number.isFinite(dist) && dist < PINCH_CLOSE;
  }

  _isOpen(dist) {
    return !Number.isFinite(dist) || dist > PINCH_OPEN;
  }

  _cooldownPassed(now) {
    return this._lastReleaseAt === null || now - this._lastReleaseAt >= CLICK_COOLDOWN_MS;
  }
}
