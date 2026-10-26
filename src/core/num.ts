// Numerical helpers: integrators, quadrature, root finding, complex math, formatting.
import type { Method, Settings } from './types';

export const G0 = 9.80665;
export const RGAS = 8.314462618;
export const GCONST = 6.6743e-11;
export const MU0 = 4e-7 * Math.PI * 1.00000000055;
export const DEG = Math.PI / 180;

export type F = (t: number, y: number[]) => number[];

/**
 * One integration step. For 'semi' (semi-implicit / symplectic Euler) the state must be laid
 * out as [q_0..q_{nq-1}, v_0..v_{nq-1}]; velocities are updated first, then positions use the
 * new velocities. Without nq the system is first-order and 'semi' degrades to explicit Euler.
 */
export function step(f: F, t: number, y: number[], dt: number, m: Method, nq?: number): number[] {
  const n = y.length;
  if (m === 'rk4') {
    const k1 = f(t, y);
    const y2 = new Array(n);
    for (let i = 0; i < n; i++) y2[i] = y[i] + 0.5 * dt * k1[i];
    const k2 = f(t + 0.5 * dt, y2);
    for (let i = 0; i < n; i++) y2[i] = y[i] + 0.5 * dt * k2[i];
    const k3 = f(t + 0.5 * dt, y2);
    for (let i = 0; i < n; i++) y2[i] = y[i] + dt * k3[i];
    const k4 = f(t + dt, y2);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    return out;
  }
  const d = f(t, y);
  const out = y.slice();
  if (m === 'euler' || !nq) {
    for (let i = 0; i < n; i++) out[i] += dt * d[i];
    return out;
  }
  for (let i = nq; i < n; i++) out[i] += dt * d[i];
  const d2 = f(t, out);
  for (let i = 0; i < nq; i++) out[i] = y[i] + dt * d2[i];
  return out;
}

export interface Traj {
  t: number[];
  y: number[][];
  stopped: boolean;
}

/** Integrate y' = f(t,y). stop(t,y) is checked after each step; the crossing step is kept. */
export function integrate(
  f: F,
  y0: number[],
  s: Settings,
  o: { nq?: number; t0?: number; stop?: (t: number, y: number[], i: number) => boolean } = {},
): Traj {
  const t: number[] = [o.t0 ?? 0];
  const ys: number[][] = [y0.slice()];
  let y = y0.slice();
  let tt = o.t0 ?? 0;
  const steps = Math.max(1, Math.floor(s.steps));
  let stopped = false;
  const t0 = o.t0 ?? 0;
  for (let i = 1; i <= steps; i++) {
    y = step(f, tt, y, s.dt, s.method, o.nq);
    tt = t0 + i * s.dt;
    t.push(tt);
    ys.push(y);
    // divergence guard: a NaN/inf anywhere poisons the sum; checked every 8 steps (a diverged run stops ≤7 steps late)
    if ((i & 7) === 0 || i === steps) {
      let sum = 0;
      for (let k = 0; k < y.length; k++) sum += y[k];
      if (!Number.isFinite(sum) && !y.every(Number.isFinite)) break;
    }
    if (o.stop && o.stop(tt, y, i)) {
      stopped = true;
      break;
    }
  }
  return { t, y: ys, stopped };
}

export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const sq = (x: number) => x * x;
export const hypot = Math.hypot;

export function linspace(a: number, b: number, n: number): number[] {
  if (n < 2) return [a];
  const o = new Array(n);
  for (let i = 0; i < n; i++) o[i] = a + ((b - a) * i) / (n - 1);
  return o;
}

export function trapz(x: ArrayLike<number>, y: ArrayLike<number>): number {
  let s = 0;
  for (let i = 1; i < x.length; i++) s += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
  return s;
}

export function cumtrapz(x: ArrayLike<number>, y: ArrayLike<number>): number[] {
  const o = [0];
  for (let i = 1; i < x.length; i++) o.push(o[i - 1] + 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]));
  return o;
}

/** Composite Simpson on [a,b] with n (even) intervals */
export function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  if (n % 2) n++;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

