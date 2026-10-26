// Minimal canvas line/scatter/bar chart with nice ticks and min/max decimation.
import type { Chart } from '../core/types';
import { COL, PALETTE } from '../core/gfx';
import { fmt } from '../core/num';

export interface ChartMap {
  xToPx: (x: number) => number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Keep only the first n points of every series that is indexed by table row (length === rowCount).
 * Analytic overlays with their own sampling (e.g. resonance curves) are left whole.
 */
export function revealChart(c: Chart, n: number, rowCount: number): Chart {
  return { ...c, series: c.series.map((s) => (s.x.length === rowCount ? { ...s, x: Array.prototype.slice.call(s.x, 0, n), y: Array.prototype.slice.call(s.y, 0, n) } : s)) };
}

function nice(lo: number, hi: number, n = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1, step: 0.2 };
  if (hi - lo < 1e-300 * Math.max(1, Math.abs(hi))) {
    const d = Math.abs(lo) * 0.05 || 1;
    lo -= d; hi += d;
  }
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

const tick = (v: number, step: number) => {
  if (Math.abs(v) < step * 1e-9) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1);
  const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + (step / 10 ** Math.floor(Math.log10(step)) === 1 ? 0 : 1)));
  return v.toFixed(d);
};

export function drawChart(cv: HTMLCanvasElement, c: Chart, o: { colors?: string[]; dashes?: boolean[]; rangeFrom?: Chart } = {}): ChartMap {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  const W = Math.max(50, r.width), H = Math.max(50, r.height);
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if (cv.width !== bw) cv.width = bw;
  if (cv.height !== bh) cv.height = bh;
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = COL.bg;
  g.fillRect(0, 0, W, H);
  g.font = '14px VT323, monospace';
  // legend gets its own row under the title, so it never covers data
  const legend = c.series.length > 1 || !!o.colors;
  const L = 52, R = W - 8, T = legend ? 32 : 20, B = H - 22;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  // axis ranges from the complete data when streaming a partial reveal (stable axes while data flows in)
  for (const s of (o.rangeFrom ?? c).series) for (let i = 0; i < s.x.length; i++) {
    const x = s.x[i], y = s.y[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (c.bars) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
  if (!Number.isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
  if (c.equal) {
    const sx = (x1 - x0) / (R - L), sy = (y1 - y0) / (B - T);
    const s = Math.max(sx, sy) || 1;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    x0 = cx - (s * (R - L)) / 2; x1 = cx + (s * (R - L)) / 2; y0 = cy - (s * (B - T)) / 2; y1 = cy + (s * (B - T)) / 2;
  }
  const nx = c.equal ? { lo: x0, hi: x1, step: nice(x0, x1).step } : nice(x0, x1);
  const ny = c.equal ? { lo: y0, hi: y1, step: nice(y0, y1, 4).step } : nice(y0, y1, 4);
  if (c.bars) { const pad = (x1 - x0) / Math.max(1, c.series[0]?.x.length ?? 1) || 0.5; nx.lo = x0 - pad; nx.hi = x1 + pad; }
  const X = (x: number) => L + ((x - nx.lo) / (nx.hi - nx.lo || 1)) * (R - L);
  const Y = (y: number) => B - ((y - ny.lo) / (ny.hi - ny.lo || 1)) * (B - T);
  // grid & ticks
  g.strokeStyle = COL.grid;
  g.fillStyle = COL.dim;
  g.lineWidth = 1;
  g.textAlign = 'right';
  for (let v = Math.ceil(ny.lo / ny.step) * ny.step; v <= ny.hi + ny.step * 1e-9; v += ny.step) {
    const yy = Math.round(Y(v)) + 0.5;
    g.beginPath(); g.moveTo(L, yy); g.lineTo(R, yy); g.stroke();
    g.fillText(tick(v, ny.step), L - 4, yy + 4);
  }
  g.textAlign = 'center';
  for (let v = Math.ceil(nx.lo / nx.step) * nx.step; v <= nx.hi + nx.step * 1e-9; v += nx.step) {
    const xx = Math.round(X(v)) + 0.5;
    g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, B); g.stroke();
    g.fillText(tick(v, nx.step), xx, B + 14);
  }
  g.strokeStyle = COL.dim;
  g.strokeRect(L + 0.5, T + 0.5, R - L, B - T);
  if (ny.lo < 0 && ny.hi > 0) { g.strokeStyle = '#2b3036'; g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(R, Y(0)); g.stroke(); }
  g.textAlign = 'left';
  g.fillStyle = COL.fg;
  g.fillText(c.title, L, 13);
  g.fillStyle = COL.dim;
  g.textAlign = 'right';
  g.fillText(`${c.xl}${c.yl ? '  |  ' + c.yl : ''}`, R, 13);
  g.save();
  g.beginPath(); g.rect(L, T, R - L, B - T); g.clip();
  c.series.forEach((s, si) => {
    const col = o.colors?.[si] ?? PALETTE[si % PALETTE.length];
    g.strokeStyle = col;
    g.fillStyle = col;
    g.setLineDash(s.dash || o.dashes?.[si] ? [4, 3] : []);
    const n = s.x.length;
    if (c.bars) {
      const w = Math.max(1, ((R - L) / Math.max(1, n)) * 0.7);
      for (let i = 0; i < n; i++) { const yy = Y(s.y[i]), y0p = Y(0); g.fillRect(X(s.x[i]) - w / 2, Math.min(yy, y0p), w, Math.abs(yy - y0p)); }
      return;
    }
    if (s.pts) {
      for (let i = 0; i < n; i++) if (Number.isFinite(s.y[i]) && Number.isFinite(s.x[i])) g.fillRect(X(s.x[i]) - 1.5, Y(s.y[i]) - 1.5, 3, 3);
      return;
    }
    let mono = true;
    for (let i = 1; i < n && mono; i++) if (s.x[i] < s.x[i - 1]) mono = false;
    g.lineWidth = 1.25;
    g.beginPath();
    let pen = false;
    if (mono && n > 3 * (R - L)) {
      // min/max per pixel column
      let col0 = -1, mn = 0, mx = 0, first = 0, last = 0;
      const flush = () => { if (col0 < 0) return; const xx = col0 + 0.5; if (!pen) { g.moveTo(xx, Y(first)); pen = true; } else g.lineTo(xx, Y(first)); g.lineTo(xx, Y(mn)); g.lineTo(xx, Y(mx)); g.lineTo(xx, Y(last)); };
      for (let i = 0; i < n; i++) {
        const y = s.y[i];
        if (!Number.isFinite(y)) continue;
        const cpx = Math.floor(X(s.x[i]));
        if (cpx !== col0) { flush(); col0 = cpx; mn = mx = first = last = y; }
        else { if (y < mn) mn = y; if (y > mx) mx = y; last = y; }
      }
      flush();
    } else {
      const stride = Math.max(1, Math.floor(n / 6000));
      for (let i = 0; i < n; i += stride) {
        const x = s.x[i], y = s.y[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
        if (!pen) { g.moveTo(X(x), Y(y)); pen = true; } else g.lineTo(X(x), Y(y));
      }
    }
    g.stroke();
  });
  g.restore();
  g.setLineDash([]);
  // legend
  if (legend) {
    g.textAlign = 'left';
    let lx = L;
    let more = 0;
    c.series.forEach((s, si) => {
      if (!s.name) return;
      const col = o.colors?.[si] ?? PALETTE[si % PALETTE.length];
      const w = g.measureText(s.name).width;
      if (lx + w + 16 > R) { more++; return; }
      g.fillStyle = col;
      g.fillRect(lx, T - 9, 8, 2);
      g.fillText(s.name, lx + 11, T - 5);
      lx += w + 22;
    });
    if (more) { g.fillStyle = COL.dim; g.textAlign = 'right'; g.fillText(`+${more}`, R, T - 5); }
  }
  return { xToPx: X, left: L, right: R, top: T, bottom: B };
}

export { fmt };
