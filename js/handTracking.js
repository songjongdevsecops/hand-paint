/* ============================================================
   handTracking.js — MediaPipe HandLandmarker (hands-only, v3)
   
   Dedicated hand model — no face/pose overhead.
   numHands: 1 natively ensures single-hand detection.
   Much faster and more precise than Holistic.
   ============================================================ */

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

// HandLandmarker — dedicated hand model, lighter than Holistic
const MODEL_OPTIONS = {
  baseOptions: {
    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
    delegate: 'GPU',
  },
  runningMode: 'VIDEO',
  numHands: 1,                     // Native single-hand detection!
  minHandDetectionConfidence: 0.3,  // Lower to catch hands at distance
  minHandTrackingConfidence: 0.2,  // Sticky tracking
  minHandPresenceConfidence: 0.3,
};

export class HandTracker {
  constructor() {
    this.handLandmarker = null;
    this.video = null;
    this.stream = null;
    this.isRunning = false;
    this.lastResults = null;
    this.onResults = null;

    this.fps = 0;
    this._frameCount = 0;
    this._lastFpsUpdate = 0;
    this.detectionTime = 0;

    // EMA smoothing
    this._smoothFactor = 0.20;
    this._smoothedLandmarks = null;

    // Skeleton persistence
    this._lastHands = [];
    this._skeletonFramesLeft = 0;
    this._SKELETON_PERSIST = 15;
  }

  async initialize(videoElement, onProgress) {
    this.video = videoElement;
    const report = (pct, text) => onProgress && onProgress(pct, text);

    report(5, 'Requesting camera...');
    await this._startCamera();
    report(20, 'Camera ready. Loading WASM...');

    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    report(50, 'WASM loaded. Creating Hand Landmarker...');

    try {
      this.handLandmarker = await HandLandmarker.createFromOptions(fileset, MODEL_OPTIONS);
      report(80, 'Hand Landmarker ready (GPU). Starting...');
    } catch (err) {
      console.warn('[HandTracker] GPU failed, falling back to CPU:', err.message);
      MODEL_OPTIONS.baseOptions.delegate = 'CPU';
      this.handLandmarker = await HandLandmarker.createFromOptions(fileset, MODEL_OPTIONS);
      report(80, 'Hand Landmarker ready (CPU). Starting...');
    }

    console.log('[HandTracker] Initialized — delegate:', MODEL_OPTIONS.baseOptions.delegate, '| numHands:', MODEL_OPTIONS.numHands);
    this.isRunning = true;
    this._processLoop();
    report(100, 'Ready');
  }