export function bisect(f: (x: number) => number, a: number, b: number, tol = 1e-13, it = 200): number {
  let fa = f(a);
  const fb = f(b);
  if (fa * fb > 0) return NaN;
  for (let i = 0; i < it; i++) {
    const m = 0.5 * (a + b);
    const fm = f(m);
    if (fm === 0 || (b - a) / 2 < tol * Math.max(1, Math.abs(m))) return m;
    if (fa * fm < 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return 0.5 * (a + b);
}

/** Arithmetic-geometric mean, used for exact pendulum period: T = T0 / AGM(1, cos(θ0/2)) */
export function agm(a: number, b: number): number {
  for (let i = 0; i < 60 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return a;
}

/** times at which x crosses `level` in direction dir (+1 upward, -1 downward), linearly interpolated */
export function crossings(t: ArrayLike<number>, x: ArrayLike<number>, level = 0, dir = 1): number[] {
  const o: number[] = [];
  for (let i = 1; i < x.length; i++) {
    const a = x[i - 1] - level,
      b = x[i] - level;
    if ((dir > 0 && a < 0 && b >= 0) || (dir < 0 && a > 0 && b <= 0)) o.push(t[i - 1] + ((t[i] - t[i - 1]) * -a) / (b - a));
  }
  return o;
}

export function meanPeriod(cr: number[]): number {
  if (cr.length < 2) return NaN;
  return (cr[cr.length - 1] - cr[0]) / (cr.length - 1);
}

/** linear interpolation of y(x) for monotonic x */
export function interp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  const inc = xs[n - 1] >= xs[0];
  let lo = 0,
    hi = n - 1;
  if (inc ? x <= xs[0] : x >= xs[0]) return ys[0];
  if (inc ? x >= xs[n - 1] : x <= xs[n - 1]) return ys[n - 1];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (inc ? xs[m] <= x : xs[m] >= x) lo = m;
    else hi = m;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

/** Gaussian elimination with partial pivoting. Mutates copies. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) throw new Error('singular system (mechanism / unstable structure)');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** eigen-decomposition of symmetric 2x2 [[a,b],[b,d]] -> ascending values, unit vectors */
export function eig2(a: number, b: number, d: number): { l: [number, number]; v: [number[], number[]] } {
  const m = (a + d) / 2,
    r = Math.sqrt(sq((a - d) / 2) + b * b);
  const l1 = m - r,
    l2 = m + r;
  let v1: number[];
  if (Math.abs(b) > 1e-14 * (Math.abs(a) + Math.abs(d))) v1 = [b, l1 - a];
  else v1 = a <= d ? [1, 0] : [0, 1];
  const n1 = Math.hypot(v1[0], v1[1]);
  v1 = [v1[0] / n1, v1[1] / n1];
  return { l: [l1, l2], v: [v1, [-v1[1], v1[0]]] };
}

// --- complex numbers ---
export type C = [number, number];
export const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
export const csub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
export const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
export const cabs = (a: C) => Math.hypot(a[0], a[1]);
export const cexp = (a: C): C => {
  const e = Math.exp(a[0]);
  return [e * Math.cos(a[1]), e * Math.sin(a[1])];
};
/** evaluate polynomial with real coefficients (highest power first) at complex z */
export function cpoly(c: number[], z: C): C {
  let r: C = [0, 0];
  for (const k of c) r = cadd(cmul(r, z), [k, 0]);
  return r;
}
/** derivative coefficients */
export const dpoly = (c: number[]) => c.slice(0, -1).map((k, i) => k * (c.length - 1 - i));

/** all roots of a real polynomial via Durand-Kerner */
export function roots(c: number[]): C[] {
  while (c.length > 1 && Math.abs(c[0]) < 1e-300) c = c.slice(1);
  const n = c.length - 1;
  if (n < 1) return [];
  const a = c.map((k) => k / c[0]);
  let z: C[] = [];
  const R = 1 + maxOf(a.slice(1).map(Math.abs));
  for (let i = 0; i < n; i++) z.push([R * 0.9 * Math.cos((2 * Math.PI * i) / n + 0.4), R * 0.9 * Math.sin((2 * Math.PI * i) / n + 0.4)]);
  for (let it = 0; it < 2000; it++) {
    let delta = 0;
    const nz = z.map((zi, i) => {
      let den: C = [1, 0];
      for (let j = 0; j < n; j++) if (j !== i) den = cmul(den, csub(zi, z[j]));
      const w = cdiv(cpoly(a, zi), den);
      delta = Math.max(delta, cabs(w));
      return csub(zi, w);
    });
    z = nz;
    if (delta < 1e-14 * R) break;
  }
  return z.map((r) => [r[0], Math.abs(r[1]) < 1e-10 * R ? 0 : r[1]] as C);
}

/** deterministic PRNG so runs are reproducible */
export function rng(seed = 12345) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmt(v: number, d = 3): string {
  if (v === undefined || v === null || Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e7 || a < 10 ** -d)) return v.toExponential(d);
  return v.toFixed(d);
}

export const colOf = (rows: number[][], j: number) => rows.map((r) => r[j]);

/** max / min of an array without spreading onto the call stack (safe for millions of elements; NaNs ignored) */
export function maxOf(a: ArrayLike<number>): number {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
  return m;
}
export function minOf(a: ArrayLike<number>): number {
  let m = Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
  return m;
}

/**
 * Safe arithmetic expression evaluator (no eval/Function): numbers incl. 1e-3, + - * / ^, parentheses,
 * unary minus, constants pi/e/g0, functions sqrt sin cos tan asin acos atan exp ln log10 abs. NaN on error.
 */
export function evalExpr(src: string): number {
  const s = src.replace(/\s+/g, '').toLowerCase();
  let i = 0;
  const FN: Record<string, (x: number) => number> = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, exp: Math.exp, ln: Math.log, log10: Math.log10, abs: Math.abs };
  const CONST: Record<string, number> = { pi: Math.PI, e: Math.E, g0: G0 };
  const fail = () => { throw new Error('bad expression'); };
  const atom = (): number => {
    if (s[i] === '(') { i++; const v = sum(); if (s[i++] !== ')') fail(); return v; }
    if (s[i] === '-') { i++; return -pow(); }
    if (s[i] === '+') { i++; return pow(); }
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; return parseFloat(num[0]); }
    const id = /^[a-z_][a-z0-9_]*/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      if (Object.hasOwn(FN, id[0]) && s[i] === '(') { i++; const v = sum(); if (s[i++] !== ')') fail(); return FN[id[0]](v); }
      if (Object.hasOwn(CONST, id[0])) return CONST[id[0]];
    }
    return fail();
  };
  const pow = (): number => { const b = atom(); if (s[i] === '^') { i++; return b ** pow(); } return b; };
  const prod = (): number => { let v = pow(); while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const r = pow(); v = op === '*' ? v * r : v / r; } return v; };
  const sum = (): number => { let v = prod(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = prod(); v = op === '+' ? v + r : v - r; } return v; };
  try {
    if (!s) return NaN;
    const v = sum();
    return i === s.length ? v : NaN;
  } catch { return NaN; }
}

