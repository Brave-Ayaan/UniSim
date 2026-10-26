import type { SimModule, Check, Result, Params, Settings } from '../core/types';
import { integrate, crossings, solve, cumtrapz, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

export const circuits: SimModule = {
  id: 'circuits',
  name: 'Electrical circuits',
  desc: 'RLC / RC / RL step transients (closed form), driven AC phasors, resistor network nodal solve',
  timeBased: true,
  settings: { dt: 1e-5, steps: 5000, method: 'rk4' },
  modeSettings: { 'RC charge': { dt: 1e-5, steps: 5000 }, 'RL step': { dt: 1e-5, steps: 5000 } },
  params: [
    { k: 'mode', l: 'circuit', v: 'RLC step', o: ['RLC step', 'RC charge', 'RL step', 'AC series RLC', 'resistor network'] },
    { k: 'V', l: 'source voltage (peak)', u: 'V', v: 10, s: 1 },
    { k: 'R', l: 'R (R1)', u: 'ohm', v: 10, min: 0, s: 1 },
    { k: 'L', l: 'L', u: 'mH', v: 10, min: 1e-9, s: 1, when: (p) => p.mode !== 'RC charge' && p.mode !== 'resistor network' },
    { k: 'C', l: 'C', u: 'uF', v: 100, min: 1e-9, s: 10, when: (p) => p.mode !== 'RL step' && p.mode !== 'resistor network' },
    { k: 'f', l: 'frequency', u: 'Hz', v: 159.155, min: 1e-9, s: 10, when: (p) => p.mode === 'AC series RLC' },
    { k: 'R2', l: 'R2', u: 'ohm', v: 20, min: 1e-12, s: 1, when: (p) => p.mode === 'resistor network' },
    { k: 'R3', l: 'R3', u: 'ohm', v: 30, min: 1e-12, s: 1, when: (p) => p.mode === 'resistor network' },
  ],
  run(p, s) {
    const mode = str(p, 'mode');
    if (mode === 'resistor network') return network(p);
    if (mode === 'AC series RLC') return ac(p, s);
    return transient(p, s, mode);
  },
};

function transient(p: Params, s: Settings, mode: string): Result {
  const V = num(p, 'V'), R = num(p, 'R'), L = num(p, 'L') * 1e-3, C = num(p, 'C') * 1e-6;
  const checks: Check[] = [];
  const scalars: { l: string; v: number; u?: string }[] = [];
  let tr, cols: string[], rows: number[][], an: (t: number) => number, anName: string;
  if (mode === 'RLC step') {
    // state [q, i]: L di/dt = V - R i - q/C
    tr = integrate((_t, y) => [y[1], (V - R * y[1] - y[0] / C) / L], [0, 0], s, { nq: 1 });
    const a = R / (2 * L), w0 = 1 / Math.sqrt(L * C), z = a / w0;
    let Vc: (t: number) => number;
    if (Math.abs(z - 1) < 1e-9) Vc = (t) => V * (1 - Math.exp(-a * t) * (1 + a * t));
    else if (z < 1) {
      const wd = Math.sqrt(w0 * w0 - a * a);
      Vc = (t) => V * (1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t)));
      scalars.push({ l: 'damped freq ωd', v: wd, u: 'rad/s' }, { l: 'overshoot Vc max', v: V * (1 + Math.exp((-a * Math.PI) / wd)), u: 'V' });
    } else {
      const r = Math.sqrt(a * a - w0 * w0), s1 = -a + r, s2 = -a - r;
      Vc = (t) => V * (1 + (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s1 - s2));
    }
    an = Vc; anName = 'Vc analytic';
    scalars.push({ l: 'α = R/2L', v: a, u: '1/s' }, { l: 'ω0 = 1/√LC', v: w0, u: 'rad/s' }, { l: 'f0', v: w0 / (2 * Math.PI), u: 'Hz' }, { l: 'damping ratio ζ', v: z }, { l: 'Q factor', v: (1 / R) * Math.sqrt(L / C) }, { l: 'regime', v: z < 1 ? -1 : z > 1 ? 1 : 0, u: '-1 under 0 crit 1 over' });
    cols = ['t', 'q', 'i', 'Vc', 'VR', 'VL', 'E_C', 'E_L', 'E_R', 'W_src', 'Vc analytic', 'err'];
    const ts = tr.t, is = tr.y.map((y) => y[1]);
    const ER = cumtrapz(ts, is.map((i) => i * i * R)), Ws = cumtrapz(ts, is.map((i) => V * i));
    rows = ts.map((t, k) => {
      const [q, i] = tr.y[k];
      const vc = q / C;
      return [t, q, i, vc, R * i, V - R * i - vc, 0.5 * C * vc * vc, 0.5 * L * i * i, ER[k], Ws[k], an(t), vc - an(t)];
    });
    const last = rows[rows.length - 1];
    checks.push({ l: 'Vc(t_end) closed form', exp: an(last[0]), act: last[3], u: 'V', abs: 1e-6 * Math.abs(V) });
    checks.push({ l: 'max |Vc error|', exp: 0, act: maxOf(rows.map((r) => Math.abs(r[11]))), u: 'V', abs: 1e-4 * Math.abs(V) });
    checks.push({ l: 'energy: W_src = E_C+E_L+E_R', exp: last[9], act: last[6] + last[7] + last[8], u: 'J', abs: 1e-4 * Math.abs(last[9]) + 1e-12 });
    if (z < 1) checks.push({ l: 'peak Vc', exp: V * (1 + Math.exp((-a * Math.PI) / Math.sqrt(w0 * w0 - a * a))), act: maxOf(rows.map((r) => r[3])), u: 'V', tol: 1e-3, ref: last[0] < Math.PI / Math.sqrt(w0 * w0 - a * a) });
  } else if (mode === 'RC charge') {
    const tau = R * C;
    tr = integrate((_t, y) => [(V - y[0] / C) / R], [0], s);
    an = (t) => V * (1 - Math.exp(-t / tau)); anName = 'Vc analytic';
    cols = ['t', 'q', 'i', 'Vc', 'VR', 'Vc analytic', 'err'];
    rows = tr.t.map((t, k) => {
      const q = tr.y[k][0], vc = q / C;
      return [t, q, (V - vc) / R, vc, V - vc, an(t), vc - an(t)];
    });
    const t63 = crossings(rows.map((r) => r[0]), rows.map((r) => r[3]), V * (1 - Math.exp(-1)), V >= 0 ? 1 : -1)[0];
    checks.push({ l: 'time to 63.21% = RC', exp: tau, act: t63 ?? NaN, u: 's' });
    checks.push({ l: 'Vc(t_end)', exp: an(rows[rows.length - 1][0]), act: rows[rows.length - 1][3], u: 'V', abs: 1e-6 * Math.abs(V) });
    scalars.push({ l: 'τ = RC', v: tau, u: 's' }, { l: 'final energy ½CV²', v: 0.5 * C * V * V, u: 'J' });
  } else {
    const tau = L / R;
    tr = integrate((_t, y) => [(V - R * y[0]) / L], [0], s);
    an = (t) => (V / R) * (1 - Math.exp(-t / tau)); anName = 'i analytic';
    cols = ['t', 'i', 'VR', 'VL', 'E_L', 'i analytic', 'err'];
    rows = tr.t.map((t, k) => {
      const i = tr.y[k][0];
      return [t, i, R * i, V - R * i, 0.5 * L * i * i, an(t), i - an(t)];
    });
    const t63 = crossings(rows.map((r) => r[0]), rows.map((r) => r[1]), (V / R) * (1 - Math.exp(-1)), V >= 0 ? 1 : -1)[0];
    checks.push({ l: 'time to 63.21% = L/R', exp: tau, act: t63 ?? NaN, u: 's' });
    checks.push({ l: 'i(t_end)', exp: an(rows[rows.length - 1][0]), act: rows[rows.length - 1][1], u: 'A', abs: 1e-6 * Math.abs(V / R) });
    scalars.push({ l: 'τ = L/R', v: tau, u: 's' }, { l: 'final current V/R', v: V / R, u: 'A' });
  }
  const main = mode === 'RL step' ? 'i' : 'Vc';
  return {
    cols, rows, checks, scalars,
    charts: [
      chart(cols, rows, 'main', `${main} numeric vs analytic`, 't', [main, anName]),
      chart(cols, rows, 'err', 'numerical error', 't', ['err']),
      ...(mode === 'RLC step' ? [chart(cols, rows, 'en', 'energy', 't', ['E_C', 'E_L', 'E_R', 'W_src'], { yl: 'J' })] : []),
    ],
    draw(G, k) {
      const r = rows[k];
      drawLoop(G, mode === 'RLC step' ? ['R', 'L', 'C'] : mode === 'RC charge' ? ['R', 'C'] : ['R', 'L'], mode === 'RL step' ? r[1] : r[2]);
      G.hud([`t=${r[0].toExponential(3)} s  ${cols.slice(1, 5).map((c, j) => `${c}=${r[j + 1].toPrecision(4)}`).join('  ')}`]);
    },
  };
}

