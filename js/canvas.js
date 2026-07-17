// canvas.js — 3-layer compositing + draw/erase modes

export class PaintEngine {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d', { desynchronized: true });
    this.paint = document.createElement('canvas');
    this.pctx = this.paint.getContext('2d', { alpha: true });
    this.brush = { color: '#ff1493', size: 8, mode: 'draw' };
    this.drawing = false;
    this.history = []; this.hidx = -1;
    this.camAlpha = 0.10;
    this.camFn = null; this.skelFn = null;
    this._resize(); this._save(); this._bindResize();
  }

  _bindResize() { let t; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => this._resize(), 150); }).observe(this.c); }

  _resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.c.clientWidth, h = this.c.clientHeight;
    if (w <= 0 || h <= 0) return;
    if (this.c.width !== w * dpr || this.c.height !== h * dpr) {
      const old = this.paint.width > 0 ? this.pctx.getImageData(0, 0, this.paint.width, this.paint.height) : null;
      this.c.width = w * dpr; this.c.height = h * dpr;
      this.paint.width = w * dpr; this.paint.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (old) { const t = document.createElement('canvas'); t.width = old.width; t.height = old.height; t.getContext('2d').putImageData(old, 0, 0); this.pctx.drawImage(t, 0, 0, w, h); }
    }
  }

  _save() {
    if (!this.paint.width || this.paint.width * this.paint.height > 25e6) return;
    if (this.hidx < this.history.length - 1) this.history = this.history.slice(0, this.hidx + 1);
    this.history.push({ d: this.pctx.getImageData(0, 0, this.paint.width, this.paint.height), b: { ...this.brush } });
    if (this.history.length > 20) this.history.shift(); else this.hidx++;
  }

  undo() { if (this.hidx <= 0) return false; this.hidx--; const s = this.history[this.hidx]; this.pctx.putImageData(s.d, 0, 0); this.brush = { ...s.b }; return true; }
  redo() { if (this.hidx >= this.history.length - 1) return false; this.hidx++; const s = this.history[this.hidx]; this.pctx.putImageData(s.d, 0, 0); this.brush = { ...s.b }; return true; }
  clear() { this._save(); this.pctx.clearRect(0, 0, this.paint.width, this.paint.height); }
  setColor(c) { this.brush.color = c; }
  setSize(s) { this.brush.size = Math.max(2, Math.min(60, s)); document.getElementById('brushSize').textContent = Math.round(s) + 'px'; }
  getSize() { return this.brush.size; }
  setMode(m) { this.brush.mode = m; }

  frame() {
    const ctx = this.ctx, w = this.c.clientWidth, h = this.c.clientHeight;
    if (w <= 0 || h <= 0) return;
    ctx.clearRect(0, 0, w, h);
    ctx.save(); ctx.globalAlpha = this.camAlpha; if (this.camFn) this.camFn(ctx, w, h); ctx.restore();
    if (this.paint.width > 0) ctx.drawImage(this.paint, 0, 0, w, h);
    if (this.skelFn) this.skelFn(ctx, w, h);
  }

  start(p) { this.drawing = true; this._save(); this._dot(p); }
  move(p) { if (!this.drawing) return; this._dot(p); }
  end() { this.drawing = false; }

  _dot(p) {
    const ctx = this.pctx, r = this.brush.size / 2;
    if (this.brush.mode === 'erase') {
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return;
    }
    const hex = (this.brush.color || '#ff1493').replace('#', '');
    const rgb = hex.length === 3
      ? [parseInt(hex[0]+hex[0], 16), parseInt(hex[1]+hex[1], 16), parseInt(hex[2]+hex[2], 16)]
      : [parseInt(hex.substring(0,2), 16), parseInt(hex.substring(2,4), 16), parseInt(hex.substring(4,6), 16)];
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
    g.addColorStop(0, `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
    g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }

  download() { const a = document.createElement('a'); a.download = 'paint-' + Date.now() + '.png'; a.href = this.paint.toDataURL(); a.click(); }
}
