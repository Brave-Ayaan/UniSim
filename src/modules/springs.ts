import type { SimModule, Result, Params, Settings } from '../core/types';
import { integrate, eig2, cumtrapz, fbdAscii, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

/** closed-form free response of m x'' + c x' + k x = 0 */
export function homog(m: number, c: number, k: number, x0: number, v0: number) {
  const w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m));
  if (Math.abs(z - 1) < 1e-9) {
    const C2 = v0 + w0 * x0;
    return { x: (t: number) => (x0 + C2 * t) * Math.exp(-w0 * t), v: (t: number) => (C2 - w0 * (x0 + C2 * t)) * Math.exp(-w0 * t) };
  }
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z), s = z * w0, C2 = (v0 + s * x0) / wd;
    return {
      x: (t: number) => Math.exp(-s * t) * (x0 * Math.cos(wd * t) + C2 * Math.sin(wd * t)),
      v: (t: number) => Math.exp(-s * t) * ((-s * x0 + C2 * wd) * Math.cos(wd * t) + (-s * C2 - x0 * wd) * Math.sin(wd * t)),
    };
  }
  const r = w0 * Math.sqrt(z * z - 1), r1 = -z * w0 + r, r2 = -z * w0 - r;
  const A = (v0 - r2 * x0) / (r1 - r2), B = x0 - A;
  return { x: (t: number) => A * Math.exp(r1 * t) + B * Math.exp(r2 * t), v: (t: number) => A * r1 * Math.exp(r1 * t) + B * r2 * Math.exp(r2 * t) };
}

export const springs: SimModule = {
  id: 'springs',
  name: 'Springs & oscillators',
  desc: 'SHM, damped & driven oscillator (exact solution, resonance), coupled normal modes',
  timeBased: true,
  settings: { dt: 0.001, steps: 10000, method: 'rk4' },
  params: [
    { k: 'mode', l: 'mode', v: 'single', o: ['single', 'coupled'] },
    { k: 'm', l: 'mass (m1)', u: 'kg', v: 1, min: 1e-9, s: 0.1 },
    { k: 'k', l: 'stiffness (k1)', u: 'N/m', v: 100, min: 1e-9, s: 10 },
    { k: 'c', l: 'damping', u: 'N s/m', v: 1, min: 0, s: 0.1, when: (p) => p.mode === 'single' },
    { k: 'F0', l: 'drive amplitude', u: 'N', v: 5, s: 1, when: (p) => p.mode === 'single' },
    { k: 'wd', l: 'drive frequency', u: 'rad/s', v: 9, min: 0, s: 0.5, when: (p) => p.mode === 'single' },
    { k: 'm2', l: 'mass m2', u: 'kg', v: 1, min: 1e-9, s: 0.1, when: (p) => p.mode === 'coupled' },
    { k: 'k2', l: 'stiffness k2', u: 'N/m', v: 100, min: 0, s: 10, when: (p) => p.mode === 'coupled' },
    { k: 'kc', l: 'coupling kc', u: 'N/m', v: 10, min: 0, s: 1, when: (p) => p.mode === 'coupled' },
    { k: 'x0', l: 'x0 (x1)', u: 'm', v: 0.1, s: 0.01 },
    { k: 'v0', l: 'v0 (v1)', u: 'm/s', v: 0, s: 0.1 },
    { k: 'x20', l: 'x2 initial', u: 'm', v: 0, s: 0.01, when: (p) => p.mode === 'coupled' },
  ],
  run(p, s) {
    return str(p, 'mode') === 'single' ? single(p, s) : coupled(p, s);
  },
};

