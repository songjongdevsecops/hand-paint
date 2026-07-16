# Change: Hand Paint — Interactive Hand-Tracking Painting App

**Status:** in-progress  
**Created:** 2026-07-16  
**Type:** feature

## Summary

Build a browser-based painting application that uses MediaPipe Holistic for real-time hand tracking, enabling users to paint on a canvas using only hand gestures. The app runs 100% client-side with WebAssembly acceleration and GPU inference via WebGL. No backend required.

## Motivation

Create an accessible, fun painting tool that showcases the capabilities of on-device ML (MediaPipe Holistic + WASM) running entirely in the browser. The app should work as a static site hosted on GitHub Pages with zero server-side processing.

## Scope

### In Scope
- MediaPipe Holistic hand landmark detection (21 points per hand)
- Real-time hand gesture classification (paint, hover, undo, clear, save, pinch)
- Full-viewport canvas with smooth brush strokes
- Multiple brush types (round, flat, spray)
- Color palette selection
- Variable brush size controlled by hand gestures
- Undo/redo history (up to 50 states)
- Webcam PiP preview with landmark overlay
- GPU-accelerated inference via WebGL (CPU fallback)
- GitHub Pages deployment

### Out of Scope
- Backend/API/server-side processing
- Multi-user/collaborative features
- Face or pose tracking (Holistic model is loaded but only hands are used for painting)
- Mobile native apps
- Authentication/user accounts

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Browser                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Webcam   │  │ MediaPipe│  │  Canvas     │  │
│  │ Stream   │─▶│ Holistic │─▶│  Engine     │  │
│  └──────────┘  │ (WASM)   │  │ (2D Canvas) │  │
│                │ GPU/WebGL│  └────────────┘  │
│                └──────────┘         │         │
│                      │              ▼         │
│                      │       ┌──────────┐    │
│                      └──────▶│ Gesture  │    │
│                              │ Classify │    │
│                              └──────────┘    │
│                                   │          │
│                                   ▼          │
│                              ┌──────────┐    │
│                              │    UI    │    │
│                              │ Controls │    │
│                              └──────────┘    │
└──────────────────────────────────────────────┘
```

### Hand Gestures

| Gesture | Fingers Extended | Action |
|---|---|---|
| Paint | Index only | Draw on canvas at fingertip position |
| Hover | Index + Middle | Move cursor without drawing |
| Pinch | Thumb + Index close | Adjust brush size (distance = size) |
| Menu | All 5 spread | Toggle color palette |
| Undo | Pinky only | Undo last stroke |
| Save | Thumb only (up) | Download canvas as PNG |
| Fist | None (hold 1.5s) | Clear entire canvas |

### Tech Stack
- **ML**: MediaPipe Holistic via `@mediapipe/tasks-vision` (CDN: jsdelivr)
- **WASM**: MediaPipe's own WASM modules for inference
- **GPU**: WebGL backend for ML inference (automatic fallback to CPU)
- **Canvas**: HTML5 Canvas 2D API with offscreen rendering
- **Deploy**: GitHub Pages (static files)

## File Structure

```
paint/
├── .openspec/          # OpenSpec metadata
├── index.html          # Entry point, import map, DOM structure
├── css/
│   └── style.css       # Dark theme, responsive design
├── js/
│   ├── main.js         # App orchestrator, gesture routing
│   ├── handTracking.js # MediaPipe Holistic integration
│   ├── canvas.js       # Painting engine (bezier curves, undo/redo)
│   ├── gestures.js     # Gesture classification from landmarks
│   └── ui.js           # UI management (panels, overlays, HUD)
└── assets/             # (future: icons, models)
```

## Dependencies (CDN)

- `@mediapipe/tasks-vision@0.10.18` — Holistic Landmarker + WASM
- Standard Web APIs (Canvas, getUserMedia, ResizeObserver)

## Risks

1. **Camera permission denied** — Show error overlay with retry button
2. **GPU not available** — Automatic fallback to CPU delegate (slower but functional)
3. **WASM load failure** — CDN fallback or error message
4. **Low light / poor hand visibility** — Detection confidence thresholds; show "searching" state
5. **Mobile performance** — Cap devicePixelRatio at 2x, limit brush complexity

## Acceptance Criteria

- [x] App loads static files from GitHub Pages
- [x] MediaPipe Holistic loads WASM and initializes successfully
- [x] Camera stream starts and hand detection works
- [x] Index finger paint gesture draws smooth lines on canvas
- [x] Color palette allows color selection
- [x] Brush size adjusts via pinch/thumb-index distance
- [x] Undo gesture (pinky) reverts last stroke
- [x] Fist hold 1.5s clears canvas
- [x] Save gesture (thumb up) downloads PNG
- [x] PiP preview shows webcam with landmark overlay
- [x] Loading/error states handled gracefully
- [ ] Tested on Chrome, Firefox, Edge
- [ ] Works on mobile (responsive layout)
