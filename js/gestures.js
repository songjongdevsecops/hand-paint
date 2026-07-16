/* ============================================================
   gestures.js — Hand gesture recognition v2
   
   Uses 3D world landmarks (meters, rotation-invariant) for
   finger extension detection via bone angles.
   Falls back to 2D normalized landmarks if world coords unavailable.
   ============================================================ */

// Landmark indices for a single hand (21 points)
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
};

// Finger bone definitions: [base, middle, tip] landmark indices
const FINGER_BONES = {
  thumb:  [LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP],
  index:  [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_TIP],
  middle: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_TIP],
  ring:   [LM.RING_MCP, LM.RING_PIP, LM.RING_TIP],
  pinky:  [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_TIP]
};

/* ---- 3D Vector math ---- */

function vec3(x, y, z) { return { x, y, z: z || 0 }; }

function sub3(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z||0) - (b.z||0) }; }

function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

function len3(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }

function dist3(a, b) { return len3(sub3(a, b)); }

/**
 * Angle between two vectors in degrees.
 */
function angleBetween(a, b) {
  const dot = dot3(a, b);
  const mags = len3(a) * len3(b);
  if (mags < 1e-10) return 180; // degenerate → treat as straight
  const cos = Math.max(-1, Math.min(1, dot / mags));
  return Math.acos(cos) * (180 / Math.PI);
}

/* ---- Finger extension: angle-based (3D, rotation-invariant) ---- */

/**
 * Check if a finger is extended using the angle between its two bone segments.
 * MCP→PIP and PIP→TIP. Straight finger ≈ 180°, bent finger < 140°.
 * Uses 3D world coords if available, falls back to 2D normalized.
 */
export function isFingerExtended(landmarks, worldLandmarks, fingerName) {
  const [mcp, pip, tip] = FINGER_BONES[fingerName];
  if (!landmarks[mcp] || !landmarks[pip] || !landmarks[tip]) return false;

  let a, b, c;
  if (worldLandmarks && worldLandmarks[mcp] && worldLandmarks[pip] && worldLandmarks[tip]) {
    a = vec3(worldLandmarks[mcp].x, worldLandmarks[mcp].y, worldLandmarks[mcp].z);
    b = vec3(worldLandmarks[pip].x, worldLandmarks[pip].y, worldLandmarks[pip].z);
    c = vec3(worldLandmarks[tip].x, worldLandmarks[tip].y, worldLandmarks[tip].z);
  } else {
    // Fallback to 2D normalized coords
    a = vec3(landmarks[mcp].x, landmarks[mcp].y, 0);
    b = vec3(landmarks[pip].x, landmarks[pip].y, 0);
    c = vec3(landmarks[tip].x, landmarks[tip].y, 0);
  }

  const ab = sub3(b, a); // MCP → PIP
  const bc = sub3(c, b); // PIP → TIP
  const angle = angleBetween(ab, bc);

  // Thumb is naturally more bent even when "extended"
  const threshold = fingerName === 'thumb' ? 130 : 155;
  return angle > threshold;
}

/**
 * Get which fingers are extended.
 */
export function getExtendedFingers(landmarks, worldLandmarks) {
  if (!landmarks || landmarks.length < 21) return [];
  return Object.keys(FINGER_BONES).filter(name =>
    isFingerExtended(landmarks, worldLandmarks, name)
  );
}

/* ---- Pinch detection (3D distance) ---- */

export function isPinching(landmarks, worldLandmarks, thresholdMeters = 0.04) {
  if (worldLandmarks && worldLandmarks[LM.THUMB_TIP] && worldLandmarks[LM.INDEX_TIP]) {
    return dist3(
      vec3(worldLandmarks[LM.THUMB_TIP].x, worldLandmarks[LM.THUMB_TIP].y, worldLandmarks[LM.THUMB_TIP].z),
      vec3(worldLandmarks[LM.INDEX_TIP].x, worldLandmarks[LM.INDEX_TIP].y, worldLandmarks[LM.INDEX_TIP].z)
    ) < thresholdMeters;
  }
  // 2D fallback
  const dx = landmarks[LM.THUMB_TIP].x - landmarks[LM.INDEX_TIP].x;
  const dy = landmarks[LM.THUMB_TIP].y - landmarks[LM.INDEX_TIP].y;
  return Math.sqrt(dx * dx + dy * dy) < 0.06;
}

/* ---- Main classifier ---- */

/**
 * Classify hand gesture from landmarks.
 * @param {Array} landmarks - 21 normalized landmarks
 * @param {Array} worldLandmarks - 21 world landmarks (3D, meters)
 * @returns {{ type: string, data: object|null }}
 */
export function classifyGesture(landmarks, worldLandmarks) {
  if (!landmarks || landmarks.length < 21) {
    return { type: 'unknown', data: null };
  }

  const extended = getExtendedFingers(landmarks, worldLandmarks);
  const count = extended.length;
  const pinch = isPinching(landmarks, worldLandmarks);
  const indexTip = landmarks[LM.INDEX_TIP];
  const wrist = landmarks[LM.WRIST];

  // --- Classification ---

  if (count === 0) {
    return { type: 'fist', data: null };
  }

  if (count === 1 && extended.includes('pinky')) {
    return { type: 'undo', data: null };
  }

  // Thumb only → ignored (prevents accidental triggers)
  if (count === 1 && extended.includes('thumb')) {
    return { type: 'unknown', data: null };
  }

  // Index only → paint
  if (count === 1 && extended.includes('index')) {
    return { type: 'paint', data: { position: indexTip } };
  }

  // Index + middle → hover
  if (count === 2 && extended.includes('index') && extended.includes('middle')) {
    return { type: 'hover', data: { position: indexTip } };
  }

  // Pinch → brush size via vertical movement
  if (pinch) {
    return { type: 'pinch', data: { position: wrist } };
  }

  // 5 fingers → menu
  if (count >= 5) {
    return { type: 'menu', data: null };
  }

  return { type: 'unknown', data: { position: indexTip } };
}

/* ---- Coordinate mapping ---- */

export function mapToCanvas(landmark, canvasWidth, canvasHeight, mirror = true) {
  return {
    x: mirror ? (1 - landmark.x) * canvasWidth : landmark.x * canvasWidth,
    y: landmark.y * canvasHeight,
    z: landmark.z || 0
  };
}
