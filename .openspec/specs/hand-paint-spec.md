# Spec: Hand Paint Application

## Overview

Single-page web application for painting using hand gestures detected via MediaPipe Holistic.

## Requirements

### R1: Hand Detection
- Use MediaPipe Holistic Landmarker (WASM + WebGL)
- Detect 21 hand landmarks per hand at 15-30 FPS
- Support both left and right hands; prefer right hand for painting
- Graceful degradation if no hand detected

### R2: Gesture Recognition
- Classify at least 7 distinct gestures from hand landmarks
- Use rotation-invariant finger extension detection
- Implement gesture stability (require N consecutive frames)
- Debounce state-changing gestures (undo, save, menu)

### R3: Canvas Engine
- Full-viewport canvas with devicePixelRatio awareness (capped at 2x)
- Smooth bezier curve interpolation between stroke points
- Exponential moving average smoothing on input coordinates
- Undo/redo history with up to 50 states (ImageData snapshots)
- Three brush types: round (radial gradient), flat (ellipse), spray (random dots)

### R4: UI Controls
- Color palette panel (20+ colors) toggleable via gesture or button
- Brush size HUD showing current size and color
- Action buttons: undo, redo, clear, save, palette toggle
- Webcam PiP preview (240x180) with landmark skeleton overlay
- Loading progress bar during WASM/model initialization
- Error overlay for camera permission denial

### R5: Deployment
- Static site, no backend
- Hosted on GitHub Pages
- All dependencies loaded via CDN (jsdelivr)
- ES module imports with import map

### R6: Performance
- GPU-accelerated ML inference (WebGL delegate)
- Automatic CPU fallback if WebGL unavailable
- `desynchronized: true` on canvas context for low-latency
- ResizeObserver for efficient canvas resize
- MAX_HISTORY limit to prevent memory leaks

## Gesture Reference

```
┌─────────┬────────────────────┬──────────────────┐
│ Gesture │ Detection          │ Action           │
├─────────┼────────────────────┼──────────────────┤
│ Paint   │ Index extended     │ Draw on canvas   │
│         │ only               │                  │
├─────────┼────────────────────┼──────────────────┤
│ Hover   │ Index + Middle     │ Cursor without   │
│         │ extended           │ drawing          │
├─────────┼────────────────────┼──────────────────┤
│ Pinch   │ Thumb-Index        │ Adjust brush     │
│         │ distance < 0.06    │ size             │
├─────────┼────────────────────┼──────────────────┤
│ Fist    │ No fingers ext.    │ Clear canvas     │
│         │ held 1.5s          │                  │
├─────────┼────────────────────┼──────────────────┤
│ Menu    │ All 5 spread       │ Toggle palette   │
├─────────┼────────────────────┼──────────────────┤
│ Undo    │ Pinky only         │ Undo last stroke │
├─────────┼────────────────────┼──────────────────┤
│ Save    │ Thumb only (up)    │ Download PNG     │
└─────────┴────────────────────┴──────────────────┘
```

## States

```
Loading → (WASM loaded) → Camera Ready → Running
                                    ↓
                              Error: Permission Denied
                                    ↓
                              User clicks Retry → Loading
```
