// gestures.js — Coordinate mapping
export function toCanvas(lm, cw, ch) {
  return { x: (1 - lm.x) * cw, y: lm.y * ch };
}
