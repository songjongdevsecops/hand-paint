// gestures.js — Dual-check: distance + Y position

function d(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Extended if EITHER: tip farther from wrist than PIP (distance)
// OR: tip is above PIP in screen space (Y comparison)
function extended(lm, tip, pip, mcp) {
  const distOk = d(lm[0], lm[tip]) > d(lm[0], lm[pip]) * 1.02;
  const yOk = lm[tip].y < lm[pip].y && lm[pip].y < lm[mcp].y;
  return distOk || yOk;
}

export function classify(lm, wlm) {
  if (!lm || lm.length < 21) return { type: 'none' };
  const W = lm[0];

  // Thumb: lateral distance from index MCP
  const thumbUp = d(lm[4], lm[5]) > d(lm[3], lm[5]) * 1.08;

  const indexUp = extended(lm, 8, 6, 5);
  const middleUp = extended(lm, 12, 10, 9);
  const ringUp = extended(lm, 16, 14, 13);
  const pinkyUp = extended(lm, 20, 18, 17);

  const count = [thumbUp, indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  // No fingers = fist → clear
  if (count === 0) return { type: 'fist' };

  // All 5 = menu
  if (count >= 5) return { type: 'menu' };

  // Pinch
  if (d(lm[4], lm[8]) < 0.06) return { type: 'pinch', pos: W };

  // Index only or index primary = paint
  if (indexUp) return { type: 'paint', pos: lm[8] };

  // Index + middle = hover
  if (indexUp && middleUp) return { type: 'hover', pos: lm[8] };

  return { type: 'none', pos: lm[8] };
}

export function toCanvas(lm, cw, ch) {
  return { x: (1 - lm.x) * cw, y: lm.y * ch };
}
