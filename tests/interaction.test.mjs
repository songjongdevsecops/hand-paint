// tests/interaction.test.mjs — pinch-click FSM tests (Node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PINCH_CLOSE,
  PINCH_OPEN,
  DEBOUNCE_FRAMES,
  CLICK_COOLDOWN_MS,
  SLOP_PX,
  pinchDistance,
  withinSlop,
  PinchClickFSM,
} from '../js/interaction.js';

// ─── pinchDistance ────────────────────────────────────────────────────────────

describe('pinchDistance(landmarks)', () => {
  it('returns Infinity if landmarks[4] is missing', () => {
    const lm = [];
    assert.equal(pinchDistance(lm), Infinity);
  });

  it('returns Infinity if landmarks[8] is missing', () => {
    const lm = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 2 }];
    assert.equal(pinchDistance(lm), Infinity);
  });

  it('returns hypot(lm[4] - lm[8]) in normalized coords', () => {
    const lm = [];
    for (let i = 0; i < 21; i++) lm.push({ x: 0, y: 0 });
    lm[4] = { x: 0.1, y: 0.2 };
    lm[8] = { x: 0.4, y: 0.6 };
    const expected = Math.hypot(0.1 - 0.4, 0.2 - 0.6);
    assert.ok(Math.abs(pinchDistance(lm) - expected) < 1e-10);
  });

  it('returns Infinity for null/undefined landmarks', () => {
    assert.equal(pinchDistance(null), Infinity);
    assert.equal(pinchDistance(undefined), Infinity);
  });
});

// ─── withinSlop ───────────────────────────────────────────────────────────────

describe('withinSlop(rect, pt, slop)', () => {
  const rect = { left: 0, top: 0, right: 100, bottom: 80 };

  it('returns true for a point well inside', () => {
    assert.equal(withinSlop(rect, { x: 50, y: 40 }, 10), true);
  });

  it('returns true for a point just outside but within slop', () => {
    assert.equal(withinSlop(rect, { x: -5, y: -5 }, 10), true);
    assert.equal(withinSlop(rect, { x: 105, y: 85 }, 10), true);
  });

  it('returns false for a point beyond slop', () => {
    assert.equal(withinSlop(rect, { x: -15, y: 40 }, 10), false);
    assert.equal(withinSlop(rect, { x: 50, y: 95 }, 10), false);
  });

  it('is edge-inclusive at slop boundary', () => {
    assert.equal(withinSlop(rect, { x: -10, y: -10 }, 10), true);
    assert.equal(withinSlop(rect, { x: 110, y: 90 }, 10), true);
  });

  it('is edge-inclusive at exact rect boundary', () => {
    assert.equal(withinSlop(rect, { x: 0, y: 0 }, 0), true);
    assert.equal(withinSlop(rect, { x: 100, y: 80 }, 0), true);
  });
});

// ─── PinchClickFSM ────────────────────────────────────────────────────────────