export function maxAbs(a: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > m) m = Math.abs(a[i]);
  return m;
}

export function argmax(a: ArrayLike<number>): number {
  let k = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[k]) k = i;
  return k;
}

/** ASCII free-body diagram. forces: [label, fx, fy, unit] */
export function fbdAscii(title: string, forces: [string, number, number, string?][]): string[] {
  const W = 23,
    H = 11,
    cx = 11,
    cy = 5;
  const g = Array.from({ length: H }, () => Array(W).fill(' '));
  g[cy][cx] = '#';
  const live = forces.filter((f) => Math.hypot(f[1], f[2]) > 1e-12);
  const mags = live.map((f) => Math.hypot(f[1], f[2]));
  const mx = Math.max(1e-300, ...mags);
  live.forEach((f, i) => {
    const ang = Math.atan2(f[2], f[1]);
    const oct = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
    const dx = [1, 1, 0, -1, -1, -1, 0, 1][oct];
    const dy = [0, -1, -1, -1, 0, 1, 1, 1][oct];
    const body = ['-', '/', '|', '\\', '-', '/', '|', '\\'][oct];
    const head = ['>', '/', '^', '\\', '<', '/', 'v', '\\'][oct];
    const len = Math.max(2, Math.round(2 + 3 * (mags[i] / mx)));
    let x = cx,
      y = cy;
    for (let k = 1; k <= len; k++) {
      x = cx + dx * k * (dy === 0 ? 2 : 1);
      y = cy + dy * k;
      if (y < 0 || y >= H || x < 0 || x >= W) break;
      g[y][x] = k === len ? head : body;
      if (dy === 0 && x - dx >= 0 && x - dx < W) g[y][x - dx] = body;
    }
    const lx = clamp(x + dx * (dy === 0 ? 1 : 1), 0, W - 1),
      ly = clamp(y + dy, 0, H - 1);
    if (g[ly][lx] === ' ') g[ly][lx] = String.fromCharCode(65 + i);
  });
  const out = [title, ...g.map((r) => r.join(''))];
  live.forEach((f, i) => {
    const ang = (Math.atan2(f[2], f[1]) * 180) / Math.PI;
    out.push(`${String.fromCharCode(65 + i)} ${f[0].padEnd(8)} ${fmt(mags[i]).padStart(10)} ${f[3] ?? 'N'} @${ang.toFixed(1).padStart(6)}°`);
  });
  return out;
}
