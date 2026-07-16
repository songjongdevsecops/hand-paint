/* ============================================================
   handTracking.js — MediaPipe Holistic integration v2
   
   Detects hands and provides:
   - Raw landmark data for gesture classification
   - Camera frame rendering (for background layer)
   - Skeleton overlay rendering (for top layer)
   ============================================================ */

import { HolisticLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

const MODEL_OPTIONS = {
  baseOptions: {
    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task',
    delegate: 'GPU',
  },
  runningMode: 'VIDEO',
  minFaceDetectionConfidence: 0.3,
  minFaceTrackingConfidence: 0.3,
  minHandDetectionConfidence: 0.5,
  minHandTrackingConfidence: 0.5,
  minPoseDetectionConfidence: 0.3,
  minPoseTrackingConfidence: 0.3,
  minFacePresenceConfidence: 0.3,
};

export class HandTracker {
  constructor() {
    this.holisticLandmarker = null;
    this.video = null;
    this.stream = null;
    this.isRunning = false;
    this.lastResults = null;
    this.onResults = null;

    // Performance
    this.fps = 0;
    this._frameCount = 0;
    this._lastFpsUpdate = 0;
    this.detectionTime = 0;

    // Skeleton persistence — keep rendering last known skeleton briefly after loss
    this._lastHands = [];
    this._skeletonFramesLeft = 0;
    this._SKELETON_PERSIST = 15; // frames to persist after detection loss
  }

  async initialize(videoElement, onProgress) {
    this.video = videoElement;
    const report = (pct, text) => onProgress && onProgress(pct, text);

    report(5, 'Requesting camera...');
    await this._startCamera();
    report(20, 'Camera ready. Loading WASM...');

    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    report(50, 'WASM loaded. Creating Holistic Landmarker...');

    try {
      this.holisticLandmarker = await HolisticLandmarker.createFromOptions(fileset, MODEL_OPTIONS);
      report(80, 'Landmarker ready (GPU). Starting...');
    } catch (err) {
      console.warn('[HandTracker] GPU failed, falling back to CPU:', err.message);
      MODEL_OPTIONS.baseOptions.delegate = 'CPU';
      this.holisticLandmarker = await HolisticLandmarker.createFromOptions(fileset, MODEL_OPTIONS);
      report(80, 'Landmarker ready (CPU). Starting...');
    }

    console.log('[HandTracker] Initialized — delegate:', MODEL_OPTIONS.baseOptions.delegate);
    this.isRunning = true;
    this._processLoop();
    report(100, 'Ready');
  }

  async _startCamera() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 }
        },
        audio: false
      });

      this.video.srcObject = this.stream;

      await new Promise((resolve, reject) => {
        const onPlaying = () => {
          this.video.removeEventListener('playing', onPlaying);
          resolve();
        };
        this.video.addEventListener('playing', onPlaying);
        this.video.play().catch(reject);
        setTimeout(() => {
          this.video.removeEventListener('playing', onPlaying);
          resolve();
        }, 8000);
      });

      console.log('[HandTracker] Camera started:', this.video.videoWidth, 'x', this.video.videoHeight);
    } catch (err) {
      console.error('[HandTracker] Camera error:', err);
      throw new Error(err.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access.'
        : 'Could not access camera: ' + err.message);
    }
  }

  _processLoop() {
    if (!this.isRunning || !this.holisticLandmarker) return;

    const TARGET_FPS = 30;
    const INTERVAL = 1000 / TARGET_FPS;
    let lastTime = 0;

    const processFrame = (timestamp) => {
      if (!this.isRunning) return;

      if (timestamp - lastTime < INTERVAL) {
        requestAnimationFrame(processFrame);
        return;
      }
      lastTime = timestamp;

      const t0 = performance.now();

      try {
        if (this.video.readyState >= 2 && this.video.videoWidth > 0 && !this.video.paused) {
          const results = this.holisticLandmarker.detectForVideo(this.video, performance.now());
          this.lastResults = results;
          this.detectionTime = performance.now() - t0;

          if (this.onResults) {
            this.onResults(results, performance.now());
          }

          this._frameCount++;
          const now = performance.now();
          if (now - this._lastFpsUpdate >= 1000) {
            this.fps = this._frameCount;
            this._frameCount = 0;
            this._lastFpsUpdate = now;
          }
        }
      } catch (err) {
        console.warn('[HandTracker] Detection error:', err.message);
      }

      requestAnimationFrame(processFrame);
    };

    requestAnimationFrame(processFrame);
  }

  /* ---- Public rendering methods (called by PaintEngine compositor) ---- */

  /**
   * Draw the camera frame to fill the given canvas context.
   * Uses stretch-to-fill so normalized hand coordinates map 1:1 to canvas pixels.
   */
  drawCameraFrame(ctx, w, h) {
    if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
      // Mirror horizontally for selfie view, stretch to fill canvas
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, w, h);
      ctx.restore();
    }
  }

  /**
   * Draw the hand skeleton overlay on the given canvas context.
   * Persists the last known skeleton for a few frames after detection drops
   * to prevent flickering.
   */
  drawSkeleton(ctx, w, h) {
    const hands = this.getHands();

    // Update persistence
    if (hands.length > 0) {
      this._lastHands = hands;
      this._skeletonFramesLeft = this._SKELETON_PERSIST;
    } else if (this._skeletonFramesLeft > 0) {
      this._skeletonFramesLeft--;
    } else {
      return; // Nothing to draw
    }

    const drawSet = hands.length > 0 ? hands : this._lastHands;

    for (const hand of drawSet) {
      const lm = hand.landmarks;
      const isRight = hand.handedness === 'right';

      // Glow color — right hand pink, left hand cyan
      const color = isRight ? '#ff1493' : '#00ffff';

      // Draw semi-transparent thick connections (glow)
      this._drawConnections(ctx, lm, w, h, color + '44', isRight ? 8 : 6);

      // Draw thinner solid connections
      this._drawConnections(ctx, lm, w, h, color + 'cc', isRight ? 3 : 2);

      // Draw joint dots
      for (const p of lm) {
        const x = this._mirrorX(p.x, w);
        const y = p.y * h;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, isRight ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawConnections(ctx, lm, w, h, color, lineWidth) {
    const CONNS = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],
      [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],
      [5,9],[9,13],[13,17]
    ];

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    for (const [i, j] of CONNS) {
      if (!lm[i] || !lm[j]) continue;
      ctx.beginPath();
      ctx.moveTo(this._mirrorX(lm[i].x, w), lm[i].y * h);
      ctx.lineTo(this._mirrorX(lm[j].x, w), lm[j].y * h);
      ctx.stroke();
    }
  }

  _mirrorX(x, w) {
    return (1 - x) * w;
  }

  /* ---- Landmark accessors ---- */

  getHands() {
    if (!this.lastResults) return [];
    const hands = [];

    if (this.lastResults.leftHandLandmarks) {
      for (const handLms of this.lastResults.leftHandLandmarks) {
        if (handLms && handLms.length >= 21) {
          hands.push({ handedness: 'left', landmarks: handLms });
        }
      }
    }
    if (this.lastResults.rightHandLandmarks) {
      for (const handLms of this.lastResults.rightHandLandmarks) {
        if (handLms && handLms.length >= 21) {
          hands.push({ handedness: 'right', landmarks: handLms });
        }
      }
    }

    return hands;
  }

  getPaintHand() {
    const hands = this.getHands();
    const right = hands.find(h => h.handedness === 'right');
    return right || hands[0] || null;
  }

  dispose() {
    this.isRunning = false;
    if (this.holisticLandmarker) {
      this.holisticLandmarker.close();
      this.holisticLandmarker = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }
}