describe('PinchClickFSM', () => {
  // Helper: feed a sequence of distances with simulated time
  // starting at t=0, each frame advances time by 16ms (~60fps).
  // Returns array of {state, event} results.
  const runSequence = (fsm, distances, startNow = 0, frameMs = 16) => {
    const results = [];
    distances.forEach((d, i) => {
      const now = startNow + i * frameMs;
      results.push(fsm.update(d, now));
    });
    return results;
  };

  describe('initial state', () => {
    it("is 'open' with no event", () => {
      const fsm = new PinchClickFSM();
      assert.deepEqual(fsm.update(0.1, 0), { state: 'open', event: null });
    });
  });

  describe('open → stream of far distances', () => {
    it('never emits events when distances stay ≥ 0.08', () => {
      const fsm = new PinchClickFSM();
      const results = runSequence(fsm, [0.10, 0.12, 0.09, 0.08, 0.11, 0.20, 0.15]);
      results.forEach(r => assert.deepEqual(r, { state: 'open', event: null }));
    });
  });

  describe('press detection', () => {
    it('emits press exactly once after ≥3 consecutive frames < 0.05', () => {
      const fsm = new PinchClickFSM();
      // 2 close frames (not enough), then press on 3rd
      const results = runSequence(fsm, [0.03, 0.04, 0.02, 0.01, 0.03, 0.02]);
      // Frame 0: close count=1 -> no press
      assert.deepEqual(results[0], { state: 'open', event: null });
      // Frame 1: close count=2 -> no press
      assert.deepEqual(results[1], { state: 'open', event: null });
      // Frame 2: close count=3 -> press!
      assert.deepEqual(results[2], { state: 'closed', event: 'press' });
      // Frame 3-5: still closed, no more press events
      assert.deepEqual(results[3], { state: 'closed', event: null });
      assert.deepEqual(results[4], { state: 'closed', event: null });
      assert.deepEqual(results[5], { state: 'closed', event: null });
    });

    it('does NOT press when interrupted: 2 close + 1 open + 2 close', () => {
      const fsm = new PinchClickFSM();
      const results = runSequence(fsm, [0.03, 0.04, 0.10, 0.02, 0.01]);
      // After the open frame, counter resets. 2 more close = only 2 count, no press.
      results.forEach(r => assert.deepEqual(r, { state: 'open', event: null }));
    });

    it('distance exactly at PINCH_CLOSE (0.05) resets counter', () => {
      const fsm = new PinchClickFSM();
      // Two close frames (2 count), then 0.05 (not < 0.05 = not close), then 3 close
      const results = runSequence(fsm, [0.03, 0.04, 0.05, 0.03, 0.04, 0.02]);
      // Frame 0-1: no press (only 2 close)
      assert.deepEqual(results[0], { state: 'open', event: null });
      assert.deepEqual(results[1], { state: 'open', event: null });
      // Frame 2: 0.05 — not close, resets; still open
      assert.deepEqual(results[2], { state: 'open', event: null });
      // Frame 3-4: 2 close, no press yet
      assert.deepEqual(results[3], { state: 'open', event: null });
      assert.deepEqual(results[4], { state: 'open', event: null });
      // Frame 5: 3rd close → press
      assert.deepEqual(results[5], { state: 'closed', event: 'press' });
    });

    it('cooldown: after release, new press within 300ms is ignored', () => {
      const fsm = new PinchClickFSM();
      // First: do a full press+release cycle
      const phase1 = runSequence(fsm, [
        0.03, 0.03, 0.03, // press
        0.10, 0.10, 0.10, // release
      ]);
      assert.deepEqual(phase1[2], { state: 'closed', event: 'press' });
      assert.deepEqual(phase1[5], { state: 'open', event: 'release' });

      // Now (immediately after release, same timeline) try to press again
      // Cooldown is in effect — close frames are ignored
      const phase2 = runSequence(fsm, [0.03, 0.03, 0.03, 0.03, 0.03], 6 * 16); // t=96ms
      phase2.forEach(r => assert.deepEqual(r, { state: 'open', event: null }));

      // After cooldown period (now >= 300ms after release), press works again
      const fsm2 = new PinchClickFSM();
      // Press and release
      runSequence(fsm2, [0.03, 0.03, 0.03, 0.10, 0.10, 0.10], 0);
      // Now try press at 400ms after release (well past cooldown)
      const start = 6 * 16 + 400; // 496ms
      const results = runSequence(fsm2, [0.03, 0.03, 0.03], start);
      assert.deepEqual(results[2], { state: 'closed', event: 'press' });
    });

    it('cooldown uses injected now, not Date.now()', () => {
      // Instantiate and feed extreme now values — must still work
      const fsm = new PinchClickFSM();
      const phase1 = runSequence(fsm, [
        0.03, 0.03, 0.03, // press at t=16384
        0.10, 0.10, 0.10, // release at t=16480
      ], 10000);
      assert.equal(phase1[2].event, 'press');
      assert.equal(phase1[5].event, 'release');

      // 200ms later (within cooldown) — no press
      const phase2 = runSequence(fsm, [0.03, 0.03, 0.03], 10000 + 6 * 16 + 200);
      phase2.forEach(r => assert.equal(r.event, null));

      // 500ms later (past cooldown) — press works
      const phase3 = runSequence(fsm, [0.03, 0.03, 0.03], 10000 + 6 * 16 + 500);
      assert.equal(phase3[2].event, 'press');
    });
  });

  describe('hysteresis / dead zone', () => {
    it('while closed, dist in [0.05, 0.08] holds state — no release', () => {
      const fsm = new PinchClickFSM();
      // Press
      const p = runSequence(fsm, [0.03, 0.03, 0.03], 0);
      assert.equal(p[2].event, 'press');

      // Now feed: 2 open frames (advance release counter), then dead-zone frame
      // Dead-zone resets release counter
      const hyst = runSequence(fsm, [0.10, 0.10, 0.06], 3 * 16);
      assert.deepEqual(hyst[0], { state: 'closed', event: null }); // release count=1
      assert.deepEqual(hyst[1], { state: 'closed', event: null }); // release count=2
      assert.deepEqual(hyst[2], { state: 'closed', event: null }); // dead zone, reset → count=0

      // Continue with 2 more open frames — only 2, not enough for release
      const more = runSequence(fsm, [0.10, 0.10], (3 + 3) * 16);
      assert.equal(more[0].state, 'closed');
      assert.equal(more[1].state, 'closed');

      // 3rd open frame triggers release
      const last = runSequence(fsm, [0.10], (3 + 3 + 2) * 16);
      assert.deepEqual(last[0], { state: 'open', event: 'release' });
    });

    it('dead zone at lower bound (0.05) is treated as dead zone', () => {
      const fsm = new PinchClickFSM();
      runSequence(fsm, [0.03, 0.03, 0.03], 0); // press
      const r = runSequence(fsm, [0.10, 0.10, 0.05], 3 * 16);
      // After 2 open + 1 dead (0.05): release counter was 2, then dead resets to 0
      assert.equal(r[2].state, 'closed');
      assert.equal(r[2].event, null);
    });

    it('dead zone at upper bound (0.08) is treated as dead zone', () => {
      const fsm = new PinchClickFSM();
      runSequence(fsm, [0.03, 0.03, 0.03], 0); // press
      const r = runSequence(fsm, [0.10, 0.10, 0.08], 3 * 16);
      assert.equal(r[2].state, 'closed');
      assert.equal(r[2].event, null);
    });

    it('while closed, close frames reset release counter', () => {
      const fsm = new PinchClickFSM();
      runSequence(fsm, [0.03, 0.03, 0.03], 0); // press
      // 2 open frames advance release counter to 2, then close frames reset
      const r = runSequence(fsm, [0.10, 0.10, 0.03, 0.03, 0.10, 0.10], 3 * 16);
      // After 2 open (count=2), then close (count=0), then close (count=0), then 2 open (count=2)
      // Still no release (only 2 consecutive open)
      r.forEach(fr => assert.equal(fr.event, null));
    });
  });

  describe('release detection', () => {
    it('emits release exactly once after ≥3 consecutive frames > 0.08', () => {
      const fsm = new PinchClickFSM();
      // Press first
      runSequence(fsm, [0.03, 0.03, 0.03], 0);

      // 2 open frames → no release, then 3rd → release
      const results = runSequence(fsm, [0.10, 0.12, 0.09], 3 * 16);
      assert.deepEqual(results[0], { state: 'closed', event: null });
      assert.deepEqual(results[1], { state: 'closed', event: null });
      assert.deepEqual(results[2], { state: 'open', event: 'release' });

      // After release, further open frames have no event
      const more = runSequence(fsm, [0.15, 0.20], (3 + 3) * 16);
      assert.deepEqual(more[0], { state: 'open', event: null });
      assert.deepEqual(more[1], { state: 'open', event: null });
    });

    it('release counter resets on interruption (dist ≤ 0.08)', () => {
      const fsm = new PinchClickFSM();
      runSequence(fsm, [0.03, 0.03, 0.03], 0); // press

      // 2 open, 1 close, 2 open, 1 close, 2 open — never 3 consecutive → no release
      const results = runSequence(fsm, [
        0.10, 0.12,       // 2 open → count=2
        0.03,              // close → reset count=0
        0.10, 0.12,       // 2 open → count=2
        0.04,              // close → reset count=0
        0.10, 0.12,       // 2 open → count=2 (end of sequence)
      ], 3 * 16);
      results.forEach(r => assert.equal(r.event, null));
      assert.equal(results[results.length - 1].state, 'closed');
    });
  });

  describe('NaN / undefined distances', () => {
    it('NaN distance is treated as open evidence', () => {
      const fsm = new PinchClickFSM();
      // 2 close + NaN (resets counter) → no press
      const results = runSequence(fsm, [0.03, 0.04, NaN, 0.03, 0.04, 0.02]);
      assert.deepEqual(results[0], { state: 'open', event: null });
      assert.deepEqual(results[1], { state: 'open', event: null });
      assert.deepEqual(results[2], { state: 'open', event: null }); // NaN → resets
      // Now 3 closes
      assert.deepEqual(results[3], { state: 'open', event: null });
      assert.deepEqual(results[4], { state: 'open', event: null });
      assert.deepEqual(results[5], { state: 'closed', event: 'press' });
    });

    it('undefined distance is treated as open evidence', () => {
      const fsm = new PinchClickFSM();
      const results = runSequence(fsm, [0.03, 0.04, undefined, 0.03, 0.04, 0.02]);
      assert.deepEqual(results[2], { state: 'open', event: null }); // undefined resets
      assert.deepEqual(results[5], { state: 'closed', event: 'press' });
    });

    it('NaN/undefined counts as open frame for release counter', () => {
      const fsm = new PinchClickFSM();
      runSequence(fsm, [0.03, 0.03, 0.03], 0); // press
      // 2 open frames, then NaN (open = count 3 → release!)
      const results = runSequence(fsm, [0.10, 0.10, NaN], 3 * 16);
      assert.deepEqual(results[0], { state: 'closed', event: null });
      assert.deepEqual(results[1], { state: 'closed', event: null });
      assert.deepEqual(results[2], { state: 'open', event: 'release' });
    });
  });

  describe('reset() — hand lost', () => {
    it("returns to 'open' and clears counters", () => {
      const fsm = new PinchClickFSM();
      // Press (now closed)
      runSequence(fsm, [0.03, 0.03, 0.03], 0);
      assert.equal(fsm.update(0.02, 4 * 16).state, 'closed');

      const result = fsm.reset();
      assert.deepEqual(result, { event: 'cancel' });

      // After reset, should be open again
      assert.deepEqual(fsm.update(0.10, 5 * 16), { state: 'open', event: null });
    });

    it('emits cancel only when previously closed', () => {
      const fsm = new PinchClickFSM();
      // Still open
      assert.deepEqual(fsm.update(0.10, 0), { state: 'open', event: null });
      const result = fsm.reset();
      assert.deepEqual(result, { event: null });

      // Confirm still open after reset
      assert.deepEqual(fsm.update(0.10, 16), { state: 'open', event: null });
    });

    it('after reset+press+release, new press works without cooldown block', () => {
      // This verifies reset also clears cooldown
      const fsm = new PinchClickFSM();
      runSequence(fsm, [0.03, 0.03, 0.03], 0); // press
      fsm.reset();
      // After reset, press should work immediately
      const results = runSequence(fsm, [0.03, 0.03, 0.03], 100);
      assert.deepEqual(results[2], { state: 'closed', event: 'press' });
    });
  });

  describe('constants are exported', () => {
    it('PINCH_CLOSE is 0.05', () => assert.equal(PINCH_CLOSE, 0.05));
    it('PINCH_OPEN is 0.08', () => assert.equal(PINCH_OPEN, 0.08));
    it('DEBOUNCE_FRAMES is 3', () => assert.equal(DEBOUNCE_FRAMES, 3));
    it('CLICK_COOLDOWN_MS is 300', () => assert.equal(CLICK_COOLDOWN_MS, 300));
    it('SLOP_PX is 40', () => assert.equal(SLOP_PX, 40));
  });

  describe('stress: rapid toggle', () => {
    it('handles press→release→press correctly across boundaries', () => {
      const fsm = new PinchClickFSM();
      // Press
      let r = runSequence(fsm, [0.03, 0.03, 0.03], 0);
      assert.equal(r[2].event, 'press');

      // Release (after cooldown window opened)
      r = runSequence(fsm, [0.10, 0.10, 0.10], 400); // +400ms later
      assert.equal(r[2].event, 'release');

      // Press again (400ms after release = 400+3*16+400 = 848ms → past cooldown)
      r = runSequence(fsm, [0.03, 0.03, 0.03], 400 + 3 * 16 + 400);
      assert.equal(r[2].event, 'press');
    });
  });
});