function drawLoop(G: any, parts: string[], i: number) {
  G.view(0, 10, 0, 6);
  G.ctx.strokeStyle = COL.fg;
  G.line(1, 1, 9, 1); G.line(1, 5, 9, 5); G.line(1, 1, 1, 5); G.line(9, 1, 9, 5);
  G.rect(0.6, 2.5, 0.8, 1, COL.bg, true); G.text('V', 0.75, 2.8, COL.f);
  parts.forEach((pt, k) => {
    const x = 2.5 + k * 2.5;
    G.rect(x - 0.6, 4.6, 1.2, 0.8, COL.bg, true);
    G.rect(x - 0.6, 4.6, 1.2, 0.8, pt === 'R' ? COL.b : pt === 'L' ? COL.c : COL.a);
    G.text(pt, x - 0.15, 4.75, COL.fg);
  });
  // current tracer dots
  const ph = (performance.now() / 1000) * Math.sign(i) * Math.min(5, Math.abs(i) * 2);
  for (let k = 0; k < 12; k++) {
    const u = (((k / 12 + ph) % 1) + 1) % 1;
    const per = 24, d = u * per;
    const [x, y] = d < 8 ? [1 + d, 5] : d < 12 ? [9, 5 - (d - 8)] : d < 20 ? [9 - (d - 12), 1] : [1, 1 + (d - 20)];
    G.circle(x, y, 2, COL.f, true, true);
  }
  G.text(`i = ${i.toPrecision(5)} A`, 3.5, 2.8, COL.f);
}

