import type { SimModule, Check } from '../core/types';
import { integrate, roots, cpoly, dpoly, cdiv, cmul, cexp, type C, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

/** step-response metrics on a sampled response */
function metrics(t: number[], y: number[], r: number) {
  const fin = y[y.length - 1];
  const t10 = t[y.findIndex((v) => v >= 0.1 * r)] ?? NaN, t90 = t[y.findIndex((v) => v >= 0.9 * r)] ?? NaN;
  let pk = 0;
  for (let i = 1; i < y.length; i++) if (y[i] > y[pk]) pk = i;
  let ts = 0;
  for (let i = y.length - 1; i >= 0; i--) if (Math.abs(y[i] - r) > 0.02 * Math.abs(r)) { ts = t[Math.min(i + 1, t.length - 1)]; break; }
  return { rise: t90 - t10, os: r !== 0 ? Math.max(0, ((y[pk] - r) / r) * 100) : 0, tp: t[pk], ts, ess: r - fin, peak: y[pk] };
}

export const control: SimModule = {
  id: 'control',
  name: 'Control systems (PID)',
  desc: 'PID loop on a mass-spring-damper or first-order plant: step response, closed-loop poles, exact residue solution',
  timeBased: true,
  settings: { dt: 0.0005, steps: 4000, method: 'rk4' },
  params: [
    { k: 'plant', l: 'plant', v: 'mass-spring-damper', o: ['mass-spring-damper', 'first-order'] },
    { k: 'm', l: 'mass m', u: 'kg', v: 1, min: 1e-9, s: 0.1, when: (p) => p.plant === 'mass-spring-damper' },
    { k: 'c', l: 'damping c', u: 'N s/m', v: 10, min: 0, s: 1, when: (p) => p.plant === 'mass-spring-damper' },
    { k: 'k', l: 'stiffness k', u: 'N/m', v: 20, min: 0, s: 1, when: (p) => p.plant === 'mass-spring-damper' },
    { k: 'K', l: 'plant gain K', v: 1, s: 0.1, when: (p) => p.plant === 'first-order' },
    { k: 'tau', l: 'time constant τ', u: 's', v: 1, min: 1e-9, s: 0.1, when: (p) => p.plant === 'first-order' },
    { k: 'Kp', l: 'Kp', v: 350, s: 10 },
    { k: 'Ki', l: 'Ki', v: 300, s: 10 },
    { k: 'Kd', l: 'Kd', v: 50, s: 1 },
    { k: 'Nf', l: 'derivative filter N', u: 'rad/s', v: 1000, min: 1e-6, s: 100 },
    { k: 'r', l: 'setpoint step', v: 1, s: 0.1 },
    { k: 'umax', l: 'actuator limit |u|', v: 1e9, min: 0, s: 50 },
    { k: 'aw', l: 'anti-windup', v: 'on', o: ['on', 'off'] },
    { k: 'dist', l: 'disturbance step', v: 0, s: 1 },
    { k: 'td', l: 'disturbance time', u: 's', v: 1, min: 0, s: 0.1 },
  ],
  run(p, s) {
    const msd = str(p, 'plant') === 'mass-spring-damper';
    const m = num(p, 'm'), c = num(p, 'c'), k = num(p, 'k'), K = num(p, 'K'), tau = num(p, 'tau');
    const Kp = num(p, 'Kp'), Ki = num(p, 'Ki'), Kd = num(p, 'Kd'), Nf = num(p, 'Nf'), r = num(p, 'r'), umax = num(p, 'umax'), aw = str(p, 'aw') === 'on';
    const dist = num(p, 'dist'), td = num(p, 'td');
    // controller: u = Kp e + Ki ∫e + Kd·N(e - xf), xf' = N(e - xf)   (filtered derivative on error)
    const ctrl = (y: number, xi: number, xf: number) => {
      const e = r - y;
      const D = Kd * Nf * (e - xf);
      const raw = Kp * e + Ki * xi + D;
      const u = Math.max(-umax, Math.min(umax, raw));
      return { e, u, raw, P: Kp * e, I: Ki * xi, D };
    };
    // filter state starts at 0: the derivative kick Kd·N·r decays at rate N, a band-limited Kd·r·δ(t)
    // state: msd [y, v, xi, xf]; first-order [y, xi, xf]
    const f = (t: number, q: number[]) => {
      const y = q[0], xi = msd ? q[2] : q[1], xf = msd ? q[3] : q[2];
      const C0 = ctrl(y, xi, xf);
      const sat = C0.u !== C0.raw;
      const dxi = aw && sat && Math.sign(C0.e) === Math.sign(C0.raw) ? 0 : C0.e;
      const d = t >= td ? dist : 0;
      if (msd) return [q[1], (C0.u + d - c * q[1] - k * y) / m, dxi, Nf * (C0.e - xf)];
      return [(K * (C0.u + d) - y) / tau, dxi, Nf * (C0.e - xf)];
    };
    const y0 = msd ? [0, 0, 0, 0] : [0, 0, 0];
    const tr = integrate(f, y0, s);
    const cols = ['t', 'r', 'y', 'e', 'u', 'P', 'I', 'D', 'y exact (ideal PID)'];
    // closed loop with ideal PID: T(s) = N(s)/D(s)
    const Gn = msd ? [1] : [K], Gd = msd ? [m, c, k] : [tau, 1];
    const Cn = [Kd, Kp, Ki]; // (Kd s² + Kp s + Ki)/s
    const mulp = (a: number[], b: number[]) => { const o = new Array(a.length + b.length - 1).fill(0); a.forEach((x, i) => b.forEach((y, j) => (o[i + j] += x * y))); return o; };
    const addp = (a: number[], b: number[]) => { const n = Math.max(a.length, b.length); const A = [...Array(n - a.length).fill(0), ...a], B = [...Array(n - b.length).fill(0), ...b]; return A.map((x, i) => x + B[i]); };
    const Nc = mulp(Gn, Cn), Dc = addp(mulp(Gd, [1, 0]), Nc);
    const poles = roots(Dc.slice());
    const stable = poles.every((q) => q[0] < 0);
    // exact step response by residues: y(t) = T(0) + Σ N(p)/(p D'(p)) e^{pt}
    const dD = dpoly(Dc);
    const distinct = poles.every((a, i) => poles.every((b, j) => i === j || Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6 * (1 + Math.hypot(a[0], a[1]))));
    const T0 = Nc[Nc.length - 1] / Dc[Dc.length - 1];
    const res = poles.map((pp) => cdiv(cpoly(Nc, pp), cmul(pp, cpoly(dD, pp))));
    const yEx = (t: number) => {
      if (!distinct) return NaN;
      let acc: C = [T0, 0];
      poles.forEach((pp, i) => { const e = cmul(res[i], cexp([pp[0] * t, pp[1] * t])); acc = [acc[0] + e[0], acc[1] + e[1]]; });
      return r * acc[0];
    };
    const rows = tr.t.map((t, i) => {
      const q = tr.y[i];
      const C0 = ctrl(q[0], msd ? q[2] : q[1], msd ? q[3] : q[2]);
      return [t, r, q[0], C0.e, C0.u, C0.P, C0.I, C0.D, yEx(t)];
    });
    const T = rows.map((q) => q[0]);
    const Mn = metrics(T, rows.map((q) => q[2]), r);
    const Ma = metrics(T, rows.map((q) => q[8]), r);
    const saturated = rows.some((q) => Math.abs(q[4]) >= umax);
    const ideal = !saturated && dist === 0 && distinct;
    const checks: Check[] = [
      { l: 'max |y - exact| (filter N vs ideal)', exp: 0, act: maxOf(rows.map((q) => Math.abs(q[2] - q[8]))), abs: (5 / Nf) * Math.abs(r) * (1 + Math.abs(Kd)), ref: !ideal },
      { l: 'overshoot %', exp: Ma.os, act: Mn.os, u: '%', abs: 0.5, ref: !ideal },
      { l: 'settling time (2%)', exp: Ma.ts, act: Mn.ts, u: 's', tol: 0.02, ref: !ideal },
    ];
    const essExp = !stable ? NaN : Ki !== 0 ? 0 : r * (1 - T0);
    checks.push({ l: 'steady-state error (final value thm)', exp: essExp, act: Mn.ess, abs: 1e-3 * Math.abs(r), ref: !stable || dist !== 0 || T[T.length - 1] < 5 * Mn.ts });
    // root locus over Kp
    const rl: { x: number[]; y: number[] } = { x: [], y: [] };
    for (let i = 0; i <= 60; i++) {
      const kp = (2 * Math.max(Kp, 1) * i) / 60;
      roots(addp(mulp(Gd, [1, 0]), mulp(Gn, [Kd, kp, Ki]))).forEach((q) => { rl.x.push(q[0]); rl.y.push(q[1]); });
    }
    const dom = poles.reduce((a, q) => (q[0] > a[0] ? q : a), poles[0] ?? [NaN, NaN]);
    return {
      cols, rows, checks,
      notes: [`closed-loop characteristic polynomial: ${Dc.map((x) => x.toPrecision(4)).join(' s^n + ')} (descending powers)`, stable ? 'STABLE: all closed-loop poles in the left half-plane' : 'UNSTABLE: pole(s) in the right half-plane', 'exact curve: ideal PID (N→∞) via residues; numeric uses the filtered derivative', 'state includes integrator & filter (not q/v form): semi-implicit falls back to Euler'],
      scalars: [
        { l: 'rise time 10-90%', v: Mn.rise, u: 's' }, { l: 'overshoot', v: Mn.os, u: '%' }, { l: 'peak time', v: Mn.tp, u: 's' }, { l: 'settling time 2%', v: Mn.ts, u: 's' },
        { l: 'steady-state error', v: Mn.ess }, { l: 'peak control effort', v: maxOf(rows.map((q) => Math.abs(q[4]))) }, { l: 'stable', v: stable ? 1 : 0 },
        { l: 'dominant pole Re', v: dom[0] }, { l: 'dominant pole Im', v: dom[1] }, { l: 'dominant ζ', v: -dom[0] / Math.hypot(dom[0], dom[1]) },
      ],
      targets: [{ l: 'settle < 1 s, overshoot < 10%', hit: Mn.ts < 1 && Mn.os < 10, err: Mn.os, u: '% OS' }],
      charts: [
        chart(cols, rows, 'y', 'step response', 't', ['r', 'y', 'y exact (ideal PID)']),
        chart(cols, rows, 'u', 'control effort', 't', ['u', 'P', 'I', 'D']),
        { id: 'pz', title: 'closed-loop poles & root locus (Kp 0→2Kp)', xl: 'Re', yl: 'Im', series: [{ name: 'locus', x: rl.x, y: rl.y, pts: true }, { name: 'poles', x: poles.map((q) => q[0]), y: poles.map((q) => q[1]), pts: true }] },
      ],
      draw(G, i) {
        const q = rows[i];
        G.view(-1, 11, -1, 5, 10, false);
        const box = (x: number, y: number, t: string, c = COL.fg) => { G.rect(x, y, 2, 1, c); G.text(t, x + 0.2, y + 0.35, c); };
        box(2, 3, 'PID', COL.a); box(6, 3, 'plant', COL.b);
        G.circle(0.8, 3.5, 0.3, COL.fg); G.arrow(-0.6, 3.5, 20, 0, COL.fg, 'r'); G.line(1.1, 3.5, 2, 3.5); G.line(4, 3.5, 6, 3.5); G.line(8, 3.5, 10, 3.5);
        G.line(9, 3.5, 9, 1.5); G.line(9, 1.5, 0.8, 1.5); G.line(0.8, 1.5, 0.8, 3.2);
        G.text(`u=${q[4].toFixed(3)}`, 4.3, 3.8, COL.f); G.text(`y=${q[2].toFixed(4)}`, 8.2, 3.8, COL.c); G.text(`e=${q[3].toFixed(4)}`, 1.2, 2.2, COL.d);
        G.hud([`t=${q[0].toFixed(4)} s`]);
      },
    };
  },
};
