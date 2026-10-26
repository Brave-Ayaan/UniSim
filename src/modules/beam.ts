import type { SimModule, Check } from '../core/types';
import { cumtrapz, maxAbs, argmax } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

const KF: Record<string, number> = { 'pinned-pinned K=1': 1, 'fixed-free K=2': 2, 'fixed-pinned K=0.699': 0.699, 'fixed-fixed K=0.5': 0.5 };

export const beam: SimModule = {
  id: 'beam',
  name: 'Beam / civil structural',
  desc: 'beam shear, moment, deflection (numerical double integration vs closed form), stress, buckling',
  timeBased: false,
  stepsLabel: 'segments',
  settings: { dt: 1, steps: 600, method: 'rk4' },
  params: [
    { k: 'sup', l: 'support', v: 'simply supported', o: ['simply supported', 'cantilever'] },
    { k: 'L', l: 'span', u: 'm', v: 6, min: 1e-6, s: 0.5 },
    { k: 'P', l: 'point load', u: 'kN', v: 10, s: 1 },
    { k: 'a', l: 'point load position', u: 'm', v: 3, min: 0, s: 0.25 },
    { k: 'w', l: 'uniform load', u: 'kN/m', v: 2, s: 0.5 },
    { k: 'E', l: 'Young modulus', u: 'GPa', v: 200, min: 1e-6, s: 10 },
    { k: 'b', l: 'section width', u: 'mm', v: 100, min: 1e-6, s: 10 },
    { k: 'h', l: 'section depth', u: 'mm', v: 200, min: 1e-6, s: 10 },
    { k: 'fy', l: 'yield strength', u: 'MPa', v: 250, min: 1e-6, s: 10 },
    { k: 'Pax', l: 'axial compression', u: 'kN', v: 100, min: 0, s: 10 },
    { k: 'K', l: 'column end condition', v: 'pinned-pinned K=1', o: Object.keys(KF) },
    { k: 'lim', l: 'deflection limit L/x', v: 360, min: 1, s: 10 },
  ],
  run(p, s) {
    const cant = str(p, 'sup') === 'cantilever';
    const L = num(p, 'L'), P = num(p, 'P') * 1e3, a = Math.min(L, Math.max(0, num(p, 'a'))), w = num(p, 'w') * 1e3;
    const E = num(p, 'E') * 1e9, b = num(p, 'b') / 1e3, h = num(p, 'h') / 1e3, fy = num(p, 'fy') * 1e6;
    const I = (b * h ** 3) / 12, A = b * h, EI = E * I, c = h / 2;
    const n = Math.max(10, Math.floor(s.steps));
    const xs = [...Array(n + 1).keys()].map((i) => (i * L) / n);
    // statics (downward loads positive)
    const RA = cant ? P + w * L : (P * (L - a)) / L + (w * L) / 2;
    const RB = cant ? 0 : (P * a) / L + (w * L) / 2;
    const V = (x: number) => (cant ? (x < a ? P : 0) + w * (L - x) : RA - w * x - (x > a ? P : 0));
    const M = (x: number) => (cant ? -(x < a ? P * (a - x) : 0) - (w * (L - x) ** 2) / 2 : RA * x - (w * x * x) / 2 - (x > a ? P * (x - a) : 0));
    const Ms = xs.map(M);
    // numerical: y'' = M/EI integrated twice, BCs applied
    const th = cumtrapz(xs, Ms.map((m) => m / EI));
    let y = cumtrapz(xs, th);
    let thf = th;
    if (!cant) {
      const k = y[n] / L;
      y = y.map((v, i) => v - k * xs[i]);
      thf = th.map((v) => v - k);
    }
    const dNum = y.map((v) => -v); // downward positive
    const bb = L - a;
    const dA = (x: number) => {
      let d = 0;
      if (cant) {
        d += x <= a ? (P * x * x * (3 * a - x)) / (6 * EI) : (P * a * a * (3 * x - a)) / (6 * EI);
        d += (w * x * x * (6 * L * L - 4 * L * x + x * x)) / (24 * EI);
      } else {
        d += x <= a ? (P * bb * x * (L * L - bb * bb - x * x)) / (6 * L * EI) : (P * a * (L - x) * (L * L - a * a - (L - x) ** 2)) / (6 * L * EI);
        d += (w * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EI);
      }
      return d;
    };
    const dAn = xs.map(dA);
    const cols = ['x', 'V (kN)', 'M (kN m)', 'slope (rad)', 'defl num (mm)', 'defl analytic (mm)', 'err (mm)', 'σ bottom (MPa)'];
    const rows = xs.map((x, i) => [x, V(x) / 1e3, Ms[i] / 1e3, thf[i], dNum[i] * 1e3, dAn[i] * 1e3, (dNum[i] - dAn[i]) * 1e3, (Ms[i] * c) / I / 1e6]);
    const Mmax = maxAbs(Ms), Vmax = maxAbs(xs.map(V));
    const iN = argmax(dNum.map(Math.abs)), iA = argmax(dAn.map(Math.abs));
    const checks: Check[] = [
      { l: 'max deflection', exp: dAn[iA] * 1e3, act: dNum[iN] * 1e3, u: 'mm', tol: 1e-4 },
      { l: cant ? 'tip deflection' : 'midspan deflection', exp: dA(cant ? L : L / 2) * 1e3, act: (cant ? dNum[n] : dNum[Math.round(n / 2)]) * 1e3, u: 'mm', tol: 1e-4 },
      { l: 'vertical equilibrium ΣF', exp: P + w * L, act: RA + RB, u: 'N', abs: 1e-6 },
    ];
    if (w === 0 && !cant) checks.push({ l: 'Mmax = Pab/L', exp: (P * a * (L - a)) / L / 1e3, act: Mmax / 1e3, u: 'kN m', tol: 1e-3 });
    if (P === 0 && !cant) checks.push({ l: 'Mmax = wL²/8', exp: (w * L * L) / 8 / 1e3, act: Mmax / 1e3, u: 'kN m', tol: 1e-3 });
    if (P === 0 && cant) checks.push({ l: 'tip defl = wL⁴/8EI', exp: ((w * L ** 4) / (8 * EI)) * 1e3, act: dNum[n] * 1e3, u: 'mm', tol: 1e-4 });
    if (w === 0 && cant && a === L) checks.push({ l: 'tip defl = PL³/3EI', exp: ((P * L ** 3) / (3 * EI)) * 1e3, act: dNum[n] * 1e3, u: 'mm', tol: 1e-4 });
    if (w === 0 && !cant && Math.abs(a - L / 2) < 1e-12) checks.push({ l: 'δ = PL³/48EI', exp: ((P * L ** 3) / (48 * EI)) * 1e3, act: dNum[Math.round(n / 2)] * 1e3, u: 'mm', tol: 1e-4 });
    const sig = (Mmax * c) / I, tau = (1.5 * Vmax) / A;
    const Kc = KF[str(p, 'K')] ?? 1;
    const Imin = Math.min(b * h ** 3, h * b ** 3) / 12, rg = Math.sqrt(Imin / A), lam = (Kc * L) / rg;
    const lamC = Math.sqrt((2 * Math.PI ** 2 * E) / fy);
    const PcrE = (Math.PI ** 2 * E * Imin) / (Kc * L) ** 2;
    const Pcr = lam >= lamC ? PcrE : A * (fy - ((fy * fy) / (4 * Math.PI ** 2 * E)) * lam * lam);
    const Pax = num(p, 'Pax') * 1e3;
    const lim = L / num(p, 'lim');
    return {
      cols, rows, checks,
      notes: ['numerical: M/EI integrated twice (trapezoid), BCs applied; analytic: superposed closed-form elastic curves', `column: ${lam >= lamC ? 'Euler (slender)' : 'Johnson parabola (intermediate)'} regime, λ=${lam.toFixed(1)}, λc=${lamC.toFixed(1)}`],
      targets: [
        { l: 'bending stress < fy', hit: sig < fy, err: sig / fy, u: 'σ/fy' },
        { l: `deflection < L/${num(p, 'lim')}`, hit: Math.abs(dNum[iN]) < lim, err: (Math.abs(dNum[iN]) / lim), u: 'δ/δlim' },
        { l: 'axial load < Pcr', hit: Pax < Pcr, err: Pax / Pcr, u: 'P/Pcr' },
      ],
      scalars: [
        { l: 'reaction A', v: RA / 1e3, u: 'kN' },
        { l: cant ? 'fixed-end moment' : 'reaction B', v: (cant ? M(0) : RB) / 1e3, u: cant ? 'kN m' : 'kN' },
        { l: 'I', v: I, u: 'm4' },
        { l: '|M| max', v: Mmax / 1e3, u: 'kN m' },
        { l: '|V| max', v: Vmax / 1e3, u: 'kN' },
        { l: 'max bending stress', v: sig / 1e6, u: 'MPa' },
        { l: 'max shear stress 1.5V/A', v: tau / 1e6, u: 'MPa' },
        { l: 'bending FS fy/σ', v: fy / sig },
        { l: 'max deflection', v: dNum[iN] * 1e3, u: 'mm' },
        { l: 'Euler Pcr', v: PcrE / 1e3, u: 'kN' },
        { l: 'design Pcr', v: Pcr / 1e3, u: 'kN' },
        { l: 'buckling FS', v: Pcr / Pax },
      ],
      charts: [
        chart(cols, rows, 'sfd', 'shear force diagram', 'x', ['V (kN)'], { tAxis: false }),
        chart(cols, rows, 'bmd', 'bending moment diagram', 'x', ['M (kN m)'], { tAxis: false }),
        chart(cols, rows, 'defl', 'deflection (down +)', 'x', ['defl num (mm)', 'defl analytic (mm)'], { tAxis: false, yl: 'mm' }),
      ],
      draw(G, i) {
        const mx = Math.max(maxAbs(dNum), 1e-12);
        const sc = (0.12 * L) / mx;
        G.view(-0.05 * L, 1.05 * L, -0.3 * L, 0.15 * L);
        G.line(0, 0, L, 0, COL.grid, 3);
        G.path(xs, dNum.map((d) => -d * sc), COL.a, 2);
        if (cant) { G.line(0, -0.08 * L, 0, 0.08 * L, COL.fg, 3); }
        else {
          G.fillPoly([0, -0.02 * L, 0.02 * L], [0, -0.04 * L, -0.04 * L], COL.dim);
          G.circle(L, -0.02 * L, 0.02 * L, COL.dim);
        }
        if (P) G.arrow(a, 0.08 * L, 0, -24 * Math.sign(P), COL.d, `${(P / 1e3).toFixed(1)} kN`);
        if (w) for (let k = 0; k <= 10; k++) G.arrow((k * L) / 10, 0.04 * L, 0, -10 * Math.sign(w), COL.b);
        const r = rows[i];
        G.line(r[0], -0.25 * L, r[0], 0.12 * L, COL.f, 1, [2, 3]);
        G.hud([`x=${r[0].toFixed(3)} V=${r[1].toFixed(3)} kN M=${r[2].toFixed(3)} kN m δ=${r[4].toFixed(3)} mm`, `deflection exaggerated x${sc.toFixed(0)}`]);
      },
    };
  },
};
