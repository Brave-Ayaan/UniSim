import type { SimModule, Result, Params, Settings, Check } from '../core/types';
import { integrate, DEG, G0, fbdAscii, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

const BETA: Record<string, number> = { 'solid sphere': 2 / 5, 'hollow sphere': 2 / 3, 'solid cylinder': 1 / 2, hoop: 1 };
const FLY: Record<string, (m: number, r: number) => number> = {
  disk: (m, r) => 0.5 * m * r * r,
  ring: (m, r) => m * r * r,
  'rod about centre (r = half-length)': (m, r) => (m * (2 * r) ** 2) / 12,
  'solid sphere': (m, r) => 0.4 * m * r * r,
};

export const rotation: SimModule = {
  id: 'rotation',
  name: 'Rotational dynamics',
  desc: 'rolling with/without slip, flywheel torque & angular momentum, heavy symmetric top (gyroscopic precession)',
  timeBased: true,
  settings: { dt: 0.0005, steps: 6000, method: 'rk4' },
  modeSettings: { rolling: { dt: 0.0005, steps: 6000 }, flywheel: { dt: 0.01, steps: 6000 }, gyroscope: { dt: 0.0001, steps: 40000 } },
  params: [
    { k: 'mode', l: 'mode', v: 'rolling', o: ['rolling', 'flywheel', 'gyroscope'] },
    { k: 'shape', l: 'body', v: 'solid sphere', o: Object.keys(BETA), when: (p) => p.mode === 'rolling' },
    { k: 'fshape', l: 'flywheel shape', v: 'disk', o: Object.keys(FLY), when: (p) => p.mode === 'flywheel' },
    { k: 'm', l: 'mass', u: 'kg', v: 1, min: 1e-9, s: 0.1 },
    { k: 'r', l: 'radius', u: 'm', v: 0.1, min: 1e-9, s: 0.01 },
    { k: 'th', l: 'incline angle', u: 'deg', v: 30, min: 0, max: 89, s: 1, when: (p) => p.mode === 'rolling' },
    { k: 'mus', l: 'static friction μs', v: 0.3, min: 0, s: 0.01, when: (p) => p.mode === 'rolling' },
    { k: 'muk', l: 'kinetic friction μk', v: 0.2, min: 0, s: 0.01, when: (p) => p.mode === 'rolling' },
    { k: 'Ld', l: 'incline length', u: 'm', v: 2, min: 1e-9, s: 0.1, when: (p) => p.mode === 'rolling' },
    { k: 'tau', l: 'applied torque', u: 'N m', v: 5, s: 0.5, when: (p) => p.mode === 'flywheel' },
    { k: 'b', l: 'bearing friction', u: 'N m s', v: 0.1, min: 0, s: 0.01, when: (p) => p.mode === 'flywheel' },
    { k: 'toff', l: 'torque off at', u: 's', v: 30, min: 0, s: 1, when: (p) => p.mode === 'flywheel' },
    { k: 'l', l: 'pivot to disk centre', u: 'm', v: 0.15, min: 1e-9, s: 0.01, when: (p) => p.mode === 'gyroscope' },
    { k: 'rpm', l: 'spin', u: 'rpm', v: 3000, s: 100, when: (p) => p.mode === 'gyroscope' },
    { k: 'th0', l: 'tilt from vertical', u: 'deg', v: 60, min: 1, max: 179, s: 5, when: (p) => p.mode === 'gyroscope' },
    { k: 'init', l: 'initial condition', v: 'steady precession', o: ['steady precession', 'released (nutation)'], when: (p) => p.mode === 'gyroscope' },
    { k: 'g', l: 'gravity', u: 'm/s2', v: G0, s: 0.1 },
  ],
  run(p, s) {
    const m = str(p, 'mode');
    if (m === 'rolling') return rolling(p, s);
    if (m === 'flywheel') return flywheel(p, s);
    return gyro(p, s);
  },
};

function rolling(p: Params, s: Settings): Result {
  const m = num(p, 'm'), r = num(p, 'r'), th = num(p, 'th') * DEG, mus = num(p, 'mus'), muk = num(p, 'muk'), L = num(p, 'Ld'), g = num(p, 'g');
  const beta = BETA[str(p, 'shape')], I = beta * m * r * r;
  const N = m * g * Math.cos(th), Fg = m * g * Math.sin(th);
  const fRoll = (Fg * beta) / (1 + beta); // friction needed for pure rolling
  const rolls = fRoll <= mus * N + 1e-15;
  // state [s, phi, v, w] (nq = 2)
  const fr = (v: number, w: number) => {
    const slip = v - w * r;
    if (Math.abs(slip) < 1e-9 && rolls) return fRoll;
    return muk * N * Math.sign(slip || 1);
  };
  const f = (_t: number, y: number[]) => {
    const F = fr(y[2], y[3]);
    return [y[2], y[3], (Fg - F) / m, (F * r) / I];
  };
  const tr = integrate(f, [0, 0, 0, 0], s, { nq: 2, stop: (_t, y) => y[0] >= L });
  const cols = ['t', 's', 'v', 'omega', 'slip v-ωr', 'friction', 'KE_trans', 'KE_rot', 'PE', 'heat', 'E_total'];
  let Q = 0;
  const rows = tr.t.map((t, i) => {
    const [sp, , v, w] = tr.y[i];
    if (i > 0) {
      const [, , v0, w0] = tr.y[i - 1];
      Q += fr(0.5 * (v + v0), 0.5 * (w + w0)) * Math.abs(0.5 * (v - w * r + v0 - w0 * r)) * s.dt;
    }
    const KEt = 0.5 * m * v * v, KEr = 0.5 * I * w * w, PE = m * g * (L - sp) * Math.sin(th);
    return [t, sp, v, w, v - w * r, fr(v, w), KEt, KEr, PE, Q, KEt + KEr + PE + Q];
  });
  // land exactly at s = L
  if (tr.stopped && rows.length > 1) {
    const a = rows[rows.length - 2], b = rows[rows.length - 1], fq = (L - a[1]) / (b[1] - a[1]);
    rows[rows.length - 1] = a.map((v, j) => v + fq * (b[j] - v));
  }
  const last = rows[rows.length - 1];
  const checks: Check[] = [];
  if (rolls) {
    const a = (g * Math.sin(th)) / (1 + beta);
    const T = Math.sqrt((2 * L) / a);
    checks.push({ l: 'time to bottom √(2L(1+β)/g sinθ)', exp: T, act: last[0], u: 's' });
    checks.push({ l: 'final speed √(2gh/(1+β))', exp: a * T, act: last[2], u: 'm/s' });
    checks.push({ l: 'KE_rot/KE = β/(1+β)', exp: beta / (1 + beta), act: last[7] / (last[6] + last[7]) });
  } else {
    const a = g * (Math.sin(th) - muk * Math.cos(th));
    checks.push({ l: 'slipping: time to bottom', exp: Math.sqrt((2 * L) / a), act: last[0], u: 's', ref: true });
  }
  checks.push({ l: 'energy (incl. friction heat)', exp: rows[0][10], act: last[10], u: 'J', abs: 1e-5 * rows[0][10] });
  return {
    cols, rows, checks,
    notes: [rolls ? `rolls without slipping (needs μs ≥ ${(fRoll / N).toFixed(4)})` : `slips: μs < ${(fRoll / N).toFixed(4)}, kinetic friction acts`],
    scalars: [{ l: 'I = βmr²', v: I, u: 'kg m2' }, { l: 'β', v: beta }, { l: 'required μs', v: fRoll / N }, { l: 'final speed', v: last[2], u: 'm/s' }, { l: 'time to bottom', v: last[0], u: 's' }],
    charts: [chart(cols, rows, 'v', 'v and ωr', 't', ['v', 'slip v-ωr']), chart(cols, rows, 'e', 'energy', 't', ['KE_trans', 'KE_rot', 'PE', 'heat', 'E_total'], { yl: 'J' })],
    draw(G, i) {
      const q = rows[i];
      const c = Math.cos(th), sn = Math.sin(th);
      G.view(-r * 2, L * c + r * 2, -r * 2, L * sn + r * 3);
      G.line(0, L * sn, L * c, 0, COL.dim);
      const cx = q[1] * c - r * sn * -1 * 0 + r * sn, cy = (L - q[1]) * sn + r * c;
      G.circle(cx, cy, r, COL.a);
      const phi = tr.y[Math.min(i, tr.y.length - 1)][1];
      G.line(cx, cy, cx + r * Math.cos(-phi), cy + r * Math.sin(-phi), COL.b);
      G.hud([`t=${q[0].toFixed(3)} v=${q[2].toFixed(3)} ω=${q[3].toFixed(3)} slip=${q[4].toExponential(2)}`]);
    },
    fbd(i) {
      const q = rows[i];
      const F = q[5];
      return fbdAscii('FBD rolling body', [['weight', 0, -m * g], ['normal', N * Math.sin(th), N * Math.cos(th)], ['friction', -F * Math.cos(th), F * Math.sin(th)]]);
    },
  };
}

function flywheel(p: Params, s: Settings): Result {
  const m = num(p, 'm'), r = num(p, 'r'), tau = num(p, 'tau'), b = num(p, 'b'), toff = num(p, 'toff');
  const I = FLY[str(p, 'fshape')](m, r);
  const T = (t: number) => (t < toff ? tau : 0);
  // integrate in two pieces split exactly at t_off so the torque step is not smeared inside a step
  const fOn = (_t: number, y: number[]) => [y[1], (tau - b * y[1]) / I], fOff = (_t: number, y: number[]) => [y[1], -b * y[1] / I];
  const tEnd = s.dt * s.steps;
  let tr: { t: number[]; y: number[][] };
  if (toff > 0 && toff < tEnd) {
    const n1 = Math.max(1, Math.round(toff / s.dt));
    const a = integrate(fOn, [0, 0], { ...s, dt: toff / n1, steps: n1 }, { nq: 1 });
    const b2 = integrate(fOff, a.y[a.y.length - 1], { ...s, steps: s.steps - n1 }, { nq: 1, t0: toff });
    tr = { t: [...a.t, ...b2.t.slice(1)], y: [...a.y, ...b2.y.slice(1)] };
  } else tr = integrate(toff <= 0 ? fOff : fOn, [0, 0], s, { nq: 1 });
  const k = b / I;
  const wA = (t: number) => {
    if (b === 0) return (tau * Math.min(t, toff)) / I;
    const w1 = (tau / b) * (1 - Math.exp(-k * Math.min(t, toff)));
    return t < toff ? w1 : w1 * Math.exp(-k * (t - toff));
  };
  const cols = ['t', 'theta', 'omega', 'rpm', 'omega exact', 'L = Iω', 'KE_rot', 'P_in', 'P_loss'];
  const rows = tr.t.map((t, i) => {
    const [a, w] = tr.y[i];
    return [t, a, w, (w * 60) / (2 * Math.PI), wA(t), I * w, 0.5 * I * w * w, T(t) * w, b * w * w];
  });
  const last = rows[rows.length - 1];
  const iOff = rows.findIndex((q) => q[0] >= toff);
  // torque discontinuity: sample exactly at a grid point
  const checks: Check[] = [{ l: 'ω(t_end) exact', exp: wA(last[0]), act: last[2], u: 'rad/s', tol: 1e-4, abs: 1e-9 }];
  if (iOff > 0) checks.push({ l: 'ω at torque cut-off', exp: wA(rows[iOff][0]), act: rows[iOff][2], u: 'rad/s', tol: 1e-3 });
  return {
    cols, rows, checks,
    notes: ['I ω\' = τ(t) - bω; torque switched off at t_off (step discontinuity limits integrator order at that instant)'],
    scalars: [{ l: 'moment of inertia', v: I, u: 'kg m2' }, { l: 'terminal ω = τ/b', v: b > 0 ? tau / b : Infinity, u: 'rad/s' }, { l: 'spin-up time constant I/b', v: b > 0 ? I / b : Infinity, u: 's' }, { l: 'peak angular momentum', v: maxOf(rows.map((q) => q[5])), u: 'kg m2/s' }],
    charts: [chart(cols, rows, 'w', 'angular velocity', 't', ['omega', 'omega exact'], { yl: 'rad/s' }), chart(cols, rows, 'p', 'power', 't', ['P_in', 'P_loss'], { yl: 'W' })],
    draw(G, i) {
      const q = rows[i];
      G.view(-1.3, 1.3, -1.3, 1.3);
      G.circle(0, 0, 1, COL.a);
      for (let k = 0; k < 6; k++) { const a = q[1] + (k * Math.PI) / 3; G.line(0, 0, Math.cos(a), Math.sin(a), COL.dim); }
      G.hud([`t=${q[0].toFixed(3)} ω=${q[2].toFixed(3)} rad/s (${q[3].toFixed(1)} rpm)  L=${q[5].toFixed(3)}`]);
    },
  };
}

function gyro(p: Params, s: Settings): Result {
  const m = num(p, 'm'), r = num(p, 'r'), l = num(p, 'l'), g = num(p, 'g');
  const w3 = (num(p, 'rpm') * 2 * Math.PI) / 60, th0 = num(p, 'th0') * DEG;
  const I3 = 0.5 * m * r * r, I1 = 0.25 * m * r * r + m * l * l;
  const mgl = m * g * l, a = I3 * w3;
  // slow steady-precession root of I1 cosθ Ω² - I3ω3 Ω + mgl = 0
  const cth = Math.cos(th0);
  const Wslow = Math.abs(cth) < 1e-12 ? mgl / a : (a - Math.sqrt(Math.max(0, a * a - 4 * I1 * cth * mgl))) / (2 * I1 * cth);
  const steady = str(p, 'init') === 'steady precession';
  const pd0 = steady ? Wslow : 0;
  const ppsi = a, pphi = I1 * pd0 * Math.sin(th0) ** 2 + ppsi * cth;
  const phid = (th: number) => (pphi - ppsi * Math.cos(th)) / (I1 * Math.sin(th) ** 2);
  // state [θ, φ, ψ, θ'] — first-order form, semi-implicit falls back to Euler
  const f = (_t: number, y: number[]) => {
    const pd = phid(y[0]);
    return [y[3], pd, w3 - pd * Math.cos(y[0]), pd * pd * Math.sin(y[0]) * Math.cos(y[0]) - (a / I1) * pd * Math.sin(y[0]) + (mgl / I1) * Math.sin(y[0])];
  };
  const tr = integrate(f, [th0, 0, 0, 0], s);
  const En = (y: number[]) => { const pd = phid(y[0]); return 0.5 * I1 * (y[3] ** 2 + pd * pd * Math.sin(y[0]) ** 2) + 0.5 * I3 * w3 * w3 + mgl * Math.cos(y[0]); };
  const cols = ['t', 'theta (deg)', 'phi', 'psi', 'theta dot', 'phi dot', 'tip x', 'tip y', 'E'];
  const rows = tr.t.map((t, i) => {
    const y = tr.y[i];
    return [t, y[0] / DEG, y[1], y[2], y[3], phid(y[0]), Math.sin(y[0]) * Math.cos(y[1]), Math.sin(y[0]) * Math.sin(y[1]), En(y)];
  });
  const last = rows[rows.length - 1];
  const meanPrec = last[2] / last[0];
  const thMax = maxOf(rows.map((q) => q[1]));
  return {
    cols, rows,
    notes: ['heavy symmetric top: Lagrangian EOM with conserved p_φ, p_ψ; semi-implicit not applicable (first-order form)'],
    checks: [
      { l: 'energy conserved', exp: rows[0][8], act: last[8], u: 'J', abs: 1e-9 * Math.max(1, rows[0][8]) },
      steady
        ? { l: 'steady precession rate (exact slow root)', exp: Wslow, act: meanPrec, u: 'rad/s', tol: 1e-4 }
        : { l: 'mean precession ≈ mgl/(I3ω3) (fast top)', exp: mgl / a, act: meanPrec, u: 'rad/s', tol: 0.02, ref: true },
      ...(steady ? [] : [{ l: 'nutation amplitude ≈ 2 I1 mgl sinθ0/(I3ω3)²', exp: (2 * I1 * mgl * Math.sin(th0)) / (a * a) / DEG, act: thMax - th0 / DEG, u: 'deg', tol: 0.05, ref: true }]),
    ],
    scalars: [
      { l: 'I3 (spin axis)', v: I3, u: 'kg m2' }, { l: 'I1 (about pivot)', v: I1, u: 'kg m2' }, { l: 'spin angular momentum', v: a, u: 'kg m2/s' },
      { l: 'gyroscopic Ω ≈ mgl/(I3ω3)', v: mgl / a, u: 'rad/s' }, { l: 'exact slow precession', v: Wslow, u: 'rad/s' }, { l: 'measured mean precession', v: meanPrec, u: 'rad/s' },
      { l: 'nutation freq ≈ I3ω3/I1', v: a / I1, u: 'rad/s' }, { l: 'fast-top stability (I3ω3)²/(4I1mgl)', v: (a * a) / (4 * I1 * mgl) },
    ],
    charts: [
      chart(cols, rows, 'th', 'tilt θ (nutation)', 't', ['theta (deg)']),
      chart(cols, rows, 'pd', 'precession rate', 't', ['phi dot'], { yl: 'rad/s' }),
      chart(cols, rows, 'tip', 'axis tip trace (top view)', 'tip x', ['tip y'], { equal: true, tAxis: false }),
    ],
    draw(G, i) {
      const q = rows[i];
      const th = q[1] * DEG, ph = q[2], ps = q[3];
      // oblique projection of 3D (x,y,z) -> screen
      const P = (x: number, y: number, z: number): [number, number] => [x + 0.45 * y, z + 0.3 * y];
      G.view(-1.3, 1.3, -0.5, 1.3);
      G.line(...P(-1, 0, 0), ...P(1, 0, 0), COL.grid); G.line(...P(0, -1, 0), ...P(0, 1, 0), COL.grid);
      const ax = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      const c = ax.map((v) => v * 0.9);
      G.line(...P(0, 0, 0), ...P(c[0], c[1], c[2]), COL.fg, 2);
      // rim: e1 ⟂ axis in the vertical plane, e2 = axis × e1
      const e1 = [Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), -Math.sin(th)];
      const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
      const R = 0.35;
      const xs: number[] = [], ys: number[] = [];
      for (let k = 0; k <= 32; k++) {
        const u = (2 * Math.PI * k) / 32;
        const pt = [0, 1, 2].map((j) => c[j] + R * (Math.cos(u) * e1[j] + Math.sin(u) * e2[j]));
        const [X, Y] = P(pt[0], pt[1], pt[2]);
        xs.push(X); ys.push(Y);
      }
      G.path(xs, ys, COL.a);
      const mk = [0, 1, 2].map((j) => c[j] + R * (Math.cos(ps) * e1[j] + Math.sin(ps) * e2[j]));
      G.line(...P(c[0], c[1], c[2]), ...P(mk[0], mk[1], mk[2]), COL.b);
      const tx: number[] = [], ty: number[] = [];
      for (let j = Math.max(0, i - 3000); j <= i; j += 5) { const t2 = rows[j][1] * DEG, p2 = rows[j][2]; const [X, Y] = P(0.9 * Math.sin(t2) * Math.cos(p2), 0.9 * Math.sin(t2) * Math.sin(p2), 0.9 * Math.cos(t2)); tx.push(X); ty.push(Y); }
      G.path(tx, ty, COL.dim);
      G.hud([`t=${q[0].toFixed(4)} θ=${q[1].toFixed(4)}° φ'=${q[5].toFixed(4)} rad/s`]);
    },
  };
}
