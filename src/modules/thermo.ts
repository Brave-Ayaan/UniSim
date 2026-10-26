import type { SimModule, Check, Result, Params, Settings } from '../core/types';
import { integrate, RGAS, crossings, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL, heat } from '../core/gfx';

type Pt = [number, number, number]; // V, P, T

const gasModes = ['process', 'carnot cycle', 'otto cycle'];

export const thermo: SimModule = {
  id: 'thermo',
  name: 'Thermodynamics',
  desc: 'ideal-gas processes & cycles (PV/TS), 1D heat conduction (Fourier), phase change',
  timeBased: true,
  settings: { dt: 0.5, steps: 2000, method: 'rk4' },
  modeSettings: { process: { steps: 2000 }, 'carnot cycle': { steps: 2000 }, 'otto cycle': { steps: 2000 }, conduction: { dt: 0.5, steps: 10000 }, 'phase change': { dt: 0.5, steps: 3600 } },
  params: [
    { k: 'mode', l: 'mode', v: 'carnot cycle', o: ['process', 'carnot cycle', 'otto cycle', 'conduction', 'phase change'] },
    { k: 'n', l: 'moles', u: 'mol', v: 1, min: 1e-9, s: 0.1, when: (p) => gasModes.includes(String(p.mode)) },
    { k: 'gam', l: 'gamma Cp/Cv', v: 1.4, min: 1.0001, s: 0.01, when: (p) => gasModes.includes(String(p.mode)) },
    { k: 'P1', l: 'initial pressure', u: 'kPa', v: 101.325, min: 1e-9, s: 10, when: (p) => gasModes.includes(String(p.mode)) },
    { k: 'T1', l: 'initial temp', u: 'K', v: 300, min: 1e-6, s: 10, when: (p) => p.mode === 'process' || p.mode === 'otto cycle' },
    { k: 'proc', l: 'process', v: 'isothermal', o: ['isothermal', 'isobaric', 'isochoric', 'adiabatic'], when: (p) => p.mode === 'process' },
    { k: 'r', l: 'ratio V2/V1 (P2/P1 isochoric)', v: 2, min: 1e-6, s: 0.1, when: (p) => p.mode === 'process' || p.mode === 'carnot cycle' },
    { k: 'Th', l: 'hot reservoir', u: 'K', v: 500, min: 1e-6, s: 10, when: (p) => p.mode === 'carnot cycle' },
    { k: 'Tc', l: 'cold reservoir', u: 'K', v: 300, min: 1e-6, s: 10, when: (p) => p.mode === 'carnot cycle' },
    { k: 'rc', l: 'compression ratio', v: 8, min: 1.0001, s: 0.5, when: (p) => p.mode === 'otto cycle' },
    { k: 'Qin', l: 'heat added', u: 'J', v: 20000, min: 0, s: 1000, when: (p) => p.mode === 'otto cycle' },
    { k: 'L', l: 'rod length', u: 'm', v: 0.5, min: 1e-6, s: 0.05, when: (p) => p.mode === 'conduction' },
    { k: 'k', l: 'conductivity', u: 'W/m K', v: 205, min: 1e-9, s: 5, when: (p) => p.mode === 'conduction' },
    { k: 'rho', l: 'density', u: 'kg/m3', v: 2700, min: 1e-9, s: 100, when: (p) => p.mode === 'conduction' },
    { k: 'cp', l: 'specific heat', u: 'J/kg K', v: 900, min: 1e-9, s: 50, when: (p) => p.mode === 'conduction' },
    { k: 'TL', l: 'left boundary T', u: 'C', v: 100, s: 5, when: (p) => p.mode === 'conduction' },
    { k: 'TR', l: 'right boundary T', u: 'C', v: 0, s: 5, when: (p) => p.mode === 'conduction' },
    { k: 'T0', l: 'initial rod T', u: 'C', v: 20, s: 5, when: (p) => p.mode === 'conduction' },
    { k: 'N', l: 'grid nodes', v: 41, min: 3, max: 400, s: 10, when: (p) => p.mode === 'conduction' },
    { k: 'mw', l: 'water mass', u: 'kg', v: 1, min: 1e-9, s: 0.1, when: (p) => p.mode === 'phase change' },
    { k: 'Ts', l: 'start temp', u: 'C', v: -20, s: 5, when: (p) => p.mode === 'phase change' },
    { k: 'Te', l: 'end temp', u: 'C', v: 120, s: 5, when: (p) => p.mode === 'phase change' },
    { k: 'Pw', l: 'heater power', u: 'W', v: 2000, min: 1e-9, s: 100, when: (p) => p.mode === 'phase change' },
  ],
  run(p, s) {
    const mode = str(p, 'mode');
    if (mode === 'conduction') return conduction(p, s);
    if (mode === 'phase change') return phase(p, s);
    return gas(p, s, mode);
  },
};

