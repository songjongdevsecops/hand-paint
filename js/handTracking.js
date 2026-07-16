/* ============================================================
   handTracking.js — MediaPipe Holistic integration
   
   Handles:
   - Camera access and video stream
   - MediaPipe Holistic WASM loading
   - Per-frame hand landmark detection
   - GPU acceleration via WebGL (MediaPipe internal)
   - Fallback and error handling
   ============================================================ */

import { HolisticLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// CDN URL for MediaPipe WASM files
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

// Holistic model options
const MODEL_OPTIONS = {
  baseOptions: {
    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task',
    delegate: 'GPU',  // 'GPU' for WebGL acceleration, 'CPU' for software fallback
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
    this.onResults = null; // Callback: (results, timestamp) => void

    // Performance tracking
    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
    this.detectionTime = 0;
  }

  /**
   * Initialize the tracker: load WASM, create HolisticLandmarker, start camera.
   * @param {HTMLVideoElement} videoElement - hidden video element for webcam
   * @param {function} onProgress - callback(progressPercent: number, statusText: string)
   */
  async initialize(videoElement, onProgress) {
    this.video = videoElement;
    const report = (pct, text) => onProgress && onProgress(pct, text);

    report(5, 'Requesting camera access...');

    // Step 1: Start webcam
    await this._startCamera();
    report(20, 'Camera ready. Loading WASM modules...');

    // Step 2: Initialize MediaPipe FilesetResolver (loads WASM)
    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    report(50, 'WASM loaded. Creating Holistic Landmarker...');

    // Step 3: Create HolisticLandmarker — try GPU first, fall back to CPU
    try {
      this.holisticLandmarker = await HolisticLandmarker.createFromOptions(fileset, MODEL_OPTIONS);
      report(80, 'Holistic Landmarker ready (GPU). Starting detection...');
    } catch (err) {
      console.warn('[HandTracker] GPU delegate failed, falling back to CPU:', err.message);
      MODEL_OPTIONS.baseOptions.delegate = 'CPU';
      this.holisticLandmarker = await HolisticLandmarker.createFromOptions(fileset, MODEL_OPTIONS);
      report(80, 'Holistic Landmarker ready (CPU). Starting detection...');
    }

    console.log('[HandTracker] Initialized — delegate:', MODEL_OPTIONS.baseOptions.delegate);
    this.isRunning = true;

    // Start processing loop
    this._processLoop();

    report(100, 'Ready');
  }

  /**
   * Start the webcam stream
   */
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

      // Wait until the video is actually playing (not just metadata loaded)
      await new Promise((resolve, reject) => {
        const onPlaying = () => {
          this.video.removeEventListener('playing', onPlaying);
          resolve();
        };
        this.video.addEventListener('playing', onPlaying);
        // Kick off playback
        this.video.play().catch(reject);
        // Safety: resolve after 8s even if 'playing' never fires
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

  /**
   * Main processing loop: detect landmarks on each frame
   * Throttled to ~30 FPS to avoid overwhelming MediaPipe
   */
  _processLoop() {
    if (!this.isRunning || !this.holisticLandmarker) return;

    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;
    let lastFrameTime = 0;

    const processFrame = (timestamp) => {
      if (!this.isRunning) return;

      // Throttle: only process at target FPS
      if (timestamp - lastFrameTime < FRAME_INTERVAL) {
        requestAnimationFrame(processFrame);
        return;
      }
      lastFrameTime = timestamp;

      const startTime = performance.now();

      try {
        // Check if video is actually playing and has dimensions
        if (this.video.readyState >= 2 && this.video.videoWidth > 0 && !this.video.paused) {
          // Run Holistic Landmarker detection
          const results = this.holisticLandmarker.detectForVideo(
            this.video,
            performance.now()
          );

          this.lastResults = results;
          this.detectionTime = performance.now() - startTime;

          // Call the results callback
          if (this.onResults) {
            this.onResults(results, performance.now());
          }

          // FPS calculation
          this.frameCount++;
          const now = performance.now();
          if (now - this.lastFpsUpdate >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
          }
        }
      } catch (err) {
        console.warn('[HandTracker] Detection error:', err.message);
      }

      // Schedule next frame
      requestAnimationFrame(processFrame);
    };

    requestAnimationFrame(processFrame);
  }

  /**
   * Get hand landmarks from the latest results.
   * Returns array of hands, each with landmarks array (21 points).
   */
  getHands() {
    if (!this.lastResults) return [];
    const hands = [];

    // MediaPipe returns leftHandLandmarks and rightHandLandmarks as arrays of arrays:
    // Each is NormalizedLandmark[][] — outer array = detected hands, inner = 21 landmarks
    if (this.lastResults.leftHandLandmarks && this.lastResults.leftHandLandmarks.length > 0) {
      for (const handLms of this.lastResults.leftHandLandmarks) {
        if (handLms && handLms.length >= 21) {
          hands.push({ handedness: 'left', landmarks: handLms });
        }
      }
    }
    if (this.lastResults.rightHandLandmarks && this.lastResults.rightHandLandmarks.length > 0) {
      for (const handLms of this.lastResults.rightHandLandmarks) {
        if (handLms && handLms.length >= 21) {
          hands.push({ handedness: 'right', landmarks: handLms });
        }
      }
    }

    return hands;
  }

  /**
   * Get the preferred hand for painting.
   * Returns the right hand if available, otherwise the left.
   */
  getPaintHand() {
    const hands = this.getHands();

    // Prefer right hand for painting (most people are right-handed)
    const rightHand = hands.find(h => h.handedness === 'right');
    if (rightHand) return rightHand;

    // Fallback to left
    return hands[0] || null;
  }

  /**
   * Draw landmarks on a canvas (for PiP preview)
   */
  drawPreview(ctx, canvasWidth, canvasHeight) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Always draw the video frame (mirrored)
    ctx.save();
    ctx.translate(canvasWidth, 0);
    ctx.scale(-1, 1);
    if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
      ctx.drawImage(this.video, 0, 0, canvasWidth, canvasHeight);
    }
    ctx.restore();

    // Draw hand landmarks overlay if we have results
    if (!this.lastResults) return;
    const hands = this.getHands();
    if (hands.length === 0) return;

    for (const hand of hands) {
      const landmarks = hand.landmarks;
      const color = hand.handedness === 'right' ? '#ff1493' : '#00ffff';

      // Draw connections
      this._drawHandConnections(ctx, landmarks, canvasWidth, canvasHeight, color + '88');

      // Draw landmark dots
      for (const lm of landmarks) {
        const x = canvasWidth - (lm.x * canvasWidth); // Mirror
        const y = lm.y * canvasHeight;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Highlight index fingertip (painting point)
      const indexTip = landmarks[8];
      const tipX = canvasWidth - (indexTip.x * canvasWidth);
      const tipY = indexTip.y * canvasHeight;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * Draw connection lines between hand landmarks
   */
  _drawHandConnections(ctx, landmarks, cw, ch, color) {
    // Connection list for hand skeleton (21 landmarks)
    const connections = [
      [0,1],[1,2],[2,3],[3,4],       // Thumb
      [0,5],[5,6],[6,7],[7,8],       // Index
      [0,9],[9,10],[10,11],[11,12],  // Middle
      [0,13],[13,14],[14,15],[15,16],// Ring
      [0,17],[17,18],[18,19],[19,20],// Pinky
      [5,9],[9,13],[13,17]           // Palm connections
    ];

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    for (const [i, j] of connections) {
      const a = landmarks[i];
      const b = landmarks[j];
      if (!a || !b) continue;

      ctx.beginPath();
      // Mirror x-axis for selfie view
      ctx.moveTo(cw - (a.x * cw), a.y * ch);
      ctx.lineTo(cw - (b.x * cw), b.y * ch);
      ctx.stroke();
    }
  }

  /**
   * Stop tracking and release resources
   */
  dispose() {
    this.isRunning = false;
    if (this.holisticLandmarker) {
      this.holisticLandmarker.close();
      this.holisticLandmarker = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    console.log('[HandTracker] Disposed');
  }
}