function ac(p: Params, s: Settings): Result {
  const V = num(p, 'V'), R = num(p, 'R'), L = num(p, 'L') * 1e-3, C = num(p, 'C') * 1e-6, f = num(p, 'f');
  const w = 2 * Math.PI * f;
  const X = w * L - 1 / (w * C), Z = Math.hypot(R, X), I0 = V / Z, phi = Math.atan2(X, R);
  const tr = integrate((t, y) => [y[1], (V * Math.sin(w * t) - R * y[1] - y[0] / C) / L], [0, 0], s, { nq: 1 });
  const cols = ['t', 'v_src', 'i', 'VR', 'VL', 'VC', 'i steady-state', 'p_inst'];
  const rows = tr.t.map((t, k) => {
    const [q, i] = tr.y[k];
    const vs = V * Math.sin(w * t), vc = q / C;
    return [t, vs, i, R * i, vs - R * i - vc, vc, I0 * Math.sin(w * t - phi), vs * i];
  });
  const T = 1 / f, tEnd = rows[rows.length - 1][0];
  const tail = rows.filter((r) => r[0] > tEnd - 2 * T);
  const Imeas = maxOf(tail.map((r) => Math.abs(r[2])));
  const ci = crossings(rows.map((r) => r[0]), rows.map((r) => r[2]), 0, 1).filter((t) => t > tEnd - 3 * T);
  const cv = crossings(rows.map((r) => r[0]), rows.map((r) => r[1]), 0, 1).filter((t) => t > tEnd - 4 * T);
  let lag = NaN;
  if (ci.length && cv.length) {
    const tc = ci[ci.length - 1];
    const tv = cv.filter((t) => t <= tc + 1e-12).pop() ?? NaN;
    lag = ((((tc - tv) / T) * 2 * Math.PI + Math.PI) % (2 * Math.PI)) - Math.PI;
  }
  const a = R / (2 * L), settle = 5 / a;
  const settled = tEnd - 2 * T > settle;
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const fs = [...Array(400).keys()].map((k) => (f0 * 3 * (k + 1)) / 400);
  return {
    cols, rows,
    notes: settled ? [] : [`transient decays with τ=2L/R=${(1 / a).toExponential(3)} s; run ≥ ${settle.toExponential(2)} s for steady-state checks`],
    checks: [
      { l: 'steady amplitude V/|Z|', exp: I0, act: Imeas, u: 'A', tol: 2e-3, ref: !settled },
      { l: 'phase lag φ = atan(X/R)', exp: phi, act: lag, u: 'rad', abs: (2 * Math.PI * s.dt) / T + 2e-3, ref: !settled },
      { l: 'mean power ½I0²R', exp: 0.5 * I0 * I0 * R, act: tail.length > 1 ? avg(tail.map((r) => r[7]), tail.map((r) => r[0])) : NaN, u: 'W', tol: 5e-3, ref: !settled },
    ],
    scalars: [
      { l: 'ω', v: w, u: 'rad/s' }, { l: 'reactance X', v: X, u: 'ohm' }, { l: '|Z|', v: Z, u: 'ohm' }, { l: 'phase φ', v: (phi * 180) / Math.PI, u: 'deg' },
      { l: 'I peak', v: I0, u: 'A' }, { l: 'I rms', v: I0 / Math.SQRT2, u: 'A' }, { l: 'power factor', v: Math.cos(phi) },
      { l: 'resonance f0', v: f0, u: 'Hz' }, { l: 'Q factor', v: (1 / R) * Math.sqrt(L / C) }, { l: 'bandwidth', v: R / (2 * Math.PI * L), u: 'Hz' },
    ],
    charts: [
      chart(cols, rows, 'vi', 'source voltage & current', 't', ['v_src', 'i', 'i steady-state']),
      chart(cols, rows, 'vv', 'element voltages', 't', ['VR', 'VL', 'VC'], { yl: 'V' }),
      { id: 'fr', title: 'frequency response |I|(f)', xl: 'f (Hz)', yl: 'A', series: [{ name: '|I|', x: fs, y: fs.map((ff) => V / Math.hypot(R, 2 * Math.PI * ff * L - 1 / (2 * Math.PI * ff * C))) }, { name: 'operating f', x: [f, f], y: [0, I0], dash: true }] },
    ],
    draw(G, k) {
      const t = rows[k][0];
      G.view(-1.2, 1.2, -1.2, 1.2);
      G.circle(0, 0, 1, COL.grid);
      const sc = 1 / Math.max(V, I0 * R, I0 * w * L, I0 / (w * C), 1e-12);
      const th = w * t - phi; // current phasor angle
      const ph = (m: number, a: number, c: string, lab: string, x0 = 0, y0 = 0) => {
        G.line(x0, y0, x0 + m * sc * Math.cos(a), y0 + m * sc * Math.sin(a), c, 2);
        G.text(lab, x0 + m * sc * Math.cos(a), y0 + m * sc * Math.sin(a), c);
        return [x0 + m * sc * Math.cos(a), y0 + m * sc * Math.sin(a)];
      };
      const [x1, y1] = ph(I0 * R, th, COL.b, 'VR');
      const [x2, y2] = ph(I0 * w * L, th + Math.PI / 2, COL.c, 'VL', x1, y1);
      ph(I0 / (w * C), th - Math.PI / 2, COL.a, 'VC', x2, y2);
      ph(V, w * t, COL.f, 'V');
      G.hud(['rotating phasors (projection on y = instantaneous value)', `t=${t.toExponential(3)} s`]);
    },
  };
}