function gas(p: Params, s: Settings, mode: string): Result {
  const n = num(p, 'n'), gm = num(p, 'gam'), Cv = RGAS / (gm - 1), Cp = gm * Cv, P1 = num(p, 'P1') * 1e3;
  const nR = n * RGAS;
  const N = Math.max(8, Math.floor(s.steps));
  const legs: { name: string; pts: Pt[] }[] = [];
  const leg = (name: string, kind: string, a: Pt, target: number) => {
    const pts: Pt[] = [];
    const m = Math.max(2, Math.floor(N / (mode === 'process' ? 1 : 4)));
    for (let i = 0; i <= m; i++) {
      const f = i / m;
      let V: number, P: number;
      if (kind === 'isochoric') { V = a[0]; P = a[1] + (target - a[1]) * f; }
      else {
        V = a[0] + (target - a[0]) * f;
        P = kind === 'isothermal' ? (a[1] * a[0]) / V : kind === 'adiabatic' ? a[1] * (a[0] / V) ** gm : a[1];
      }
      pts.push([V, P, (P * V) / nR]);
    }
    legs.push({ name, pts });
    return pts[pts.length - 1];
  };
  const checks: Check[] = [];
  const scalars: { l: string; v: number; u?: string }[] = [];
  let analytic: { W: number; Q: number; dU: number; dS: number } | null = null;
  if (mode === 'process') {
    const T1 = num(p, 'T1'), V1 = (nR * T1) / P1, r = num(p, 'r'), kind = str(p, 'proc');
    const end = leg(kind, kind, [V1, P1, T1], kind === 'isochoric' ? P1 * r : V1 * r);
    const T2 = end[2];
    if (kind === 'isothermal') analytic = { W: nR * T1 * Math.log(r), Q: nR * T1 * Math.log(r), dU: 0, dS: nR * Math.log(r) };
    if (kind === 'isobaric') analytic = { W: P1 * (end[0] - V1), Q: n * Cp * (T2 - T1), dU: n * Cv * (T2 - T1), dS: n * Cp * Math.log(T2 / T1) };
    if (kind === 'isochoric') analytic = { W: 0, Q: n * Cv * (T2 - T1), dU: n * Cv * (T2 - T1), dS: n * Cv * Math.log(T2 / T1) };
    if (kind === 'adiabatic') analytic = { W: (P1 * V1 - end[1] * end[0]) / (gm - 1), Q: 0, dU: n * Cv * (T2 - T1), dS: 0 };
    scalars.push({ l: 'V1', v: V1, u: 'm3' }, { l: 'V2', v: end[0], u: 'm3' }, { l: 'P2', v: end[1] / 1e3, u: 'kPa' }, { l: 'T2', v: T2, u: 'K' });
  } else if (mode === 'carnot cycle') {
    const Th = num(p, 'Th'), Tc = num(p, 'Tc'), r = num(p, 'r');
    const V1 = (nR * Th) / P1;
    const k = (Th / Tc) ** (1 / (gm - 1));
    let st: Pt = [V1, P1, Th];
    st = leg('isothermal expansion @Th', 'isothermal', st, V1 * r);
    st = leg('adiabatic expansion', 'adiabatic', st, V1 * r * k);
    st = leg('isothermal compression @Tc', 'isothermal', st, V1 * k);
    leg('adiabatic compression', 'adiabatic', st, V1);
    const Qh = nR * Th * Math.log(r);
    scalars.push({ l: 'Carnot efficiency 1-Tc/Th', v: 1 - Tc / Th }, { l: 'Qh (analytic)', v: Qh, u: 'J' }, { l: 'W net (analytic)', v: Qh * (1 - Tc / Th), u: 'J' });
  } else {
    const T1 = num(p, 'T1'), rc = num(p, 'rc'), Qin = num(p, 'Qin');
    const V1 = (nR * T1) / P1;
    let st: Pt = [V1, P1, T1];
    st = leg('adiabatic compression', 'adiabatic', st, V1 / rc);
    const T3 = st[2] + Qin / (n * Cv);
    st = leg('isochoric heat addition', 'isochoric', st, (nR * T3) / st[0]);
    st = leg('adiabatic expansion', 'adiabatic', st, V1);
    leg('isochoric heat rejection', 'isochoric', st, P1);
    scalars.push({ l: 'Otto efficiency 1-rc^(1-γ)', v: 1 - rc ** (1 - gm) }, { l: 'peak temp T3', v: T3, u: 'K' }, { l: 'peak pressure', v: maxOf(legs.flatMap((l) => l.pts.map((q) => q[1]))) / 1e3, u: 'kPa' });
  }
  // numerical path integrals
  const cols = ['i', 'V', 'P', 'T', 'U', 'S', 'W_cum', 'Q_cum', 'leg'];
  const rows: number[][] = [];
  let W = 0, Q = 0, S = 0, Qpos = 0, Qneg = 0, i = 0;
  legs.forEach((lg, li) => {
    lg.pts.forEach((q, j) => {
      if (j > 0) {
        const a = lg.pts[j - 1];
        const dW = 0.5 * (a[1] + q[1]) * (q[0] - a[0]);
        const dQ = n * Cv * (q[2] - a[2]) + dW;
        W += dW; Q += dQ; S += dQ / (0.5 * (a[2] + q[2]));
        if (dQ > 0) Qpos += dQ; else Qneg += dQ;
      } else if (li > 0) return;
      rows.push([i++, q[0], q[1] / 1e3, q[2], n * Cv * q[2], S, W, Q, li]);
    });
  });
  const last = rows[rows.length - 1];
  if (analytic) {
    checks.push({ l: 'work ∫PdV', exp: analytic.W, act: W, u: 'J', abs: 1e-6 });
    checks.push({ l: 'heat Q', exp: analytic.Q, act: Q, u: 'J', abs: 1e-6 });
    checks.push({ l: 'ΔU = nCvΔT', exp: analytic.dU, act: last[4] - rows[0][4], u: 'J', abs: 1e-6 });
    checks.push({ l: 'ΔS = ∫dQ/T', exp: analytic.dS, act: S, u: 'J/K', abs: 1e-6 });
    scalars.push({ l: 'W', v: W, u: 'J' }, { l: 'Q', v: Q, u: 'J' }, { l: 'ΔS', v: S, u: 'J/K' });
  } else {
    const eta = W / Qpos;
    const exp = scalars[0].v;
    checks.push({ l: 'efficiency W/Qin', exp, act: eta });
    checks.push({ l: 'cycle ΔS = 0', exp: 0, act: S, u: 'J/K', abs: 1e-6 });
    checks.push({ l: 'cycle ΔU = 0 (W = Q)', exp: Q, act: W, u: 'J', abs: 1e-6 });
    scalars.push({ l: 'W net (numeric)', v: W, u: 'J' }, { l: 'Q in', v: Qpos, u: 'J' }, { l: 'Q out', v: Qneg, u: 'J' });
  }
  return {
    cols, rows, checks, scalars,
    notes: ['V, P, T sampled along each leg (steps = resolution); W = trapezoidal ∫PdV, ΔS = Σ dQ/T_mid'],
    charts: [
      chart(cols, rows, 'pv', 'P-V diagram', 'V', ['P'], { tAxis: false, yl: 'kPa' }),
      chart(cols, rows, 'ts', 'T-S diagram', 'S', ['T'], { tAxis: false, yl: 'K' }),
      chart(cols, rows, 'wq', 'cumulative W, Q', 'i', ['W_cum', 'Q_cum'], { yl: 'J' }),
    ],
    draw(G, i) {
      const Vs = rows.map((r) => r[1]), Ps = rows.map((r) => r[2]);
      const vmax = maxOf(Vs), pmax = maxOf(Ps);
      G.insetR = 100; // piston sketch column
      G.view(0, vmax * 1.05, 0, pmax * 1.1, 26, false);
      G.line(0, 0, vmax * 1.05, 0, COL.dim);
      G.line(0, 0, 0, pmax * 1.1, COL.dim);
      G.path(Vs, Ps, COL.a);
      const r = rows[i];
      G.circle(r[1], r[2], 4, COL.b, true, true);
      // piston cylinder sketch
      const w = 70, h = 100, X0 = G.W - w - 16, Y0 = G.top + 8;
      const fill = (r[1] / vmax) * h;
      G.ctx.strokeStyle = COL.fg;
      G.ctx.strokeRect(X0 + 0.5, Y0 + 0.5, w, h);
      G.ctx.fillStyle = heat((r[3] - 200) / 600);
      G.ctx.globalAlpha = 0.25;
      G.ctx.fillRect(X0 + 1, Y0 + h - fill, w - 1, fill);
      G.ctx.globalAlpha = 1;
      G.ctx.fillStyle = COL.fg;
      G.ctx.fillRect(X0, Y0 + h - fill - 3, w, 3);
      G.hud([`${legs[r[8]]?.name ?? ''}`, `V=${r[1].toExponential(3)} m3 P=${r[2].toFixed(3)} kPa T=${r[3].toFixed(3)} K`]);
    },
  };
}

