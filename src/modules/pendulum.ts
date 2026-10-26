import type { SimModule, Check, Chart } from '../core/types';
import { integrate, agm, crossings, meanPeriod, DEG, fbdAscii, G0, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

export const pendulum: SimModule = {
  id: 'pendulum',
  name: 'Pendulum',
  desc: 'simple / compound (rigid rod) / double pendulum (chaos) with exact elliptic period',
  timeBased: true,
  settings: { dt: 0.001, steps: 10000, method: 'rk4' },
  params: [
    { k: 'mode', l: 'mode', v: 'simple', o: ['simple', 'compound', 'double'] },
    { k: 'L1', l: 'length 1', u: 'm', v: 1, min: 1e-6, s: 0.1 },
    { k: 'm1', l: 'mass 1', u: 'kg', v: 1, min: 1e-9, s: 0.1 },
    { k: 'th1', l: 'theta 1', u: 'deg', v: 30, s: 5 },
    { k: 'w1', l: 'omega 1', u: 'rad/s', v: 0, s: 0.1 },
    { k: 'L2', l: 'length 2', u: 'm', v: 1, min: 1e-6, s: 0.1, when: (p) => p.mode === 'double' },
    { k: 'm2', l: 'mass 2', u: 'kg', v: 1, min: 1e-9, s: 0.1, when: (p) => p.mode === 'double' },
    { k: 'th2', l: 'theta 2', u: 'deg', v: 90, s: 5, when: (p) => p.mode === 'double' },
    { k: 'w2', l: 'omega 2', u: 'rad/s', v: 0, s: 0.1, when: (p) => p.mode === 'double' },
    { k: 'g', l: 'gravity', u: 'm/s2', v: G0, s: 0.1 },
    { k: 'c', l: 'damping', u: '1/s', v: 0, min: 0, s: 0.05 },
  ],
  run(p, s) {
    const mode = str(p, 'mode');
    const L1 = num(p, 'L1'), m1 = num(p, 'm1'), g = num(p, 'g'), c = num(p, 'c');
    const th1 = num(p, 'th1') * DEG, w1 = num(p, 'w1');
    const checks: Check[] = [];
    const notes: string[] = [];
    if (mode !== 'double') {
      const compound = mode === 'compound';
      // simple: point mass; compound: uniform rod about end, I = mL^2/3, CoM at L/2
      const I = compound ? (m1 * L1 * L1) / 3 : m1 * L1 * L1;
      const d = compound ? L1 / 2 : L1;
      const k = (m1 * g * d) / I;
      const f = (_t: number, y: number[]) => [y[1], -k * Math.sin(y[0]) - c * y[1]];
      const tr = integrate(f, [th1, w1], s, { nq: 1 });
      const cols = ['t', 'theta', 'omega', 'alpha', 'x', 'y', 'tension', 'KE', 'PE', 'E'];
      const rows = tr.t.map((t, i) => {
        const [th, w] = tr.y[i];
        const a = -k * Math.sin(th) - c * w;
        const x = d * Math.sin(th), y = -d * Math.cos(th);
        // radial force at the pivot needed for centripetal motion of the CoM (rod: reaction along rod)
        const T = m1 * (g * Math.cos(th) + d * w * w);
        const KE = 0.5 * I * w * w, PE = m1 * g * d * (1 - Math.cos(th));
        return [t, th, w, a, x, y, T, KE, PE, KE + PE];
      });
      const E0 = rows[0][9];
      const T0 = 2 * Math.PI * Math.sqrt(I / (m1 * g * d));
      const cosMax = 1 - E0 / (m1 * g * d);
      const thMax = Math.acos(Math.max(-1, Math.min(1, cosMax)));
      const Texact = cosMax > -1 ? T0 / agm(1, Math.cos(thMax / 2)) : Infinity;
      const cr = crossings(tr.t, tr.y.map((y) => y[0]), 0, -1);
      const Tm = meanPeriod(cr);
      checks.push({ l: 'period (elliptic exact)', exp: Texact, act: Tm, u: 's', ref: c > 0 });
      checks.push({ l: 'amplitude', exp: thMax / DEG, act: maxOf(rows.map((r) => Math.abs(r[1]))) / DEG, u: 'deg', ref: c > 0 });
      if (c === 0) checks.push({ l: 'energy conservation', exp: E0, act: rows[rows.length - 1][9], u: 'J', abs: 1e-6 * Math.max(1, E0) });
      if (cosMax <= -1) notes.push('energy exceeds 2mgd: pendulum circulates (no oscillation period)');
      const charts: Chart[] = [
        chart(cols, rows, 'th', 'angle / angular velocity', 't', ['theta', 'omega']),
        chart(cols, rows, 'en', 'energy', 't', ['KE', 'PE', 'E'], { yl: 'J' }),
        chart(cols, rows, 'ph', 'phase portrait', 'theta', ['omega'], { tAxis: false }),
      ];
      return {
        cols, rows, checks, charts, notes,
        scalars: [
          { l: 'small-angle period', v: T0, u: 's' },
          { l: 'exact period', v: Texact, u: 's' },
          { l: 'measured period', v: Tm, u: 's' },
          { l: 'period / small-angle', v: Texact / T0 },
          { l: 'moment of inertia', v: I, u: 'kg m2' },
          { l: 'max tension', v: maxOf(rows.map((r) => r[6])), u: 'N' },
        ],
        draw(G, i) {
          const r = rows[i];
          const R = L1 * 1.15;
          G.view(-R, R, -R, R * 0.4);
          G.line(-R * 0.3, 0, R * 0.3, 0, COL.dim);
          for (let j = Math.max(0, i - 400); j < i; j += 4) G.circle(rows[j][4] * (L1 / d), rows[j][5] * (L1 / d), 0.5, COL.dim, true, true);
          const tipx = L1 * Math.sin(r[1]), tipy = -L1 * Math.cos(r[1]);
          G.line(0, 0, tipx, tipy, COL.fg, compound ? 3 : 1);
          if (!compound) G.circle(tipx, tipy, 0.04 * L1, COL.a, true);
          G.circle(r[4], r[5], 3, COL.b, true, true);
          G.arrow(r[4], r[5], 0, -20, COL.d, 'mg');
          G.hud([`t=${r[0].toFixed(3)}s  θ=${(r[1] / DEG).toFixed(3)}°`]);
        },
        fbd(i) {
          const r = rows[i];
          return fbdAscii(compound ? 'FBD rod (pivot reaction, weight)' : 'FBD bob', [
            ['weight', 0, -m1 * g],
            ['tension', -r[6] * Math.sin(r[1]), r[6] * Math.cos(r[1])],
          ]);
        },
      };
    }
    // double pendulum, point masses
    const L2 = num(p, 'L2'), m2 = num(p, 'm2');
    const deriv = (th1: number, th2: number, a: number, b: number) => {
      const D = th1 - th2;
      const den = 2 * m1 + m2 - m2 * Math.cos(2 * D);
      const a1 = (-g * (2 * m1 + m2) * Math.sin(th1) - m2 * g * Math.sin(th1 - 2 * th2) - 2 * Math.sin(D) * m2 * (b * b * L2 + a * a * L1 * Math.cos(D))) / (L1 * den);
      const a2 = (2 * Math.sin(D) * (a * a * L1 * (m1 + m2) + g * (m1 + m2) * Math.cos(th1) + b * b * L2 * m2 * Math.cos(D))) / (L2 * den);
      return [a1 - c * a, a2 - c * b];
    };
    const f = (_t: number, y: number[]) => {
      const [a1, a2] = deriv(y[0], y[1], y[2], y[3]);
      return [y[2], y[3], a1, a2];
    };
    const y0 = [th1, num(p, 'th2') * DEG, w1, num(p, 'w2')];
    const tr = integrate(f, y0, s, { nq: 2 });
    const tw = integrate(f, [y0[0] + 1e-9, y0[1], y0[2], y0[3]], s, { nq: 2 });
    const cols = ['t', 'theta1', 'theta2', 'omega1', 'omega2', 'x1', 'y1', 'x2', 'y2', 'KE', 'PE', 'E', 'log10 sep'];
    const rows = tr.t.map((t, i) => {
      const [a, b, w, v] = tr.y[i];
      const x1 = L1 * Math.sin(a), y1 = -L1 * Math.cos(a);
      const x2 = x1 + L2 * Math.sin(b), y2 = y1 - L2 * Math.cos(b);
      const v1s = L1 * L1 * w * w;
      const v2s = v1s + L2 * L2 * v * v + 2 * L1 * L2 * w * v * Math.cos(a - b);
      const KE = 0.5 * m1 * v1s + 0.5 * m2 * v2s;
      const PE = m1 * g * (y1 + L1) + m2 * g * (y2 + L1 + L2);
      const q = tw.y[Math.min(i, tw.y.length - 1)];
      const sep = Math.hypot(q[0] - a, q[1] - b, q[2] - w, q[3] - v);
      return [t, a, b, w, v, x1, y1, x2, y2, KE, PE, KE + PE, Math.log10(Math.max(sep, 1e-300))];
    });
    const E0 = rows[0][11];
    if (c === 0) checks.push({ l: 'energy conservation', exp: E0, act: rows[rows.length - 1][11], u: 'J', abs: 1e-6 * Math.max(1, Math.abs(E0)) });
    // finite-time Lyapunov estimate from twin trajectory divergence
    const ls = rows.map((r) => r[12]);
    const tEnd = rows[rows.length - 1][0];
    const lam = tEnd > 0 ? ((ls[ls.length - 1] - ls[1]) * Math.LN10) / tEnd : NaN;
    return {
      cols, rows, checks, notes,
      charts: [
        chart(cols, rows, 'th', 'angles', 't', ['theta1', 'theta2']),
        chart(cols, rows, 'en', 'energy', 't', ['KE', 'PE', 'E'], { yl: 'J' }),
        chart(cols, rows, 'traj', 'bob 2 trajectory', 'x2', ['y2'], { equal: true, tAxis: false }),
        chart(cols, rows, 'sep', 'twin divergence (Δθ1=1e-9)', 't', ['log10 sep']),
      ],
      scalars: [
        { l: 'finite-time Lyapunov est.', v: lam, u: '1/s' },
        { l: 'initial energy', v: E0, u: 'J' },
        { l: 'final separation', v: 10 ** ls[ls.length - 1], u: 'rad' },
      ],
      draw(G, i) {
        const r = rows[i];
        const R = (L1 + L2) * 1.1;
        G.view(-R, R, -R, R * 0.3);
        G.line(-0.2, 0, 0.2, 0, COL.dim);
        const xs: number[] = [], ys: number[] = [];
        for (let j = Math.max(0, i - 1500); j <= i; j += 3) {
          xs.push(rows[j][7]);
          ys.push(rows[j][8]);
        }
        G.path(xs, ys, COL.dim);
        G.line(0, 0, r[5], r[6]);
        G.line(r[5], r[6], r[7], r[8]);
        G.circle(r[5], r[6], 4, COL.a, true, true);
        G.circle(r[7], r[8], 4, COL.b, true, true);
        G.hud([`t=${r[0].toFixed(3)}s`]);
      },
    };
  },
};