function avg(y: number[], t: number[]) {
  let s = 0;
  for (let i = 1; i < y.length; i++) s += 0.5 * (y[i] + y[i - 1]) * (t[i] - t[i - 1]);
  return s / (t[t.length - 1] - t[0]);
}

function network(p: Params): Result {
  const V = num(p, 'V'), R1 = num(p, 'R'), R2 = num(p, 'R2'), R3 = num(p, 'R3');
  // formula: R1 + (R2 || R3)
  const Rp = (R2 * R3) / (R2 + R3), Req = R1 + Rp, I = V / Req;
  const I2 = (I * R3) / (R2 + R3), I3 = (I * R2) / (R2 + R3);
  // nodal analysis: nodes a (after source+), b (junction); ground = source-
  const G1 = 1 / R1, G2 = 1 / R2, G3 = 1 / R3;
  // node a fixed at V; unknown Vb: (Vb - V)G1 + Vb G2 + Vb G3 = 0
  const [Vb] = solve([[G1 + G2 + G3]], [V * G1]);
  const In = (V - Vb) * G1, I2n = Vb * G2, I3n = Vb * G3;
  const cols = ['element', 'R (ohm)', 'V (V)', 'I (A)', 'P (W)'];
  const rows = [
    [1, R1, V - Vb, In, In * In * R1],
    [2, R2, Vb, I2n, I2n * I2n * R2],
    [3, R3, Vb, I3n, I3n * I3n * R3],
  ];
  return {
    cols, rows,
    notes: ['topology: V -- R1 -- (R2 || R3) -- ground; actual = nodal analysis (KCL matrix), expected = series/parallel formulas'],
    checks: [
      { l: 'source current', exp: I, act: In, u: 'A' },
      { l: 'I through R2 (divider)', exp: I2, act: I2n, u: 'A' },
      { l: 'I through R3 (divider)', exp: I3, act: I3n, u: 'A' },
      { l: 'KCL at junction', exp: In, act: I2n + I3n, u: 'A', abs: 1e-12 },
      { l: 'power balance VI = ΣI²R', exp: V * In, act: rows.reduce((a, r) => a + r[4], 0), u: 'W' },
    ],
    scalars: [{ l: 'R equivalent', v: Req, u: 'ohm' }, { l: 'R2 || R3', v: Rp, u: 'ohm' }, { l: 'total power', v: V * I, u: 'W' }],
    charts: [{ id: 'pw', title: 'power per element', xl: 'element', yl: 'W', bars: true, series: [{ name: 'P', x: [1, 2, 3], y: rows.map((r) => r[4]) }] }],
    draw(G) {
      G.view(0, 10, 0, 6);
      G.line(1, 1, 1, 5); G.line(1, 5, 5, 5); G.line(5, 5, 9, 5); G.line(9, 5, 9, 1); G.line(9, 1, 1, 1);
      G.line(5, 5, 5, 1);
      [[3, 5, 'R1'], [5, 3, 'R2'], [9, 3, 'R3']].forEach(([x, y, n]) => { G.rect(Number(x) - 0.4, Number(y) - 0.4, 0.8, 0.8, COL.bg, true); G.rect(Number(x) - 0.4, Number(y) - 0.4, 0.8, 0.8, COL.b); G.text(String(n), Number(x) + 0.5, Number(y), COL.fg); });
      G.text(`V=${V}`, 0.2, 3, COL.f);
      G.hud([`Vb=${Vb.toFixed(3)} V  I=${In.toFixed(3)} A`]);
    },
  };
}
