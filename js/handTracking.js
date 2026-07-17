// handTracking.js — Two-hand detection + ghost filtering + EMA smoothing

import { HandLandmarker, FilesetResolver } from 'vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

const OPTS = {
  baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
  runningMode: 'VIDEO', numHands: 2,
  minHandDetectionConfidence: 0.3, minHandTrackingConfidence: 0.2, minHandPresenceConfidence: 0.3,
};

export class HandTracker {
  constructor() {
    this.landmarker = null; this.video = null; this.stream = null; this.running = false;
    this.results = null; this.onResults = null;
    this.fps = 0; this._fc = 0; this._t0 = 0; this._dt = 0;
    this._smooth = null; this._sf = 0.20;
    this._last = []; this._persist = 0;
    this._ghostFrames = new Map();
  }

  async init(video, onProgress) {
    this.video = video; const p = (n, t) => onProgress && onProgress(n, t);
    p(5, 'Camera...'); await this._cam(); p(20, 'WASM...');
    const fs = await FilesetResolver.forVisionTasks(WASM); p(50, 'Model...');
    try { this.landmarker = await HandLandmarker.createFromOptions(fs, OPTS); }
    catch (e) { console.warn('GPU fail, CPU'); OPTS.baseOptions.delegate = 'CPU'; this.landmarker = await HandLandmarker.createFromOptions(fs, OPTS); }
    this.running = true; this._loop(); p(100, 'Ready');
  }

  async _cam() {
    const to = new Promise((_, r) => setTimeout(() => r(new Error('Camera timeout')), 15000));
    this.stream = await Promise.race([navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } }, audio: false }), to]);
    this.video.srcObject = this.stream;
    await new Promise((res, rej) => {
      const on = () => { this.video.removeEventListener('playing', on); res(); };
      this.video.addEventListener('playing', on); this.video.play().catch(rej);
      setTimeout(() => { this.video.removeEventListener('playing', on); res(); }, 8000);
    });
  }

  _loop() {
    let lt = 0;
    const f = (ts) => {
      if (!this.running) return;
      if (ts - lt < 33) { requestAnimationFrame(f); return; }
      lt = ts; const t0 = performance.now();
      try {
        if (this.video.readyState >= 2 && this.video.videoWidth > 0 && !this.video.paused) {
          const r = this.landmarker.detectForVideo(this.video, performance.now());
          this.results = r; this._dt = performance.now() - t0;
          this._smoothFn(r);
          if (this.onResults) this.onResults(r, performance.now());
          this._fc++; const n = performance.now(); if (n - this._t0 >= 1000) { this.fps = this._fc; this._fc = 0; this._t0 = n; }
        }
      } catch (e) {}
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

  getHands() {
    const src = this._smooth || this.results?.landmarks;
    if (!src || src.length === 0) { this._last = []; this._persist = 0; return []; }
    const hands = []; const hd = this.results?.handedness || []; const wl = this.results?.worldLandmarks || [];
    for (let i = 0; i < src.length; i++) {
      const lm = src[i]; if (!lm || lm.length < 21) continue;
      const hand = hd[i] && hd[i][0] ? hd[i][0].categoryName : 'Right';
      const score = hd[i] && hd[i][0] ? hd[i][0].score : 0;
      const key = hand + '_' + i;
      const fc = (this._ghostFrames.get(key) || 0) + 1; this._ghostFrames.set(key, fc);
      if (fc < 5) continue;
      const pointer = lm[8];
      const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
      hands.push({ handedness: hand, landmarks: lm, worldLandmarks: wl[i] || null, pointer, pinchDist, confidence: score });
    }
    if (hands.length > 0) { this._last = hands; this._persist = 15; }
    else if (this._persist > 0) { this._persist--; return this._last; }
    return hands;
  }

  drawCamera(ctx, w, h) {
    if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
      ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(this.video, 0, 0, w, h); ctx.restore();
    }
  }

  drawSkeletons(ctx, w, h, hands) {
    if (!hands || hands.length === 0) return;
    for (const hand of hands) {
      const lm = hand.landmarks; if (!lm || lm.length < 21) continue;
      const c = hand.handedness === 'Right' ? '#ff1493' : '#00ffff';
      const hs = Math.hypot(((1 - lm[12].x) * w) - ((1 - lm[0].x) * w), (lm[12].y * h) - (lm[0].y * h));
      const s = Math.max(0.3, Math.min(2, hs / 120));
      const conns = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];
      const mx = (x) => (1 - x) * w;
      ctx.strokeStyle = c + '55'; ctx.lineWidth = Math.round(12 * s); ctx.lineCap = 'round';
      for (const [i, j] of conns) { if (!lm[i] || !lm[j]) continue; ctx.beginPath(); ctx.moveTo(mx(lm[i].x), lm[i].y * h); ctx.lineTo(mx(lm[j].x), lm[j].y * h); ctx.stroke(); }
      ctx.strokeStyle = c + 'cc'; ctx.lineWidth = Math.round(5 * s);
      for (const [i, j] of conns) { if (!lm[i] || !lm[j]) continue; ctx.beginPath(); ctx.moveTo(mx(lm[i].x), lm[i].y * h); ctx.lineTo(mx(lm[j].x), lm[j].y * h); ctx.stroke(); }
      const r = Math.round(7 * s);
      for (const p of lm) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(mx(p.x), p.y * h, r, 0, Math.PI * 2); ctx.fill(); }
      const tip = lm[8]; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx(tip.x), tip.y * h, Math.round(10 * s), 0, Math.PI * 2); ctx.fill();
    }
  }

  dispose() {
    this.running = false;
    if (this.landmarker) { this.landmarker.close(); this.landmarker = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  }
}