function conduction(p: Params, s: Settings): Result {
  const L = num(p, 'L'), k = num(p, 'k'), rho = num(p, 'rho'), cp = num(p, 'cp');
  const TL = num(p, 'TL'), TR = num(p, 'TR'), T0 = num(p, 'T0');
  const N = Math.max(3, Math.round(num(p, 'N')));
  const a = k / (rho * cp), dx = L / (N - 1);
  const xs = [...Array(N).keys()].map((i) => i * dx);
  const f = (_t: number, y: number[]) => {
    const d = new Array(y.length);
    for (let i = 0; i < y.length; i++) {
      const l = i === 0 ? TL : y[i - 1], r = i === y.length - 1 ? TR : y[i + 1];
      d[i] = (a * (l - 2 * y[i] + r)) / (dx * dx);
    }
    return d;
  };
  const tr = integrate(f, new Array(N - 2).fill(T0), s);
  const full = (y: number[]) => [TL, ...y, TR];
  const Tss = (x: number) => TL + ((TR - TL) * x) / L;
  const analytic = (x: number, t: number) => {
    let T = Tss(x);
    for (let m = 1; m <= 400; m++) {
      const Bm = (2 / (m * Math.PI)) * ((T0 - TL) * (1 - (-1) ** m) - (TR - TL) * (-1) ** (m + 1));
      const e = Math.exp(-a * ((m * Math.PI) / L) ** 2 * t);
      if (e < 1e-300) break;
      T += Bm * Math.sin((m * Math.PI * x) / L) * e;
    }
    return T;
  };
  const at = (prof: number[], x: number) => {
    const j = Math.min(N - 2, Math.floor(x / dx));
    const fr = (x - j * dx) / dx;
    return prof[j] + fr * (prof[j + 1] - prof[j]);
  };
  const cols = ['t', 'T(L/4)', 'T(L/2)', 'T(3L/4)', 'T(L/2) analytic', 'q_in left', 'q_out right'];
  const profiles = tr.y.map(full);
  const rows = tr.t.map((t, i) => {
    const P = profiles[i];
    return [t, at(P, L / 4), at(P, L / 2), at(P, (3 * L) / 4), analytic(L / 2, t), (-k * (P[1] - P[0])) / dx, (-k * (P[N - 1] - P[N - 2])) / dx];
  });
  const last = rows[rows.length - 1], tEnd = last[0];
  const lastP = profiles[profiles.length - 1];
  let maxErr = 0;
  xs.forEach((x, i) => (maxErr = Math.max(maxErr, Math.abs(lastP[i] - analytic(x, tEnd)))));
  const r = (a * s.dt) / (dx * dx);
  const notes = [`Fourier number r = αdt/dx² = ${r.toFixed(4)}${r > 0.5 ? '  > 0.5: explicit Euler (FTCS) is UNSTABLE' : ''}`, 'method of lines: semi-discrete ODE integrated with the selected method'];
  return {
    cols, rows, notes,
    checks: [
      { l: 'T(L/2) final vs Fourier series', exp: last[4], act: last[2], u: 'C', tol: 1e-3, abs: 1e-3 },
      { l: 'max profile error (final)', exp: 0, act: maxErr, u: 'C', abs: 0.01 * Math.max(1, Math.abs(TL - TR)) },
      { l: 'steady flux kΔT/L (ref)', exp: (k * (TL - TR)) / L, act: last[6], u: 'W/m2', ref: true },
    ],
    scalars: [
      { l: 'thermal diffusivity α', v: a, u: 'm2/s' },
      { l: 'time constant L²/(π²α)', v: (L * L) / (Math.PI ** 2 * a), u: 's' },
      { l: 'steady-state flux', v: (k * (TL - TR)) / L, u: 'W/m2' },
      { l: 'Fourier number dt', v: r },
    ],
    charts: [
      chart(cols, rows, 'tp', 'temperatures', 't', ['T(L/4)', 'T(L/2)', 'T(3L/4)', 'T(L/2) analytic'], { yl: 'C' }),
      { id: 'prof', title: 'profile at t_end', xl: 'x (m)', yl: 'C', series: [
        { name: 'numeric', x: xs, y: lastP },
        { name: 'analytic', x: xs, y: xs.map((x) => analytic(x, tEnd)), dash: true },
        { name: 'steady', x: xs, y: xs.map(Tss), dash: true },
      ] },
      chart(cols, rows, 'q', 'boundary heat flux', 't', ['q_in left', 'q_out right'], { yl: 'W/m2' }),
    ],
    draw(G, i) {
      const P = profiles[i];
      const lo = Math.min(TL, TR, T0), hi = Math.max(TL, TR, T0);
      G.view(-0.05 * L, 1.05 * L, -0.4 * (hi - lo || 1), (hi - lo || 1) * 1.1 + lo, 22, false);
      const ctx = G.ctx;
      for (let j = 0; j < N; j++) {
        ctx.fillStyle = heat((P[j] - lo) / (hi - lo || 1));
        const x0 = G.X(xs[j] - dx / 2), x1 = G.X(xs[j] + dx / 2);
        ctx.fillRect(x0, G.Y(lo) + 10, x1 - x0 + 1, 16);
      }
      G.path(xs, P, COL.fg);
      G.path(xs, xs.map((x) => analytic(x, rows[i][0])), COL.b, 1, false, [3, 3]);
      G.hud([`t=${rows[i][0].toFixed(3)} s   solid=numeric  dashed=analytic`]);
    },
  };
}

