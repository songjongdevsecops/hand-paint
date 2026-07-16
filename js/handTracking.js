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
  minHandDetectionConfidence: 0.4,   // Lower = detects hands more easily
  minHandTrackingConfidence: 0.3,    // Lower = keeps tracking longer
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
    this._didLogSkeleton = false;
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
   * Draw hand skeleton overlay for ALL detected hands.
   * Intense, high-contrast rendering — always visible.
   * Persists briefly after detection loss to prevent flicker.
   */
  drawSkeleton(ctx, w, h) {
    const hands = this.getHands();

    // DEBUG: bright yellow rect in top-left to prove drawSkeleton is called
    ctx.fillStyle = 'rgba(255,255,0,0.7)';
    ctx.fillRect(10, 10, 40, 40);

    // Persistence: keep rendering last known hands for a bit after loss
    if (hands.length > 0) {
      this._lastHands = hands;
      this._skeletonFramesLeft = this._SKELETON_PERSIST;
    } else if (this._skeletonFramesLeft > 0) {
      this._skeletonFramesLeft--;
    } else {
      // DEBUG: red rect = no hands, persistence expired
      ctx.fillStyle = 'rgba(255,0,0,0.7)';
      ctx.fillRect(10, 60, 40, 40);
      return;
    }

    // DEBUG: blue rect = hands exist, about to draw skeleton
    ctx.fillStyle = 'rgba(0,100,255,0.7)';
    ctx.fillRect(10, 110, 40, 40);

    // Draw red circle at center BEFORE the loop — proves we reach this code
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 100, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Log _lastHands structure
    console.log('[SKELETON DEBUG] _lastHands length:', this._lastHands.length);
    
    for (let hi = 0; hi < this._lastHands.length; hi++) {
      try {
        const h = this._lastHands[hi];
        console.log('[SKELETON DEBUG] hand[' + hi + '] keys:', Object.keys(h), 'landmarks:', typeof h.landmarks, Array.isArray(h.landmarks), h.landmarks?.length);
        
        const lm = h.landmarks;
        if (!lm || lm.length < 21) {
          console.log('[SKELETON DEBUG] SKIPPED hand[' + hi + '] — invalid landmarks');
          continue;
        }
        
        // Try accessing first landmark
        const first = lm[0];
        console.log('[SKELETON DEBUG] lm[0]:', first, 'type:', typeof first, 'x:', first?.x, 'y:', first?.y);
        
        // Draw yellow at wrist
        const x0 = this._mirrorX(first.x, w);
        const y0 = first.y * h;
        console.log('[SKELETON DEBUG] wrist screen pos:', x0, y0);
        
        ctx.fillStyle = '#ffff00';
        ctx.beginPath();
        ctx.arc(x0, y0, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.stroke();
        console.log('[SKELETON DEBUG] wrist circle drawn at', x0, y0);
        
        // Draw all landmarks
        for (let i = 0; i < lm.length; i++) {
          const p = lm[i];
          if (!p || typeof p.x !== 'number') continue;
          const x = this._mirrorX(p.x, w);
          const y = p.y * h;
          ctx.fillStyle = i === 8 ? '#ff0000' : '#00ff00';
          ctx.beginPath();
          ctx.arc(x, y, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        console.log('[SKELETON DEBUG] all', lm.length, 'landmark circles drawn');
      } catch(e) {
        console.error('[SKELETON DEBUG] ERROR in hand[' + hi + ']:', e.message, e.stack);
        // Draw error indicator
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(200, 10, 50, 50);
      }
    }
        const p = lm[i];
        if (!p || typeof p.x !== 'number') continue;
        const x = this._mirrorX(p.x, w);
        const y = p.y * h;
        
        ctx.fillStyle = i === 8 ? '#ff0000' : '#00ff00';
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
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