function single(p: Params, s: Settings): Result {
  const m = num(p, 'm'), k = num(p, 'k'), c = num(p, 'c'), F0 = num(p, 'F0'), w = num(p, 'wd'), x0 = num(p, 'x0'), v0 = num(p, 'v0');
  const F = (t: number) => F0 * Math.cos(w * t);
  const tr = integrate((t, y) => [y[1], (F(t) - c * y[1] - k * y[0]) / m], [x0, v0], s, { nq: 1 });
  // exact: particular + homogeneous fitted to the initial conditions
  const Amp = F0 / Math.hypot(k - m * w * w, c * w), del = Math.atan2(c * w, k - m * w * w);
  const xp = (t: number) => Amp * Math.cos(w * t - del), vp = (t: number) => -Amp * w * Math.sin(w * t - del);
  const res = c === 0 && Math.abs(k - m * w * w) < 1e-12 * k;
  const h = homog(m, c, k, x0 - (res ? 0 : xp(0)), v0 - (res ? 0 : vp(0)));
  const w0 = Math.sqrt(k / m);
  // undamped exact resonance: x_p = F0 t sin(w t)/(2 m w)
  const xA = (t: number) => (res ? h.x(t) + (F0 * t * Math.sin(w * t)) / (2 * m * w) : h.x(t) + xp(t));
  const ts = tr.t, xs = tr.y.map((y) => y[0]), vs = tr.y.map((y) => y[1]);
  const Win = cumtrapz(ts, ts.map((t, i) => F(t) * vs[i])), Wd = cumtrapz(ts, vs.map((v) => c * v * v));
  const cols = ['t', 'x', 'v', 'a', 'x exact', 'err', 'KE', 'PE', 'E', 'W_drive', 'W_damp', 'F_drive'];
  const rows = ts.map((t, i) => {
    const x = xs[i], v = vs[i];
    return [t, x, v, (F(t) - c * v - k * x) / m, xA(t), x - xA(t), 0.5 * m * v * v, 0.5 * k * x * x, 0.5 * m * v * v + 0.5 * k * x * x, Win[i], Wd[i], F(t)];
  });
  const last = rows[rows.length - 1];
  const z = c / (2 * Math.sqrt(k * m));
  const ws = [...Array(400).keys()].map((i) => (3 * w0 * (i + 1)) / 400);
  const scale = Math.max(1e-12, maxOf(rows.map((r) => Math.abs(r[4]))));
  return {
    cols, rows,
    checks: [
      { l: 'max |x - exact|', exp: 0, act: maxOf(rows.map((r) => Math.abs(r[5]))), u: 'm', abs: 1e-6 * scale },
      { l: 'x(t_end) exact', exp: last[4], act: last[1], u: 'm', abs: 1e-6 * scale },
      { l: 'work-energy: E-E0 = W_drive - W_damp', exp: last[9] - last[10], act: last[8] - rows[0][8], u: 'J', abs: 1e-6 * Math.max(1e-9, rows[0][8], Math.abs(last[9])) },
    ],
    scalars: [
      { l: 'ω0 = √(k/m)', v: w0, u: 'rad/s' }, { l: 'f0', v: w0 / (2 * Math.PI), u: 'Hz' }, { l: 'damping ratio ζ', v: z },
      { l: 'damped ωd', v: z < 1 ? w0 * Math.sqrt(1 - z * z) : NaN, u: 'rad/s' }, { l: 'Q factor', v: c > 0 ? 1 / (2 * z) : Infinity },
      { l: 'resonance ωr = ω0√(1-2ζ²)', v: z < Math.SQRT1_2 ? w0 * Math.sqrt(1 - 2 * z * z) : NaN, u: 'rad/s' },
      { l: 'steady amplitude', v: Amp, u: 'm' }, { l: 'phase lag δ', v: (del * 180) / Math.PI, u: 'deg' },
      { l: 'log decrement', v: z < 1 ? (2 * Math.PI * z) / Math.sqrt(1 - z * z) : NaN },
    ],
    charts: [
      chart(cols, rows, 'x', 'displacement (numeric vs exact)', 't', ['x', 'x exact']),
      chart(cols, rows, 'e', 'energy', 't', ['KE', 'PE', 'E', 'W_drive', 'W_damp'], { yl: 'J' }),
      chart(cols, rows, 'ph', 'phase portrait', 'x', ['v'], { tAxis: false }),
      { id: 'res', title: 'resonance curve A(ω)', xl: 'ω (rad/s)', yl: 'm', series: [{ name: 'A', x: ws, y: ws.map((ww) => Math.abs(F0) / Math.hypot(k - m * ww * ww, c * ww)) }, { name: 'drive', x: [w, w], y: [0, Amp], dash: true }] },
    ],
    draw(G, i) {
      const r = rows[i];
      const X = Math.max(maxOf(rows.map((q) => Math.abs(q[1]))), 1e-9) * 1.5;
      G.view(-X * 1.6, X * 1.6, -X, X);
      G.line(-X * 1.5, -X * 0.3, -X * 1.5, X * 0.3, COL.fg, 2);
      G.spring(-X * 1.5, 0, r[1] - X * 0.15, 0, COL.c, 10);
      G.rect(r[1] - X * 0.15, -X * 0.15, X * 0.3, X * 0.3, COL.a, true);
      G.line(r[4], -X * 0.3, r[4], X * 0.3, COL.b, 1, [2, 3]);
      G.arrow(r[1], X * 0.25, (r[11] / Math.max(1e-9, Math.abs(F0) || 1)) * 30, 0, COL.f, 'F');
      G.hud([`t=${r[0].toFixed(3)} x=${r[1].toFixed(5)} exact=${r[4].toFixed(5)}`]);
    },
    fbd(i) {
      const r = rows[i];
      return fbdAscii('FBD mass (horizontal)', [['spring', -k * r[1], 0], ['damper', -c * r[2], 0], ['drive', r[11], 0]]);
    },
  };
}

