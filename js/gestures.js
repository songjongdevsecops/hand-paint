// gestures.js — Simple explicit gesture detection

function d(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Check if a finger is extended: tip farther from wrist than PIP
function extended(lm, tip, pip) {
  return d(lm[0], lm[tip]) > d(lm[0], lm[pip]) * 1.04;
}

export function classify(lm, wlm) {
  if (!lm || lm.length < 21) return { type: 'none' };
  const W = lm[0];

  // Individual finger state
  const thumbUp = d(lm[4], lm[5]) > d(lm[3], lm[5]) * 1.1;  // thumb away from index MCP
  const indexUp = extended(lm, 8, 6);
  const middleUp = extended(lm, 12, 10);
  const ringUp = extended(lm, 16, 14);
  const pinkyUp = extended(lm, 20, 18);

  const fingersUp = [thumbUp, indexUp, middleUp, ringUp, pinkyUp];
  const count = fingersUp.filter(Boolean).length;

  // Pinch: thumb tip near index tip
  const pinch = d(lm[4], lm[8]) < 0.06;

  // ---- Classification ----

  // Pinch overrides everything
  if (pinch) return { type: 'pinch', pos: W };

  // All 5 up = menu
  if (count >= 5) return { type: 'menu' };

  // Only pinky up = undo
  if (pinkyUp && !indexUp && !middleUp && !ringUp && count <= 2) return { type: 'undo' };

  // Only index = paint
  if (indexUp && !middleUp && count <= 2) return { type: 'paint', pos: lm[8] };

  // Index + middle = hover
  if (indexUp && middleUp && count <= 3) return { type: 'hover', pos: lm[8] };

  // No fingers = fist
  if (count === 0) return { type: 'fist' };

  // Fallback: if index is up, paint anyway
  if (indexUp) return { type: 'paint', pos: lm[8] };

  return { type: 'none', pos: lm[8] };
}

export function toCanvas(lm, cw, ch) {
  return { x: (1 - lm.x) * cw, y: lm.y * ch };
}