function phase(p: Params, s: Settings): Result {
  const m = num(p, 'mw'), Ts = num(p, 'Ts') + 273.15, Te = num(p, 'Te') + 273.15, P = num(p, 'Pw');
  const ci = 2108, cw = 4186, cs = 2010, Lf = 334000, Lv = 2256000, Tm = 273.15, Tb = 373.15;
  // enthalpy breakpoints relative to the start state (start assumed solid if below Tm etc.)
  const H = (T: number, ph: number) => (ph === 0 ? m * ci * (T - Tm) : ph === 1 ? m * Lf + m * cw * (T - Tm) : m * Lf + m * cw * (Tb - Tm) + m * Lv + m * cs * (T - Tb));
  const phOf = (T: number) => (T < Tm ? 0 : T <= Tb ? 1 : 2);
  const H0 = H(Ts, phOf(Ts));
  const b = [H(Tm, 0), H(Tm, 0) + m * Lf, H(Tb, 1), H(Tb, 1) + m * Lv];
  const TofH = (h: number): [number, number, number, number] => {
    if (h < b[0]) return [Tm + h / (m * ci), 1, 0, 0];
    if (h < b[1]) { const f = (h - b[0]) / (m * Lf); return [Tm, 1 - f, f, 0]; }
    if (h < b[2]) return [Tm + (h - b[1]) / (m * cw), 0, 1, 0];
    if (h < b[3]) { const f = (h - b[2]) / (m * Lv); return [Tb, 0, 1 - f, f]; }
    return [Tb + (h - b[3]) / (m * cs), 0, 0, 1];
  };
  const tr = integrate(() => [P], [H0], s);
  const cols = ['t', 'Q added', 'T (C)', 'solid frac', 'liquid frac', 'vapour frac', 'S_cum'];
  let S = 0;
  const rows = tr.t.map((t, i) => {
    const [T, a, l, v] = TofH(tr.y[i][0]);
    if (i > 0) {
      const Tp = TofH(tr.y[i - 1][0])[0];
      // exact dQ/T over a linear-in-Q temperature segment
      const dQ = tr.y[i][0] - tr.y[i - 1][0];
      S += Math.abs(T - Tp) > 1e-12 ? (dQ * Math.log(T / Tp)) / (T - Tp) : dQ / T;
    }
    return [t, tr.y[i][0] - H0, T - 273.15, a, l, v, S];
  });
  const Hend = H(Te, phOf(Te));
  const tA = (Hend - H0) / P;
  const cr = crossings(rows.map((r) => r[0]), rows.map((r) => r[2]), Te - 273.15 - 1e-9, 1);
  // analytic entropy along the same path
  const seg = (T1: number, T2: number, c: number) => (T2 > T1 ? m * c * Math.log(T2 / T1) : 0);
  let SA = 0;
  const Tf = Te;
  if (Ts < Tm) SA += seg(Ts, Math.min(Tf, Tm), ci);
  if (Tf >= Tm && Ts < Tm) SA += (m * Lf) / Tm;
  if (Tf > Tm) SA += seg(Math.max(Ts, Tm), Math.min(Tf, Tb), cw);
  if (Tf > Tb && Ts <= Tb) SA += (m * Lv) / Tb;
  if (Tf > Tb) SA += seg(Math.max(Ts, Tb), Tf, cs);
  const SatEnd = interpRow(rows, cr[0]);
  return {
    cols, rows,
    notes: ['enthalpy method: dH/dt = P (exact for any integrator); T recovered from H piecewise'],
    checks: [
      { l: `time to reach ${num(p, 'Te')} C`, exp: tA, act: cr[0] ?? NaN, u: 's' },
      { l: 'entropy change ∫dQ/T', exp: SA, act: SatEnd, u: 'J/K' },
    ],
    scalars: [
      { l: 'total heat', v: Hend - H0, u: 'J' },
      { l: 'melting starts', v: (b[0] - H0) / P, u: 's' },
      { l: 'melting ends', v: (b[1] - H0) / P, u: 's' },
      { l: 'boiling starts', v: (b[2] - H0) / P, u: 's' },
      { l: 'boiling ends', v: (b[3] - H0) / P, u: 's' },
    ],
    charts: [
      chart(cols, rows, 'T', 'heating curve', 't', ['T (C)']),
      chart(cols, rows, 'ph', 'phase fractions', 't', ['solid frac', 'liquid frac', 'vapour frac']),
      chart(cols, rows, 'S', 'entropy', 't', ['S_cum'], { yl: 'J/K' }),
    ],
    draw(G, i) {
      const r = rows[i];
      G.view(0, 10, 0, 10, 10, false);
      const parts: [number, string, string][] = [[r[3], COL.a, 'solid'], [r[4], COL.c, 'liquid'], [r[5], COL.fg, 'vapour']];
      let x = 1;
      parts.forEach(([f, c, n]) => {
        G.rect(x, 3, 8 * f, 3, c, true);
        if (f > 0.08) G.text(n, x + 0.1, 6.4, c);
        x += 8 * f;
      });
      G.rect(1, 3, 8, 3, COL.dim);
      G.hud([`t=${r[0].toFixed(3)} s  T=${r[2].toFixed(3)} C  Q=${r[1].toFixed(0)} J`]);
    },
  };
}

function interpRow(rows: number[][], t: number) {
  if (t === undefined || Number.isNaN(t)) return NaN;
  for (let i = 1; i < rows.length; i++) if (rows[i][0] >= t) {
    const f = (t - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]);
    return rows[i - 1][6] + f * (rows[i][6] - rows[i - 1][6]);
  }
  return NaN;
}
