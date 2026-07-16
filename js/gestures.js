// gestures.js — Coordinate mapping only (gestures from GestureRecognizer)

export function toCanvas(lm, cw, ch) {
  return { x: (1 - lm.x) * cw, y: lm.y * ch };
}
