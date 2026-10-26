import type { SimModule, Result, Params, Settings, Check } from '../core/types';
import { integrate, crossings, meanPeriod, simpson, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

export const waves: SimModule = {
  id: 'waves',
  name: 'Wave mechanics',
  desc: 'string wave equation (standing waves, pulses, modal exact), multi-slit interference (Huygens sum), Doppler pass-by',
  timeBased: true,
  settings: { dt: 2e-5, steps: 5000, method: 'semi' },
  modeSettings: { string: { dt: 2e-5, steps: 5000, method: 'semi' }, interference: { steps: 1000 }, doppler: { steps: 400 } },
  params: [
    { k: 'mode', l: 'mode', v: 'string', o: ['string', 'interference', 'doppler'] },
    { k: 'L', l: 'string length', u: 'm', v: 1, min: 1e-9, s: 0.1, when: (p) => p.mode === 'string' },
    { k: 'T', l: 'tension', u: 'N', v: 100, min: 1e-9, s: 10, when: (p) => p.mode === 'string' },
    { k: 'mu', l: 'linear density', u: 'kg/m', v: 0.01, min: 1e-12, s: 0.001, when: (p) => p.mode === 'string' },
    { k: 'init', l: 'initial shape', v: 'mode n', o: ['mode n', 'pluck', 'two pulses'], when: (p) => p.mode === 'string' },
    { k: 'n', l: 'mode number', v: 2, min: 1, s: 1, when: (p) => p.mode === 'string' && p.init === 'mode n' },
    { k: 'xp', l: 'pluck point', u: 'x/L', v: 0.25, min: 0.01, max: 0.99, s: 0.05, when: (p) => p.mode === 'string' && p.init === 'pluck' },
    { k: 'A', l: 'amplitude', u: 'm', v: 0.01, s: 0.005, when: (p) => p.mode === 'string' },
    { k: 'N', l: 'grid points', v: 201, min: 5, max: 1001, s: 50, when: (p) => p.mode === 'string' },
    { k: 'lam', l: 'wavelength', u: 'nm', v: 550, min: 1e-6, s: 10, when: (p) => p.mode === 'interference' },
    { k: 'ns', l: 'number of slits', v: 2, min: 1, max: 50, s: 1, when: (p) => p.mode === 'interference' },
    { k: 'dsl', l: 'slit spacing', u: 'mm', v: 0.1, min: 1e-6, s: 0.01, when: (p) => p.mode === 'interference' },
    { k: 'asl', l: 'slit width', u: 'mm', v: 0.02, min: 1e-6, s: 0.005, when: (p) => p.mode === 'interference' },
    { k: 'Ds', l: 'screen distance', u: 'm', v: 1, min: 1e-6, s: 0.1, when: (p) => p.mode === 'interference' },
    { k: 'f0', l: 'source frequency', u: 'Hz', v: 440, min: 1e-6, s: 10, when: (p) => p.mode === 'doppler' },
    { k: 'vs', l: 'source speed', u: 'm/s', v: 30, s: 5, when: (p) => p.mode === 'doppler' },
    { k: 'vo', l: 'observer speed (+x)', u: 'm/s', v: 0, s: 5, when: (p) => p.mode === 'doppler' },
    { k: 'yo', l: 'closest distance', u: 'm', v: 10, min: 0, s: 1, when: (p) => p.mode === 'doppler' },
    { k: 'Tair', l: 'air temperature', u: 'C', v: 20, s: 1, when: (p) => p.mode === 'doppler' },
    { k: 'Lw', l: 'source power level', u: 'dB', v: 100, s: 5, when: (p) => p.mode === 'doppler' },
  ],
  run(p, s) {
    const m = str(p, 'mode');
    if (m === 'string') return stringWave(p, s);
    if (m === 'interference') return interference(p, s);
    return doppler(p, s);
  },
};

function stringWave(p: Params, s: Settings): Result {
  const L = num(p, 'L'), T = num(p, 'T'), mu = num(p, 'mu'), A = num(p, 'A'), N = Math.max(5, Math.round(num(p, 'N')));
  const c = Math.sqrt(T / mu), dx = L / (N - 1), init = str(p, 'init');
  const xs = [...Array(N).keys()].map((i) => i * dx);
  const n = Math.max(1, Math.round(num(p, 'n'))), xp = num(p, 'xp') * L;
  const w = 0.05 * L;
  const g = (x: number, x0: number) => A * Math.exp(-(((x - x0) / w) ** 2));
  const gp = (x: number, x0: number) => (-2 * (x - x0) / (w * w)) * g(x, x0);
  const y0f = (x: number) => (init === 'mode n' ? A * Math.sin((n * Math.PI * x) / L) : init === 'pluck' ? (x < xp ? (A * x) / xp : (A * (L - x)) / (L - xp)) : g(x, 0.3 * L) + g(x, 0.7 * L));
  // two pulses: left one travels right (v = -c g'), right one travels left (v = +c g')
  const v0f = (x: number) => (init === 'two pulses' ? -c * gp(x, 0.3 * L) + c * gp(x, 0.7 * L) : 0);
  const M = N - 2;
  const y0 = [...xs.slice(1, -1).map(y0f), ...xs.slice(1, -1).map(v0f)];
  const k2 = (c * c) / (dx * dx);
  const f = (_t: number, y: number[]) => {
    const d = new Array(2 * M);
    for (let i = 0; i < M; i++) {
      d[i] = y[M + i];
      d[M + i] = k2 * ((i > 0 ? y[i - 1] : 0) - 2 * y[i] + (i < M - 1 ? y[i + 1] : 0));
    }
    return d;
  };
  const tr = integrate(f, y0, s, { nq: M });
  // exact continuous solution by sine series
  const K = init === 'mode n' ? n : 300;
  const bn: number[] = [], dn: number[] = [];
  for (let m = 1; m <= K; m++) {
    if (init === 'mode n') { bn.push(m === n ? A : 0); dn.push(0); continue; }
    bn.push((2 / L) * simpson((x) => y0f(x) * Math.sin((m * Math.PI * x) / L), 0, L, 4000));
    dn.push((2 / L) * simpson((x) => v0f(x) * Math.sin((m * Math.PI * x) / L), 0, L, 4000));
  }
  const exact = (x: number, t: number) => {
    let y = 0;
    for (let m = 1; m <= K; m++) {
      const wm = (m * Math.PI * c) / L;
      y += (bn[m - 1] * Math.cos(wm * t) + (dn[m - 1] / wm) * Math.sin(wm * t)) * Math.sin((m * Math.PI * x) / L);
    }
    return y;
  };
  const probe = Math.round((N - 1) * 0.3);
  const mid = Math.round((N - 1) / 2);
  const cols = ['t', 'y(0.3L)', 'y(L/2)', 'y(0.3L) exact', 'KE', 'PE', 'E'];
  const rows = tr.t.map((t, i) => {
    const y = tr.y[i];
    let KE = 0, PE = 0;
    for (let j = 0; j < M; j++) KE += 0.5 * mu * dx * y[M + j] ** 2;
    for (let j = 0; j <= M; j++) PE += (0.5 * T * ((j < M ? y[j] : 0) - (j > 0 ? y[j - 1] : 0)) ** 2) / dx;
    return [t, y[probe - 1], y[mid - 1], exact(xs[probe], t), KE, PE, KE + PE];
  });
  const cfl = (c * s.dt) / dx;
  const f1 = c / (2 * L);
  const checks: Check[] = [
    { l: 'energy conserved', exp: rows[0][6], act: rows[rows.length - 1][6], u: 'J', tol: 1e-3 },
  ];
  if (init === 'mode n') {
    const Tm = meanPeriod(crossings(rows.map((r) => r[0]), rows.map((r) => r[1]), 0, -1));
    checks.push({ l: `f${n} = n c / 2L`, exp: n * f1, act: 1 / Tm, u: 'Hz', tol: 2e-3 });
  }
  const last = rows[rows.length - 1];
  checks.push({ l: 'y(0.3L, t_end) vs sine series', exp: last[3], act: last[1], u: 'm', abs: 0.01 * Math.abs(A), ref: init === 'pluck' });
  const snaps = tr.y;
  return {
    cols, rows, checks,
    notes: [`wave speed c = √(T/μ) = ${c.toFixed(3)} m/s, Courant number c·dt/dx = ${cfl.toFixed(3)}${cfl > 1 ? ' > 1: semi-implicit unstable' : ''}${s.method === 'euler' ? ' (explicit Euler is unconditionally unstable for waves)' : ''}`, 'grid dispersion: discrete string modes are slightly slower than continuous ones'],
    scalars: [{ l: 'wave speed', v: c, u: 'm/s' }, { l: 'fundamental f1', v: f1, u: 'Hz' }, { l: 'wavelength mode n', v: (2 * L) / n, u: 'm' }, { l: 'Courant number', v: cfl }, { l: 'initial energy', v: rows[0][6], u: 'J' }],
    charts: [chart(cols, rows, 'y', 'displacement at probes', 't', ['y(0.3L)', 'y(0.3L) exact', 'y(L/2)'], { yl: 'm' }), chart(cols, rows, 'e', 'energy', 't', ['KE', 'PE', 'E'], { yl: 'J' })],
    draw(G, i) {
      const y = snaps[i];
      G.view(-0.02 * L, 1.02 * L, -2.2 * Math.abs(A), 2.2 * Math.abs(A), 18, false);
      G.line(0, 0, L, 0, COL.grid);
      G.path(xs, [0, ...y.slice(0, M), 0], COL.a, 2);
      const t = rows[i][0];
      const ex = xs.map((x, j) => (j % 4 === 0 || j === N - 1 ? exact(x, t) : NaN));
      G.path(xs.filter((_, j) => !Number.isNaN(ex[j])), ex.filter((v) => !Number.isNaN(v)), COL.b, 1, false, [3, 3]);
      G.hud([`t=${t.toExponential(3)} s  solid=FD  dashed=exact series`]);
    },
  };
}

function interference(p: Params, s: Settings): Result {
  const lam = num(p, 'lam') * 1e-9, ns = Math.max(1, Math.round(num(p, 'ns'))), d = num(p, 'dsl') / 1e3, a = num(p, 'asl') / 1e3, D = num(p, 'Ds');
  const n = Math.min(4000, Math.max(50, Math.floor(s.steps)));
  const span = Math.min(0.4 * D, (4 * lam * D) / d);
  const k = (2 * Math.PI) / lam;
  // Huygens: integrate secondary wavelets across every slit aperture with exact path lengths
  const sub = 64;
  const srcs: number[] = [];
  for (let j = 0; j < ns; j++) {
    const c0 = (j - (ns - 1) / 2) * d;
    for (let q = 0; q < sub; q++) srcs.push(c0 - a / 2 + (a * (q + 0.5)) / sub);
  }
  const ys = [...Array(n + 1).keys()].map((i) => -span + (2 * span * i) / n);
  const Iraw = ys.map((y) => {
    let re = 0, im = 0;
    for (const ysrc of srcs) { const r = Math.hypot(D, y - ysrc); re += Math.cos(k * r) / r; im += Math.sin(k * r) / r; }
    return re * re + im * im;
  });
  const I0 = maxOf(Iraw);
  const fraun = (y: number) => {
    const st = y / Math.hypot(y, D);
    const b = (Math.PI * a * st) / lam, ph = (2 * Math.PI * d * st) / lam;
    const sinc = b === 0 ? 1 : Math.sin(b) / b;
    const arr = Math.abs(Math.sin(ph / 2)) < 1e-12 ? 1 : Math.sin((ns * ph) / 2) / (ns * Math.sin(ph / 2));
    return sinc * sinc * arr * arr;
  };
  const cols = ['y (mm)', 'I Huygens', 'I Fraunhofer'];
  const rows = ys.map((y, i) => [y * 1e3, Iraw[i] / I0, fraun(y)]);
  // principal maxima spacing from the numerical pattern
  const peaks: number[] = [];
  for (let i = 1; i < n; i++) if (rows[i][1] > rows[i - 1][1] && rows[i][1] >= rows[i + 1][1] && rows[i][1] > 0.3) {
    const y0 = rows[i - 1][1], y1 = rows[i][1], y2 = rows[i + 1][1];
    const off = (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2 || 1);
    peaks.push(ys[i] + off * (ys[1] - ys[0]));
  }
  const dy = peaks.length > 1 ? (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1) : NaN;
  // first dark fringe above the axis (zeros are not shifted by the single-slit envelope, unlike maxima)
  const c0 = Math.round(n / 2);
  let z1 = NaN;
  for (let i = c0 + 1; i < n; i++) if (rows[i][1] <= rows[i - 1][1] && rows[i][1] < rows[i + 1][1]) {
    const y0 = rows[i - 1][1], y1 = rows[i][1], y2 = rows[i + 1][1];
    z1 = ys[i] + ((0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2 || 1)) * (ys[1] - ys[0]);
    break;
  }
  const z1exp = D * Math.tan(Math.asin(ns > 1 ? lam / (ns * d) : lam / a));
  const fres = (a * a) / (lam * D);
  return {
    cols, rows,
    notes: [`${srcs.length} Huygens point sources, exact path lengths; Fresnel number a²/λD = ${fres.toExponential(2)} (≪1 → Fraunhofer valid)`, 'table rows = screen positions (steps = resolution)'],
    checks: [
      { l: ns > 1 ? 'first dark fringe: sinθ = λ/(N d)' : 'first dark fringe: sinθ = λ/a', exp: z1exp * 1e3, act: z1 * 1e3, u: 'mm', tol: 2e-3, ref: z1exp > span },
      { l: 'mean fringe spacing vs λD/d (envelope-shifted maxima)', exp: ((lam * D) / d) * 1e3, act: dy * 1e3, u: 'mm', ref: true },
      { l: 'max |Huygens - Fraunhofer|', exp: 0, act: maxOf(rows.map((r) => Math.abs(r[1] - r[2]))), abs: 0.02 },
    ],
    scalars: [{ l: 'fringe spacing (theory)', v: ((lam * D) / d) * 1e3, u: 'mm' }, { l: 'measured spacing', v: dy * 1e3, u: 'mm' }, { l: 'single-slit first zero', v: ((lam * D) / a) * 1e3, u: 'mm' }, { l: 'visible orders in envelope', v: Math.floor(d / a) }],
    charts: [chart(cols, rows, 'I', 'screen intensity', 'y (mm)', ['I Huygens', 'I Fraunhofer'], { tAxis: false })],
    draw(G, i) {
      G.view(0, 1, -1, 1, 10, false);
      const ctx = G.ctx;
      rows.forEach((r, j) => {
        const v = Math.round(255 * Math.sqrt(r[1]));
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(G.X(j / rows.length), G.Y(0.9), (G.X(1) - G.X(0)) / rows.length + 1, G.Y(0.15) - G.Y(0.9));
      });
      ctx.strokeStyle = COL.f;
      const X = G.X(i / rows.length);
      ctx.beginPath(); ctx.moveTo(X, G.Y(0.95)); ctx.lineTo(X, G.Y(0.1)); ctx.stroke();
      G.path(rows.map((_, j) => j / rows.length), rows.map((r) => -0.9 + r[1] * 0.9), COL.a);
      G.hud([`λ=${num(p, 'lam')} nm  N=${ns}  y=${rows[i][0].toFixed(3)} mm  I=${rows[i][1].toFixed(3)}`]);
    },
  };
}

function doppler(p: Params, s: Settings): Result {
  const f0 = num(p, 'f0'), vs = num(p, 'vs'), vo = num(p, 'vo'), yo = num(p, 'yo'), Tc = num(p, 'Tair'), Lw = num(p, 'Lw');
  const c = 331.3 * Math.sqrt(1 + Tc / 273.15);
  const n = Math.min(4000, Math.max(20, Math.floor(s.steps)));
  // emissions every source period; source moves on y=0 from x=-X0, observer on y=yo starting at x=0
  const Te = 1 / f0, X0 = Math.max(4 * yo, Math.abs(vs) * n * Te * 0.5);
  const xs = (t: number) => -X0 + vs * t, xo = (t: number) => vo * t;
  const arrive = (te: number) => {
    let ta = te + Math.hypot(xo(te) - xs(te), yo) / c;
    for (let k = 0; k < 50; k++) {
      const g = ta - te - Math.hypot(xo(ta) - xs(te), yo) / c;
      const dg = 1 - ((xo(ta) - xs(te)) * vo) / (c * Math.hypot(xo(ta) - xs(te), yo) || 1);
      const nt = ta - g / dg;
      if (Math.abs(nt - ta) < 1e-15) { ta = nt; break; }
      ta = nt;
    }
    return ta;
  };
  const ta = [...Array(n + 1).keys()].map((i) => arrive(i * Te));
  const cols = ['t emit', 't arrive', 'x source', 'f measured', 'f formula', 'err', 'SPL (dB)'];
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const te = (i + 0.5) * Te, tm = 0.5 * (ta[i] + ta[i + 1]);
    const fm = 1 / (ta[i + 1] - ta[i]);
    const dxv = xo(tm) - xs(te), r = Math.hypot(dxv, yo);
    const ux = dxv / r; // unit vector source -> observer (x component)
    const ff = (f0 * (c - vo * ux)) / (c - vs * ux);
    rows.push([te, tm, xs(te), fm, ff, fm - ff, Lw - 20 * Math.log10(Math.max(r, 1e-6)) - 11]);
  }
  const sup = Math.abs(vs) >= c;
  return {
    cols, rows,
    notes: [`c = 331.3√(1+T/273.15) = ${c.toFixed(3)} m/s; arrival times solved exactly (Newton), f = 1/Δt_arrival`, ...(sup ? ['supersonic source: Mach cone, arrivals out of order'] : [])],
    checks: [
      { l: 'max |f_measured - f_formula|', exp: 0, act: maxOf(rows.map((r) => Math.abs(r[5]))), u: 'Hz', abs: 1e-3 * f0, ref: sup },
      { l: 'approach limit f0 c/(c-vs)', exp: (f0 * (c - vo)) / (c - vs), act: rows[0][3], u: 'Hz', tol: 0.02, ref: true },
    ],
    scalars: [
      { l: 'speed of sound', v: c, u: 'm/s' }, { l: 'f approaching (head-on)', v: (f0 * (c - vo)) / (c - vs), u: 'Hz' }, { l: 'f receding (head-on)', v: (f0 * (c + vo)) / (c + vs), u: 'Hz' },
      { l: 'Mach number', v: Math.abs(vs) / c }, { l: 'Mach angle', v: sup ? (Math.asin(c / Math.abs(vs)) * 180) / Math.PI : NaN, u: 'deg' }, { l: 'peak SPL', v: maxOf(rows.map((r) => r[6])), u: 'dB' },
    ],
    charts: [chart(cols, rows, 'f', 'received frequency', 't arrive', ['f measured', 'f formula'], { tAxis: false, yl: 'Hz' }), chart(cols, rows, 'spl', 'sound pressure level', 't arrive', ['SPL (dB)'], { tAxis: false })],
    draw(G, i) {
      const t = rows[i][1];
      const R = Math.max(X0 * 0.6, yo * 2);
      const sx = xs(t);
      G.view(sx - R, sx + R, -R * 0.6, R * 0.6);
      const step = Math.max(1, Math.round(n / 40));
      for (let j = 0; j <= n; j += step) {
        const te = j * Te;
        if (te > t) break;
        G.circle(xs(te), 0, c * (t - te), COL.grid);
      }
      G.circle(sx, 0, 4, COL.b, true, true);
      G.circle(xo(t), yo, 4, COL.c, true, true);
      G.hud([`t=${t.toFixed(4)} s  f_obs=${rows[i][3].toFixed(3)} Hz`]);
    },
  };
}
