// handTracking.js — MediaPipe GestureRecognizer (pre-trained gestures!)

import { GestureRecognizer, FilesetResolver } from 'vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';

const OPTS = {
  baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
  runningMode: 'VIDEO',
  numHands: 1,
  minHandDetectionConfidence: 0.3,
  minTrackingConfidence: 0.2,
  minHandPresenceConfidence: 0.3,
};

// Pre-trained gesture → our internal type
const GESTURE_MAP = {
  'Closed_Fist': 'none',
  'Open_Palm': 'clear',
  'Pointing_Up': 'paint',
  'Victory': 'nextColor',
  'Thumb_Up': 'redo',
  'Thumb_Down': 'undo',
  'ILoveYou': 'prevColor',
  'None': 'none',
};

export class HandTracker {
  constructor() {
    this.recognizer = null;
    this.video = null;
    this.stream = null;
    this.running = false;
    this.results = null;
    this.onResults = null;
    this.fps = 0; this._fc = 0; this._t0 = 0; this._dt = 0;
    this._smooth = null; this._sf = 0.20;
    this._last = null; this._persist = 0;
  }

  async init(video, onProgress) {
    this.video = video;
    const p = (n, t) => onProgress && onProgress(n, t);
    p(5, 'Camera...');
    await this._cam();
    p(20, 'WASM...');
    const fs = await FilesetResolver.forVisionTasks(WASM);
    p(50, 'Model...');
    try { this.recognizer = await GestureRecognizer.createFromOptions(fs, OPTS); }
    catch (e) { console.warn('GPU fail, CPU'); OPTS.baseOptions.delegate = 'CPU'; this.recognizer = await GestureRecognizer.createFromOptions(fs, OPTS); }
    p(80, 'Ready');
    this.running = true;
    this._loop();
    p(100, 'Ready');
  }

  async _cam() {
    const to = new Promise((_, r) => setTimeout(() => r(new Error('Camera timeout')), 15000));
    this.stream = await Promise.race([navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } }, audio: false }), to]);
    this.video.srcObject = this.stream;
    await new Promise((res, rej) => {
      const on = () => { this.video.removeEventListener('playing', on); res(); };
      this.video.addEventListener('playing', on);
      this.video.play().catch(rej);
      setTimeout(() => { this.video.removeEventListener('playing', on); res(); }, 8000);
    });
  }

  _loop() {
    let lt = 0;
    const f = (ts) => {
      if (!this.running) return;
      if (ts - lt < 33) { requestAnimationFrame(f); return; }
      lt = ts;
      const t0 = performance.now();
      try {
        if (this.video.readyState >= 2 && this.video.videoWidth > 0 && !this.video.paused) {
          const r = this.recognizer.recognizeForVideo(this.video, performance.now());
          this.results = r;
          this._dt = performance.now() - t0;
          this._smoothFn(r);
          if (this.onResults) this.onResults(r, performance.now());
          this._fc++;
          const n = performance.now();
          if (n - this._t0 >= 1000) { this.fps = this._fc; this._fc = 0; this._t0 = n; }
        }
      } catch (e) { console.warn('Detect err:', e.message); }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }

  _smoothFn(r) {
    const raw = r.landmarks;
    if (!raw || raw.length === 0) { this._smooth = null; return; }
    if (!this._smooth) { this._smooth = raw.map(h => h.map(l => ({ x: l.x, y: l.y, z: l.z || 0 }))); return; }
    for (let h = 0; h < raw.length; h++) {
      if (!this._smooth[h]) { this._smooth[h] = raw[h].map(l => ({ x: l.x, y: l.y, z: l.z || 0 })); continue; }
      for (let i = 0; i < raw[h].length; i++) {
        this._smooth[h][i].x += (raw[h][i].x - this._smooth[h][i].x) * this._sf;
        this._smooth[h][i].y += (raw[h][i].y - this._smooth[h][i].y) * this._sf;
        this._smooth[h][i].z += ((raw[h][i].z || 0) - this._smooth[h][i].z) * this._sf;
      }
    }
    this._smooth.length = raw.length;
  }

  /** Returns { handedness, landmarks, worldLandmarks, gesture } or null */
  getHand() {
    const src = this._smooth || this.results?.landmarks;
    if (!src || src.length === 0) return null;
    const lm = src[0];
    if (!lm || lm.length < 21) return null;
    const hd = this.results?.handedness;
    const hand = hd && hd[0] && hd[0][0] ? hd[0][0].categoryName : 'Right';
    // Get pre-trained gesture
    const gestures = this.results?.gestures;
    const rawGesture = (gestures && gestures[0] && gestures[0][0]) ? gestures[0][0].categoryName : 'None';
    return {
      handedness: hand,
      landmarks: lm,
      worldLandmarks: (this.results?.worldLandmarks || [])[0] || null,
      gesture: GESTURE_MAP[rawGesture] || 'none'
    };
  }

  drawCamera(ctx, w, h) {
    if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
      ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(this.video, 0, 0, w, h); ctx.restore();
    }
  }

  drawSkeleton(ctx, w, h) {
    const hand = this.getHand();
    if (hand) { this._last = hand; this._persist = 15; }
    else if (this._persist > 0) { this._persist--; }
    else return;
    if (!this._last) return;
    const lm = this._last.landmarks;
    if (!lm || lm.length < 21) return;
    const c = this._last.handedness === 'Right' ? '#ff1493' : '#00ffff';
    const hs = Math.hypot(((1 - lm[12].x) * w) - ((1 - lm[0].x) * w), (lm[12].y * h) - (lm[0].y * h));
    const s = Math.max(0.4, Math.min(2, hs / 120));
    const conns = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];
    const mx = (x) => (1 - x) * w;
    ctx.strokeStyle = c + '55'; ctx.lineWidth = Math.round(14 * s); ctx.lineCap = 'round';
    for (const [i, j] of conns) { if (!lm[i] || !lm[j]) continue; ctx.beginPath(); ctx.moveTo(mx(lm[i].x), lm[i].y * h); ctx.lineTo(mx(lm[j].x), lm[j].y * h); ctx.stroke(); }
    ctx.strokeStyle = c + 'cc'; ctx.lineWidth = Math.round(6 * s);
    for (const [i, j] of conns) { if (!lm[i] || !lm[j]) continue; ctx.beginPath(); ctx.moveTo(mx(lm[i].x), lm[i].y * h); ctx.lineTo(mx(lm[j].x), lm[j].y * h); ctx.stroke(); }
    const r = Math.round(8 * s);
    for (const p of lm) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(mx(p.x), p.y * h, r, 0, Math.PI * 2); ctx.fill(); }
    const tr = Math.round(9 * s);
    for (const i of [4, 8, 12, 16, 20]) { const t = lm[i]; if (!t) continue; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx(t.x), t.y * h, tr, 0, Math.PI * 2); ctx.fill(); }
  }

  dispose() {
    this.running = false;
    if (this.recognizer) { this.recognizer.close(); this.recognizer = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  }
}
