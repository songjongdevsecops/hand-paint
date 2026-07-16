/* ============================================================
   gestures.js — Hand gesture recognition engine
   
   Uses MediaPipe hand landmarks (21 points per hand)
   to detect specific gestures for paint controls.
   ============================================================ */

// Landmark indices for a single hand
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
};

// Finger definitions for extension checking
const FINGERS = [
  { name: 'thumb',  tip: LM.THUMB_TIP,  pip: LM.THUMB_IP,  mcp: LM.THUMB_MCP },
  { name: 'index',  tip: LM.INDEX_TIP,  pip: LM.INDEX_DIP,  mcp: LM.INDEX_MCP },
  { name: 'middle', tip: LM.MIDDLE_TIP, pip: LM.MIDDLE_DIP, mcp: LM.MIDDLE_MCP },
  { name: 'ring',   tip: LM.RING_TIP,   pip: LM.RING_DIP,   mcp: LM.RING_MCP },
  { name: 'pinky',  tip: LM.PINKY_TIP,  pip: LM.PINKY_DIP,  mcp: LM.PINKY_MCP }
];

/**
 * Euclidean distance between two landmarks (normalized 0..1 coords)
 */
export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Check if a finger is extended.
 * Uses distance from wrist: if fingertip is farther from wrist than the PIP joint, it's extended.
 * This is rotation-invariant.
 */
export function isFingerExtended(landmarks, finger) {
  const wrist = landmarks[LM.WRIST];
  const tip = landmarks[finger.tip];
  const pip = landmarks[finger.pip];
  const mcp = landmarks[finger.mcp];

  const wristToTip = distance(wrist, tip);
  const wristToPip = distance(wrist, pip);
  const wristToMcp = distance(wrist, mcp);

  // Special case for thumb: the thumb moves in a different plane than other fingers.
  // Check if thumb tip is significantly farther from the wrist than the thumb IP joint.
  // Also verify tip is not near the index finger (would indicate a relaxed or pinching thumb).
  if (finger.name === 'thumb') {
    // Thumb is extended if tip is substantially farther from wrist than IP joint
    const tipFromWrist = distance(wrist, tip);
    const ipFromWrist = distance(wrist, landmarks[finger.pip]);
    // Also check: is thumb tip away from index MCP? (abducted, not adducted)
    const indexMcp = landmarks[LM.INDEX_MCP];
    const thumbTipToIndexMcp = distance(tip, indexMcp);
    const thumbIpToIndexMcp = distance(landmarks[finger.pip], indexMcp);
    
    // Stricter: must be clearly abducted (away from palm) AND extended
    const isAbducted = thumbTipToIndexMcp > thumbIpToIndexMcp * 1.2;
    const isExtended = tipFromWrist > ipFromWrist * 1.15;
    return isAbducted && isExtended;
  }

  // For other fingers: tip should be further from wrist than PIP, and PIP further than MCP
  // Increased thresholds for more reliable detection
  return wristToTip > wristToPip * 1.12 && wristToPip > wristToMcp * 1.03;
}

/**
 * Get which fingers are extended on a hand
 * Returns array of finger names that are extended
 */
export function getExtendedFingers(landmarks) {
  if (!landmarks || landmarks.length < 21) return [];
  return FINGERS
    .filter(f => isFingerExtended(landmarks, f))
    .map(f => f.name);
}

/**
 * Compute the centroid (average position) of the hand
 */
export function handCentroid(landmarks) {
  if (!landmarks || landmarks.length === 0) return null;
  let sx = 0, sy = 0, sz = 0;
  const n = Math.min(landmarks.length, 21);
  for (let i = 0; i < n; i++) {
    sx += landmarks[i].x;
    sy += landmarks[i].y;
    sz += (landmarks[i].z || 0);
  }
  return { x: sx / n, y: sy / n, z: sz / n };
}

/**
 * Detect a pinch gesture (thumb tip close to index tip)
 */
export function isPinching(landmarks, threshold = 0.05) {
  return distance(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) < threshold;
}

/**
 * Main gesture classifier.
 * Returns an object with detected gesture type and relevant data.
 * 
 * Gesture types:
 *   'paint'    — only index finger extended → draw
 *   'hover'    — index + middle extended → move cursor without drawing
 *   'menu'     — all 5 fingers spread → toggle menu
 *   'undo'     — only pinky extended
 *   'fist'     — no fingers extended → potentially clear
 *   'pinch'    — thumb + index close together → brush size
 *   'unknown'  — fallback
 */
export function classifyGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) {
    return { type: 'unknown', data: null };
  }

  const extended = getExtendedFingers(landmarks);
  const count = extended.length;

  // Pinch detection (thumb and index close)
  const pinch = isPinching(landmarks, 0.06);

  // Index finger tip position (for drawing)
  const indexTip = landmarks[LM.INDEX_TIP];
  const middleTip = landmarks[LM.MIDDLE_TIP];
  const thumbTip = landmarks[LM.THUMB_TIP];
  const pinkyTip = landmarks[LM.PINKY_TIP];

  // Brush size from thumb-index distance
  const brushDist = distance(thumbTip, indexTip);

  // --- Gesture classification ---

  // Fist: no fingers extended
  if (count === 0) {
    return { type: 'fist', data: { centroid: handCentroid(landmarks) } };
  }

  // Only pinky extended → undo
  if (count === 1 && extended.includes('pinky')) {
    return { type: 'undo', data: null };
  }

  // Only thumb extended → not assigned to any action (use button to save)
  // This is explicitly ignored to prevent accidental downloads
  if (count === 1 && extended.includes('thumb')) {
    return { type: 'unknown', data: null };
  }

  // Only index extended → paint
  if (count === 1 && extended.includes('index')) {
    return {
      type: 'paint',
      data: {
        position: indexTip,
        brushSize: Math.max(1, Math.min(40, Math.round(brushDist * 100)))
      }
    };
  }

  // Index + middle extended → hover (cursor mode)
  if (count === 2 && extended.includes('index') && extended.includes('middle')) {
    return {
      type: 'hover',
      data: { position: indexTip }
    };
  }

  // Pinch gesture → brush size adjustment
  if (pinch && (extended.includes('thumb') || extended.includes('index'))) {
    return {
      type: 'pinch',
      data: {
        position: indexTip,
        brushSize: Math.max(1, Math.min(40, Math.round(brushDist * 100)))
      }
    };
  }

  // All 5 fingers spread → menu toggle
  if (count >= 5) {
    return { type: 'menu', data: { centroid: handCentroid(landmarks) } };
  }

  // Index + middle + ring → might be "3 finger" gesture for something
  if (count === 3 && extended.includes('index') && extended.includes('middle') && extended.includes('ring')) {
    return { type: 'menu', data: { centroid: handCentroid(landmarks) } };
  }

  // Default: unknown
  return {
    type: 'unknown',
    data: {
      position: indexTip,
      extended,
      brushDist
    }
  };
}

/**
 * Map normalized landmark coordinates (0..1) to canvas pixel coordinates
 */
export function mapToCanvas(landmark, canvasWidth, canvasHeight, mirror = true) {
  return {
    x: mirror ? (1 - landmark.x) * canvasWidth : landmark.x * canvasWidth,
    y: landmark.y * canvasHeight,
    z: landmark.z || 0
  };
}

/**
 * Convert MediaPipe hand landmarks to array of {x,y,z} for drawing
 */
export function landmarksToPoints(landmarks, canvasWidth, canvasHeight) {
  if (!landmarks) return [];
  return landmarks.map(l => mapToCanvas(l, canvasWidth, canvasHeight));
}
