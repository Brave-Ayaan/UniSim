// Minimal wireframe canvas renderer with world->screen mapping (y up).
export const COL = {
  bg: '#0b0c0d',
  fg: '#c9d1d9',
  dim: '#4b525c',
  grid: '#1a1d21',
  a: '#7fd1ff',
  b: '#ffb454',
  c: '#8ae68a',
  d: '#ff6b6b',
  e: '#c792ea',
  f: '#f2e86d',
};
export const PALETTE = ['#7fd1ff', '#ffb454', '#8ae68a', '#ff6b9d', '#c792ea', '#f2e86d', '#5ccfe6', '#ff8f40', '#b0b8c4'];

export class Gfx {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  sx = 1;
  sy = 1;
  ox = 0;
  oy = 0;
  /** height of the text band reserved at the top for hud() so labels never sit on top of the scene */
  static HUD = 34;
  top = Gfx.HUD;
  /** extra space kept free on the right (for gauges/bars a module draws in pixel space) */
  insetR = 0;
  /**
   * sub: draw into a rectangle of an existing context (caller has translated/clipped to it);
   * used to tile several simulations in one canvas
   */
  constructor(public cv: HTMLCanvasElement, sub?: { ctx: CanvasRenderingContext2D; W: number; H: number }) {
    if (sub) {
      this.ctx = sub.ctx;
      this.W = sub.W;
      this.H = sub.H;
      this.ctx.font = '14px VT323, monospace';
      this.ctx.fillStyle = COL.bg;
      this.ctx.fillRect(0, 0, this.W, this.H);
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    // clientWidth/Height avoid a layout-forcing getBoundingClientRect; the backing store is only
    // reallocated when the size actually changes (it used to be re-created on every animation frame)
    this.W = Math.max(10, cv.clientWidth || cv.getBoundingClientRect().width);
    this.H = Math.max(10, cv.clientHeight || cv.getBoundingClientRect().height);
    const bw = Math.round(this.W * dpr), bh = Math.round(this.H * dpr);
    if (cv.width !== bw) cv.width = bw;
    if (cv.height !== bh) cv.height = bh;
    this.ctx = cv.getContext('2d')!;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.font = '14px VT323, monospace';
    this.ctx.lineCap = 'square';
    this.ctx.fillStyle = COL.bg;
    this.ctx.fillRect(0, 0, this.W, this.H);
  }
  /** fit world rect into canvas. equal = same scale on both axes */
  view(x0: number, x1: number, y0: number, y1: number, pad = 18, equal = true) {
    if (!(x1 > x0)) x1 = x0 + 1;
    if (!(y1 > y0)) y1 = y0 + 1;
    // drawable box excludes the HUD band (top) and any right inset
    const L = pad, R = Math.max(L + 10, this.W - pad - this.insetR), T = pad + this.top, B = Math.max(T + 10, this.H - pad);
    let sx = (R - L) / (x1 - x0),
      sy = (B - T) / (y1 - y0);
    if (equal) sx = sy = Math.min(sx, sy);
    this.sx = sx;
    this.sy = sy;
    this.ox = (L + R) / 2 - ((x0 + x1) / 2) * sx;
    this.oy = (T + B) / 2 + ((y0 + y1) / 2) * sy;
    return this;
  }
  X = (x: number) => this.ox + x * this.sx;
  Y = (y: number) => this.oy - y * this.sy;
  line(x1: number, y1: number, x2: number, y2: number, c = COL.fg, w = 1, dash?: number[]) {
    const g = this.ctx;
    g.strokeStyle = c;
    g.lineWidth = w;
    g.setLineDash(dash ?? []);
    g.beginPath();
    g.moveTo(this.X(x1), this.Y(y1));
    g.lineTo(this.X(x2), this.Y(y2));
    g.stroke();
    g.setLineDash([]);
  }
  path(xs: ArrayLike<number>, ys: ArrayLike<number>, c = COL.fg, w = 1, close = false, dash?: number[]) {
    if (xs.length < 2) return;
    const g = this.ctx;
    g.strokeStyle = c;
    g.lineWidth = w;
    g.setLineDash(dash ?? []);
    g.beginPath();
    let px = this.X(xs[0]), py = this.Y(ys[0]);
    g.moveTo(px, py);
    const n = xs.length;
    // drop vertices closer than ~0.6 px to the last emitted one (visually lossless, O(n) but far fewer GPU segments)
    for (let i = 1; i < n; i++) {
      const X = this.X(xs[i]), Y = this.Y(ys[i]);
      if (i < n - 1 && Math.abs(X - px) + Math.abs(Y - py) < 0.6) continue;
      g.lineTo(X, Y);
      px = X; py = Y;
    }
    if (close) g.closePath();
    g.stroke();
    g.setLineDash([]);
  }
  fillPoly(xs: number[], ys: number[], c: string) {
    const g = this.ctx;
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(this.X(xs[0]), this.Y(ys[0]));
    for (let i = 1; i < xs.length; i++) g.lineTo(this.X(xs[i]), this.Y(ys[i]));
    g.closePath();
    g.fill();
  }
  /** circle: r in world units unless px = true */
  circle(x: number, y: number, r: number, c = COL.fg, fill = false, px = false) {
    const g = this.ctx;
    const rr = Math.max(0.5, px ? r : r * this.sx);
    g.beginPath();
    g.arc(this.X(x), this.Y(y), rr, 0, 2 * Math.PI);
    if (fill) {
      g.fillStyle = c;
      g.fill();
    } else {
      g.strokeStyle = c;
      g.lineWidth = 1;
      g.stroke();
    }
  }
  rect(x: number, y: number, w: number, h: number, c = COL.fg, fill = false) {
    const g = this.ctx;
    const X = this.X(x),
      Y = this.Y(y + h);
    if (fill) {
      g.fillStyle = c;
      g.fillRect(X, Y, w * this.sx, h * this.sy);
    } else {
      g.strokeStyle = c;
      g.lineWidth = 1;
      g.strokeRect(X + 0.5, Y + 0.5, w * this.sx, h * this.sy);
    }
  }
  /** arrow from world point; (dx,dy) in pixels (screen y up) */
  arrow(x: number, y: number, dx: number, dy: number, c = COL.f, label?: string) {
    const X = this.X(x),
      Y = this.Y(y);
    const L = Math.hypot(dx, dy);
    if (L < 1) return;
    const g = this.ctx;
    const ex = X + dx,
      ey = Y - dy;
    g.strokeStyle = c;
    g.fillStyle = c;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X, Y);
    g.lineTo(ex, ey);
    g.stroke();
    const a = Math.atan2(-dy, dx);
    const h = Math.min(7, L * 0.4);
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(ex - h * Math.cos(a - 0.4), ey - h * Math.sin(a - 0.4));
    g.lineTo(ex - h * Math.cos(a + 0.4), ey - h * Math.sin(a + 0.4));
    g.closePath();
    g.fill();
    if (label) this.textPx(label, ex + 4, ey - 2, c);
  }
  text(s: string, x: number, y: number, c = COL.fg, align: CanvasTextAlign = 'left') {
    this.textPx(s, this.X(x), this.Y(y), c, align);
  }
  textPx(s: string, X: number, Y: number, c = COL.fg, align: CanvasTextAlign = 'left') {
    const g = this.ctx;
    g.fillStyle = c;
    g.textAlign = align;
    g.fillText(s, X, Y);
    g.textAlign = 'left';
  }
  /** zig-zag spring between two world points */
  spring(x1: number, y1: number, x2: number, y2: number, c = COL.fg, coils = 8, wPx = 6) {
    const X1 = this.X(x1),
      Y1 = this.Y(y1),
      X2 = this.X(x2),
      Y2 = this.Y(y2);
    const L = Math.hypot(X2 - X1, Y2 - Y1);
    if (L < 1) return;
    const ux = (X2 - X1) / L,
      uy = (Y2 - Y1) / L;
    const g = this.ctx;
    g.strokeStyle = c;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X1, Y1);
    const n = coils * 2;
    for (let i = 1; i < n; i++) {
      const f = i / n,
        s = i % 2 ? wPx : -wPx;
      g.lineTo(X1 + ux * L * f - uy * s, Y1 + uy * L * f + ux * s);
    }
    g.lineTo(X2, Y2);
    g.stroke();
  }
  ground(x0: number, x1: number, y: number) {
    this.line(x0, y, x1, y, COL.dim);
    const g = this.ctx;
    g.strokeStyle = COL.dim;
    for (let X = this.X(x0); X < this.X(x1); X += 8) {
      g.beginPath();
      g.moveTo(X, this.Y(y));
      g.lineTo(X - 5, this.Y(y) + 5);
      g.stroke();
    }
  }
  hud(lines: string[], c = COL.fg) {
    // opaque band + divider: readouts stay legible and never overlap the drawing below
    const g = this.ctx;
    g.fillStyle = COL.bg;
    g.fillRect(0, 0, this.W, this.top - 2);
    g.fillStyle = '#1f2328';
    g.fillRect(0, this.top - 2, this.W, 1);
    g.save();
    g.beginPath();
    g.rect(0, 0, this.W, this.top - 2);
    g.clip();
    lines.slice(0, 2).forEach((l, i) => this.textPx(l, 6, 14 + i * 14, i === 0 ? c : COL.dim));
    g.restore();
  }
}

/** map a value in [0,1] to a cold->hot colour */
export function heat(f: number): string {
  f = Math.max(0, Math.min(1, f));
  const r = Math.round(40 + 215 * f),
    g = Math.round(90 + 120 * (1 - Math.abs(f - 0.5) * 2)),
    b = Math.round(255 * (1 - f));
  return `rgb(${r},${g},${b})`;
}