function coupled(p: Params, s: Settings): Result {
  const m1 = num(p, 'm'), m2 = num(p, 'm2'), k1 = num(p, 'k'), k2 = num(p, 'k2'), kc = num(p, 'kc');
  const x10 = num(p, 'x0'), x20 = num(p, 'x20'), v10 = num(p, 'v0');
  const f = (_t: number, y: number[]) => [y[2], y[3], (-k1 * y[0] - kc * (y[0] - y[1])) / m1, (-k2 * y[1] - kc * (y[1] - y[0])) / m2];
  const tr = integrate(f, [x10, x20, v10, 0], s, { nq: 2 });
  // modal solution in mass-weighted coordinates q = M^½ x
  const s1 = Math.sqrt(m1), s2 = Math.sqrt(m2);
  const E = eig2((k1 + kc) / m1, -kc / (s1 * s2), (k2 + kc) / m2);
  const om = E.l.map(Math.sqrt);
  const q0 = [s1 * x10, s2 * x20], qd0 = [s1 * v10, 0];
  const exact = (t: number) => {
    const q = [0, 0];
    for (let j = 0; j < 2; j++) {
      const u = E.v[j];
      const a = u[0] * q0[0] + u[1] * q0[1], b = u[0] * qd0[0] + u[1] * qd0[1];
      const amp = a * Math.cos(om[j] * t) + (om[j] > 0 ? (b / om[j]) * Math.sin(om[j] * t) : b * t);
      q[0] += u[0] * amp; q[1] += u[1] * amp;
    }
    return [q[0] / s1, q[1] / s2];
  };
  const cols = ['t', 'x1', 'x2', 'v1', 'v2', 'x1 exact', 'x2 exact', 'E1', 'E2', 'E_coupling', 'E_total'];
  const rows = tr.t.map((t, i) => {
    const [x1, x2, v1, v2] = tr.y[i];
    const [e1, e2] = exact(t);
    const E1 = 0.5 * m1 * v1 * v1 + 0.5 * k1 * x1 * x1, E2 = 0.5 * m2 * v2 * v2 + 0.5 * k2 * x2 * x2, Ec = 0.5 * kc * (x1 - x2) ** 2;
    return [t, x1, x2, v1, v2, e1, e2, E1, E2, Ec, E1 + E2 + Ec];
  });
  const err = maxOf(rows.map((r) => Math.max(Math.abs(r[1] - r[5]), Math.abs(r[2] - r[6]))));
  const sc = Math.max(Math.abs(x10), Math.abs(x20), 1e-9);
  return {
    cols, rows,
    checks: [
      { l: 'max |x - modal exact|', exp: 0, act: err, u: 'm', abs: 1e-6 * sc },
      { l: 'energy conserved', exp: rows[0][10], act: rows[rows.length - 1][10], u: 'J', abs: 1e-8 * Math.max(1e-9, rows[0][10]) },
    ],
    scalars: [
      { l: 'mode 1 ω', v: om[0], u: 'rad/s' }, { l: 'mode 2 ω', v: om[1], u: 'rad/s' },
      { l: 'mode 1 shape x2/x1', v: (E.v[0][1] / s2) / (E.v[0][0] / s1) }, { l: 'mode 2 shape x2/x1', v: (E.v[1][1] / s2) / (E.v[1][0] / s1) },
      { l: 'beat period 2π/Δω', v: (2 * Math.PI) / Math.abs(om[1] - om[0]), u: 's' },
    ],
    charts: [
      chart(cols, rows, 'x', 'displacements', 't', ['x1', 'x2']),
      chart(cols, rows, 'e', 'energy exchange', 't', ['E1', 'E2', 'E_coupling', 'E_total'], { yl: 'J' }),
    ],
    draw(G, i) {
      const r = rows[i];
      const X = sc * 1.5;
      G.view(-1, 4, -1, 1);
      const p1 = 1 + r[1] / X * 0.5, p2 = 2 + r[2] / X * 0.5;
      G.line(-0.9, -0.3, -0.9, 0.3, COL.fg, 2); G.line(3.9, -0.3, 3.9, 0.3, COL.fg, 2);
      G.spring(-0.9, 0, p1 - 0.15, 0, COL.c); G.spring(p1 + 0.15, 0, p2 - 0.15, 0, COL.f); G.spring(p2 + 0.15, 0, 3.9, 0, COL.c);
      G.rect(p1 - 0.15, -0.15, 0.3, 0.3, COL.a, true); G.rect(p2 - 0.15, -0.15, 0.3, 0.3, COL.b, true);
      G.hud([`t=${r[0].toFixed(3)}  x1=${r[1].toFixed(5)}  x2=${r[2].toFixed(5)}`]);
    },
  };
}
