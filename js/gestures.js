// gestures.js — Hybrid: 3D angle when available, 2D distance fallback

const FINGERS = {
  thumb:  [2, 3, 4],
  index:  [5, 6, 8],
  middle: [9, 10, 12],
  ring:   [13, 14, 16],
  pinky:  [17, 18, 20]
};

function v3(x, y, z) { return { x, y, z: z || 0 }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function dist(a, b) { return len(sub(a, b)); }

export function getExtendedFingers(lm, wlm) {
  if (!lm || lm.length < 21) return [];
  const ex = [];
  const wrist = lm[0];
  // Check if we have real 3D data (z != 0)
  const has3D = wlm && wlm[0] && typeof wlm[0].z === 'number' && Math.abs(wlm[0].z) > 0.0001;

  for (const [name, [mcp, pip, tip]] of Object.entries(FINGERS)) {
    if (!lm[mcp] || !lm[pip] || !lm[tip]) continue;

    if (has3D) {
      const a = v3(wlm[mcp].x, wlm[mcp].y, wlm[mcp].z);
      const b = v3(wlm[pip].x, wlm[pip].y, wlm[pip].z);
      const c = v3(wlm[tip].x, wlm[tip].y, wlm[tip].z);
      const d = dot(sub(b, a), sub(c, b));
      const m = len(sub(b, a)) * len(sub(c, b));
      const ang = m < 1e-10 ? 180 : Math.acos(Math.max(-1, Math.min(1, d / m))) * (180 / Math.PI);
      if (ang > (name === 'thumb' ? 110 : 135)) ex.push(name);
    } else {
      // 2D distance-from-wrist (proven reliable)
      const wt = dist(wrist, lm[tip]);
      const wp = dist(wrist, lm[pip]);
      const wm = dist(wrist, lm[mcp]);
      if (name === 'thumb') {
        if (dist(lm[tip], lm[5]) > dist(lm[pip], lm[5]) * 1.15) ex.push(name);
      } else {
        if (wt > wp * 1.08 && wp > wm * 1.02) ex.push(name);
      }
    }
  }
  return ex;
}

export function isPinching(lm, wlm) {
  if (wlm && wlm[4] && wlm[8]) return dist(v3(wlm[4].x, wlm[4].y, wlm[4].z), v3(wlm[8].x, wlm[8].y, wlm[8].z)) < 0.04;
  return dist(v3(lm[4].x, lm[4].y, 0), v3(lm[8].x, lm[8].y, 0)) < 0.06;
}

export function classify(lm, wlm) {
  if (!lm || lm.length < 21) return { type: 'none' };
  const ext = getExtendedFingers(lm, wlm);
  const n = ext.length;
  const pinch = isPinching(lm, wlm);
  const idx = lm[8], wrist = lm[0];

  if (n === 0) return { type: 'fist' };
  if (n === 1 && ext[0] === 'pinky') return { type: 'undo' };
  if (n === 1 && ext[0] === 'thumb') return { type: 'none' };
  if (n === 1 && ext[0] === 'index') return { type: 'paint', pos: idx };
  if (n === 2 && ext.includes('index') && ext.includes('middle')) return { type: 'hover', pos: idx };
  if (pinch) return { type: 'pinch', pos: wrist };
  if (n >= 5) return { type: 'menu' };
  return { type: 'none', pos: idx };
}

export function toCanvas(lm, cw, ch) {
  return { x: (1 - lm.x) * cw, y: lm.y * ch };
}