  async _startCamera() {
    try {
      const cameraTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Camera permission timeout — please allow camera access and reload')), 15000)
      );

      this.stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } },
          audio: false
        }),
        cameraTimeout
      ]);

      this.video.srcObject = this.stream;

      await new Promise((resolve, reject) => {
        const onPlaying = () => { this.video.removeEventListener('playing', onPlaying); resolve(); };
        this.video.addEventListener('playing', onPlaying);
        this.video.play().catch(reject);
        setTimeout(() => { this.video.removeEventListener('playing', onPlaying); resolve(); }, 8000);
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
    if (!this.isRunning || !this.handLandmarker) return;

    const TARGET_FPS = 30;
    const INTERVAL = 1000 / TARGET_FPS;
    let lastTime = 0;

    const processFrame = (timestamp) => {
      if (!this.isRunning) return;
      if (timestamp - lastTime < INTERVAL) { requestAnimationFrame(processFrame); return; }
      lastTime = timestamp;

      const t0 = performance.now();

      try {
        if (this.video.readyState >= 2 && this.video.videoWidth > 0 && !this.video.paused) {
          const results = this.handLandmarker.detectForVideo(this.video, performance.now());
          this.lastResults = results;
          this.detectionTime = performance.now() - t0;
          this._smoothLandmarks(results);

          if (this.onResults) this.onResults(results, performance.now());

          this._frameCount++;
          const now = performance.now();
          if (now - this._lastFpsUpdate >= 1000) { this.fps = this._frameCount; this._frameCount = 0; this._lastFpsUpdate = now; }
        }
      } catch (err) {
        console.warn('[HandTracker] Detection error:', err.message);
      }

      requestAnimationFrame(processFrame);
    };

    requestAnimationFrame(processFrame);
  }

  /* ---- Rendering ---- */

  drawCameraFrame(ctx, w, h) {
    if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, w, h);
      ctx.restore();
    }
  }

  drawSkeleton(ctx, w, h) {
    const hands = this.getHands();

    if (hands.length > 0) {
      this._lastHands = [hands[0]]; // numHands:1 ensures max 1 hand anyway
      this._skeletonFramesLeft = this._SKELETON_PERSIST;
    } else if (this._skeletonFramesLeft > 0) {
      this._skeletonFramesLeft--;
    } else {
      return;
    }

    for (const hand of this._lastHands) {
      const lm = hand.landmarks;
      if (!lm || lm.length < 21) continue;
      const color = hand.handedness === 'Right' ? '#ff1493' : '#00ffff';

      // Scale bones proportionally to hand size on screen
      const handSize = Math.hypot(
        ((1 - lm[12].x) * w) - ((1 - lm[0].x) * w),
        (lm[12].y * h) - (lm[0].y * h)
      );
      const s = Math.max(0.4, Math.min(2.0, handSize / 120));
      const glow = Math.round(14 * s);
      const solid = Math.round(6 * s);
      const dotR = Math.round(8 * s);
      const tipR = Math.round(9 * s);

      // Glow
      this._drawConnections(ctx, lm, w, h, color + '55', glow);
      // Solid
      this._drawConnections(ctx, lm, w, h, color + 'cc', solid);

      // Joints
      for (const p of lm) {
        const x = w - (p.x * w);
        const y = p.y * h;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fingertips
      for (const idx of [4, 8, 12, 16, 20]) {
        const t = lm[idx];
        if (!t) continue;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(w - (t.x * w), t.y * h, tipR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawConnections(ctx, lm, w, h, color, lw) {
    const CONNS = [
      [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]
    ];
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    for (const [i, j] of CONNS) {
      if (!lm[i] || !lm[j]) continue;
      ctx.beginPath();
      ctx.moveTo((1 - lm[i].x) * w, lm[i].y * h);
      ctx.lineTo((1 - lm[j].x) * w, lm[j].y * h);
      ctx.stroke();
    }
  }

  /* ---- Smoothing ---- */

  _smoothLandmarks(results) {
    const sf = this._smoothFactor;
    const rawHands = results.landmarks;

    if (!rawHands || rawHands.length === 0) {
      if (this._smoothedLandmarks) this._smoothedLandmarks = [];
      return;
    }

    if (!this._smoothedLandmarks || this._smoothedLandmarks.length === 0) {
      this._smoothedLandmarks = rawHands.map(hand =>
        hand.map(lm => ({ x: lm.x, y: lm.y, z: lm.z || 0 }))
      );
      return;
    }

    for (let h = 0; h < rawHands.length; h++) {
      if (!this._smoothedLandmarks[h]) {
        this._smoothedLandmarks[h] = rawHands[h].map(lm => ({ x: lm.x, y: lm.y, z: lm.z || 0 }));
        continue;
      }
      const raw = rawHands[h];
      const smooth = this._smoothedLandmarks[h];
      for (let i = 0; i < raw.length; i++) {
        smooth[i].x += (raw[i].x - smooth[i].x) * sf;
        smooth[i].y += (raw[i].y - smooth[i].y) * sf;
        smooth[i].z += ((raw[i].z || 0) - smooth[i].z) * sf;
      }
    }
    this._smoothedLandmarks.length = rawHands.length;
  }

  /* ---- Landmark accessors ---- */

  getHands() {
    // Prefer smoothed, fallback raw
    const src = (this._smoothedLandmarks && this._smoothedLandmarks.length > 0)
      ? this._smoothedLandmarks
      : this.lastResults?.landmarks;

    if (!src || src.length === 0) return [];

    const hands = [];
    const handednessList = this.lastResults?.handedness || [];

    for (let i = 0; i < src.length; i++) {
      const lm = src[i];
      if (!lm || lm.length < 21) continue;

      // Get handedness from classification
      let handedness = 'Right';
      if (handednessList[i] && handednessList[i].length > 0) {
        handedness = handednessList[i][0].categoryName; // "Left" or "Right"
      }

      hands.push({ handedness, landmarks: lm });
    }

    return hands;
  }

  getPaintHand() {
    const hands = this.getHands();
    const right = hands.find(h => h.handedness === 'Right');
    return right || hands[0] || null;
  }

  dispose() {
    this.isRunning = false;
    if (this.handLandmarker) { this.handLandmarker.close(); this.handLandmarker = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  }
}
