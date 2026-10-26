import type { SimModule, Result, Params, Settings } from '../core/types';
import { integrate, MU0, cumtrapz, maxOf, minOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

export const em: SimModule = {
  id: 'em',
  name: 'Electromagnetism',
  desc: 'Lorentz-force particle motion (exact cyclotron/drift), solenoid Biot-Savart, DC motor, AC generator',
  timeBased: true,
  settings: { dt: 1e-7, steps: 2000, method: 'rk4' },
  modeSettings: { lorentz: { dt: 1e-7, steps: 2000 }, solenoid: { steps: 400 }, 'dc motor': { dt: 1e-4, steps: 8000 }, 'ac generator': { dt: 1e-5, steps: 5000 } },
  params: [
    { k: 'mode', l: 'mode', v: 'lorentz', o: ['lorentz', 'solenoid', 'dc motor', 'ac generator'] },
    { k: 'q', l: 'charge', u: 'C', v: 1.602176634e-19, s: 1e-19, when: (p) => p.mode === 'lorentz' },
    { k: 'm', l: 'mass', u: 'kg', v: 1.67262192e-27, min: 1e-40, s: 1e-27, when: (p) => p.mode === 'lorentz' },
    { k: 'B', l: 'B field (z)', u: 'T', v: 1e-3, s: 1e-4, when: (p) => p.mode === 'lorentz' || p.mode === 'ac generator' },
    { k: 'Ex', l: 'E field x', u: 'V/m', v: 0, s: 10, when: (p) => p.mode === 'lorentz' },
    { k: 'Ey', l: 'E field y', u: 'V/m', v: 20, s: 10, when: (p) => p.mode === 'lorentz' },
    { k: 'vx', l: 'v0 x', u: 'm/s', v: 1e5, s: 1e4, when: (p) => p.mode === 'lorentz' },
    { k: 'vz', l: 'v0 z (pitch)', u: 'm/s', v: 2e4, s: 1e4, when: (p) => p.mode === 'lorentz' },
    { k: 'N', l: 'turns', v: 500, min: 1, s: 50, when: (p) => p.mode === 'solenoid' || p.mode === 'ac generator' },
    { k: 'Ls', l: 'solenoid length', u: 'm', v: 0.5, min: 1e-9, s: 0.05, when: (p) => p.mode === 'solenoid' },
    { k: 'Rs', l: 'solenoid radius', u: 'm', v: 0.05, min: 1e-9, s: 0.01, when: (p) => p.mode === 'solenoid' },
    { k: 'I', l: 'current', u: 'A', v: 2, s: 0.5, when: (p) => p.mode === 'solenoid' },
    { k: 'V', l: 'supply voltage', u: 'V', v: 12, s: 1, when: (p) => p.mode === 'dc motor' },
    { k: 'R', l: 'armature R / load R', u: 'ohm', v: 1, min: 1e-9, s: 0.1, when: (p) => p.mode === 'dc motor' || p.mode === 'ac generator' },
    { k: 'Lm', l: 'inductance', u: 'mH', v: 0.5, min: 1e-9, s: 0.1, when: (p) => p.mode === 'dc motor' || p.mode === 'ac generator' },
    { k: 'kt', l: 'torque/back-emf const', u: 'N m/A', v: 0.05, min: 1e-9, s: 0.005, when: (p) => p.mode === 'dc motor' },
    { k: 'J', l: 'rotor inertia', u: 'kg m2', v: 1e-4, min: 1e-12, s: 1e-5, when: (p) => p.mode === 'dc motor' },
    { k: 'bf', l: 'viscous friction', u: 'N m s', v: 1e-5, min: 0, s: 1e-6, when: (p) => p.mode === 'dc motor' },
    { k: 'tl', l: 'load torque', u: 'N m', v: 0.01, s: 0.005, when: (p) => p.mode === 'dc motor' },
    { k: 'Ac', l: 'coil area', u: 'cm2', v: 100, min: 1e-9, s: 10, when: (p) => p.mode === 'ac generator' },
    { k: 'rpm', l: 'shaft speed', u: 'rpm', v: 3000, s: 100, when: (p) => p.mode === 'ac generator' },
  ],
  run(p, s) {
    const m = str(p, 'mode');
    if (m === 'lorentz') return lorentz(p, s);
    if (m === 'solenoid') return solenoid(p, s);
    if (m === 'dc motor') return motor(p, s);
    return generator(p, s);
  },
};

function lorentz(p: Params, s: Settings): Result {
  const q = num(p, 'q'), m = num(p, 'm'), B = num(p, 'B'), Ex = num(p, 'Ex'), Ey = num(p, 'Ey'), vx0 = num(p, 'vx'), vz0 = num(p, 'vz');
  const qm = q / m;
  const f = (_t: number, y: number[]) => [y[3], y[4], y[5], qm * (Ex + y[4] * B), qm * (Ey - y[3] * B), 0];
  const tr = integrate(f, [0, 0, 0, vx0, 0, vz0], s, { nq: 3 });
  // exact: complex velocity w = vx + i vy relative to E×B drift rotates at -ωc
  const wc = qm * B;
  const vdx = B !== 0 ? Ey / B : 0, vdy = B !== 0 ? -Ex / B : 0;
  const w0 = [vx0 - vdx, 0 - vdy];
  const exact = (t: number) => {
    if (wc === 0) return [vx0 * t + 0.5 * qm * Ex * t * t, 0.5 * qm * Ey * t * t];
    // ∫ w0 e^{-iωc s} ds = w0 (1 - e^{-iωc t})/(iωc)
    const c = Math.cos(wc * t), sn = Math.sin(wc * t);
    const one = [1 - c, sn]; // 1 - e^{-iθ}
    const num2 = [w0[0] * one[0] - w0[1] * one[1], w0[0] * one[1] + w0[1] * one[0]];
    return [vdx * t + num2[1] / wc, vdy * t - num2[0] / wc];
  };
  const eV = 1.602176634e-19;
  const cols = ['t', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'speed', 'KE (eV)', 'pos err'];
  const rows = tr.t.map((t, i) => {
    const y = tr.y[i];
    const [ex, ey] = exact(t);
    const sp = Math.hypot(y[3], y[4], y[5]);
    return [t, y[0], y[1], y[2], y[3], y[4], y[5], sp, (0.5 * m * sp * sp) / eV, Math.hypot(y[0] - ex, y[1] - ey, y[2] - vz0 * t)];
  });
  const vperp = Math.hypot(w0[0], w0[1]);
  const rc = Math.abs(vperp / wc), Tc = Math.abs((2 * Math.PI) / wc);
  const last = rows[rows.length - 1];
  const xs = rows.map((r) => r[1]), ys = rows.map((r) => r[2]);
  return {
    cols, rows,
    notes: ['B along +z, E in the x-y plane; exact solution = E×B drift + gyration about the guiding centre'],
    checks: [
      { l: 'max position error vs exact', exp: 0, act: maxOf(rows.map((r) => r[9])), u: 'm', abs: 1e-6 * Math.max(rc, 1e-12) },
      { l: 'gyroradius (from orbit extent, drift frame)', exp: rc, act: (maxOf(rows.map((r, i) => r[2] - vdy * tr.t[i])) - minOf(rows.map((r, i) => r[2] - vdy * tr.t[i]))) / 2, u: 'm', tol: 1e-3, ref: last[0] < Tc },
      ...(Ex === 0 && Ey === 0 ? [{ l: 'KE conserved (magnetic force does no work)', exp: rows[0][8], act: last[8], u: 'eV', abs: 1e-9 * rows[0][8] }] : []),
    ],
    scalars: [
      { l: 'cyclotron frequency ωc', v: Math.abs(wc), u: 'rad/s' }, { l: 'cyclotron period', v: Tc, u: 's' }, { l: 'gyroradius', v: rc, u: 'm' },
      { l: 'E×B drift x', v: vdx, u: 'm/s' }, { l: 'E×B drift y', v: vdy, u: 'm/s' }, { l: 'pitch angle', v: (Math.atan2(vperp, vz0) * 180) / Math.PI, u: 'deg' },
    ],
    charts: [chart(cols, rows, 'xy', 'trajectory (x-y)', 'x', ['y'], { equal: true, tAxis: false }), chart(cols, rows, 'v', 'velocity', 't', ['vx', 'vy', 'vz']), chart(cols, rows, 'err', 'position error vs exact', 't', ['pos err'])],
    draw(G, i) {
      const pad = rc * 0.3;
      G.view(minOf(xs) - pad, maxOf(xs) + pad, minOf(ys) - pad, maxOf(ys) + pad);
      G.path(xs, ys, COL.grid);
      G.path(xs.slice(0, i + 1), ys.slice(0, i + 1), COL.a);
      const r = rows[i];
      G.circle(r[1], r[2], 3, COL.fg, true, true);
      const F = [q * (Ex + r[5] * B), q * (Ey - r[4] * B)];
      const Fm = Math.hypot(F[0], F[1]) || 1;
      G.arrow(r[1], r[2], (F[0] / Fm) * 20, (F[1] / Fm) * 20, COL.d, 'F');
      G.hud([`B ⊙ (out of screen)  t=${r[0].toExponential(3)} s`]);
    },
  };
}

function solenoid(p: Params, s: Settings): Result {
  const N = Math.max(1, Math.round(num(p, 'N'))), L = num(p, 'Ls'), R = num(p, 'Rs'), I = num(p, 'I');
  const n = N / L;
  const loops = [...Array(N).keys()].map((k) => -L / 2 + (L * (k + 0.5)) / N);
  const Bloops = (z: number) => loops.reduce((a, z0) => a + (MU0 * I * R * R) / (2 * (R * R + (z - z0) ** 2) ** 1.5), 0);
  const Bcont = (z: number) => ((MU0 * n * I) / 2) * ((z + L / 2) / Math.hypot(z + L / 2, R) - (z - L / 2) / Math.hypot(z - L / 2, R));
  const m = Math.min(2000, Math.max(20, Math.floor(s.steps)));
  const cols = ['z', 'B loops (mT)', 'B continuous (mT)', 'B ideal μ0nI (mT)'];
  const rows = [...Array(m + 1).keys()].map((k) => {
    const z = -L + (2 * L * k) / m;
    return [z, Bloops(z) * 1e3, Bcont(z) * 1e3, Math.abs(z) < L / 2 ? MU0 * n * I * 1e3 : 0];
  });
  const Lind = (MU0 * N * N * Math.PI * R * R) / L;
  return {
    cols, rows,
    notes: ['on-axis field: discrete sum of N circular loops (Biot-Savart) vs continuous current-sheet formula'],
    checks: [
      { l: 'centre field: loops vs continuous', exp: Bcont(0) * 1e3, act: Bloops(0) * 1e3, u: 'mT', tol: 1e-3 },
      { l: 'centre field vs ideal μ0nI', exp: MU0 * n * I * 1e3, act: Bloops(0) * 1e3, u: 'mT', tol: (R / L) ** 2 * 2.5, ref: L < 10 * R },
      { l: 'end field ≈ half centre (long solenoid)', exp: Bcont(0) * 0.5e3, act: Bloops(L / 2) * 1e3, u: 'mT', tol: 0.02, ref: true },
    ],
    scalars: [{ l: 'turn density n', v: n, u: '1/m' }, { l: 'ideal B', v: MU0 * n * I * 1e3, u: 'mT' }, { l: 'inductance (long)', v: Lind * 1e3, u: 'mH' }, { l: 'stored energy ½LI²', v: 0.5 * Lind * I * I, u: 'J' }],
    charts: [chart(cols, rows, 'B', 'axial field B(z)', 'z', ['B loops (mT)', 'B continuous (mT)', 'B ideal μ0nI (mT)'], { tAxis: false })],
    draw(G, i) {
      G.view(-L, L, -3 * R, 3 * R);
      G.rect(-L / 2, -R, L, 2 * R, COL.dim);
      const st = Math.max(1, Math.floor(N / 40));
      for (let k = 0; k < N; k += st) G.line(loops[k], -R, loops[k] + L / N / 2, R, COL.b);
      const mx = maxOf(rows.map((r) => r[1]));
      G.path(rows.map((r) => r[0]), rows.map((r) => (r[1] / mx) * 2.5 * R - 0.1 * R), COL.a);
      G.line(rows[i][0], -3 * R, rows[i][0], 3 * R, COL.f, 1, [2, 3]);
      G.hud([`z=${rows[i][0].toFixed(4)} m  B=${rows[i][1].toFixed(4)} mT`]);
    },
  };
}

function motor(p: Params, s: Settings): Result {
  const V = num(p, 'V'), R = num(p, 'R'), L = num(p, 'Lm') * 1e-3, k = num(p, 'kt'), J = num(p, 'J'), b = num(p, 'bf'), tl = num(p, 'tl');
  const tr = integrate((_t, y) => [(V - R * y[0] - k * y[1]) / L, (k * y[0] - b * y[1] - tl) / J], [0, 0], s);
  const ts = tr.t, is = tr.y.map((y) => y[0]), ws = tr.y.map((y) => y[1]);
  const Ein = cumtrapz(ts, is.map((i) => V * i)), Ecu = cumtrapz(ts, is.map((i) => i * i * R)), Efr = cumtrapz(ts, ws.map((w) => b * w * w)), Eld = cumtrapz(ts, ws.map((w) => tl * w));
  const cols = ['t', 'i', 'omega', 'rpm', 'torque', 'P_in', 'P_out', 'efficiency', 'E_in', 'E_stored+losses'];
  const rows = ts.map((t, j) => {
    const i = is[j], w = ws[j];
    const stored = 0.5 * L * i * i + 0.5 * J * w * w;
    return [t, i, w, (w * 60) / (2 * Math.PI), k * i, V * i, tl * w, V * i !== 0 ? (tl * w) / (V * i) : 0, Ein[j], stored + Ecu[j] + Efr[j] + Eld[j]];
  });
  const wss = (k * V - R * tl) / (k * k + R * b), iss = (b * wss + tl) / k;
  const last = rows[rows.length - 1];
  const te = (J * R) / (k * k + R * b);
  const settled = last[0] > 18 * Math.max(te, L / R);
  return {
    cols, rows,
    notes: ['L di/dt = V - Ri - kω;  J dω/dt = ki - bω - τL (SI: torque constant = back-emf constant)'],
    checks: [
      { l: 'steady speed (kV-RτL)/(k²+Rb)', exp: wss, act: last[2], u: 'rad/s', tol: 1e-4, ref: !settled },
      { l: 'steady current', exp: iss, act: last[1], u: 'A', tol: 1e-4, ref: !settled },
      { l: 'energy balance', exp: last[8], act: last[9], u: 'J', tol: 1e-4 },
    ],
    scalars: [
      { l: 'no-load speed V/k', v: V / k, u: 'rad/s' }, { l: 'stall torque kV/R', v: (k * V) / R, u: 'N m' }, { l: 'steady speed', v: wss, u: 'rad/s' },
      { l: 'steady rpm', v: (wss * 60) / (2 * Math.PI), u: 'rpm' }, { l: 'steady efficiency', v: (tl * wss) / (V * iss) }, { l: 'mech. time constant', v: te, u: 's' }, { l: 'elec. time constant L/R', v: L / R, u: 's' },
    ],
    charts: [chart(cols, rows, 'w', 'speed', 't', ['omega'], { yl: 'rad/s' }), chart(cols, rows, 'i', 'current & torque', 't', ['i', 'torque']), chart(cols, rows, 'p', 'power', 't', ['P_in', 'P_out'], { yl: 'W' })],
    draw(G, i) {
      const r = rows[i];
      const th = tr.t[i] ? cumAngle(tr.t, ws, i) : 0;
      G.view(-1.5, 1.5, -1.2, 1.2);
      G.rect(-1.3, -1, 0.4, 2, COL.d); G.rect(0.9, -1, 0.4, 2, COL.a);
      G.text('N', -1.18, -0.1, COL.fg); G.text('S', 1.02, -0.1, COL.fg);
      G.circle(0, 0, 0.7, COL.dim);
      G.line(-0.7 * Math.cos(th), -0.7 * Math.sin(th), 0.7 * Math.cos(th), 0.7 * Math.sin(th), COL.b, 3);
      G.hud([`t=${r[0].toFixed(4)} s  ${r[3].toFixed(1)} rpm  i=${r[1].toFixed(3)} A  η=${(r[7] * 100).toFixed(1)}%`]);
    },
  };
}

function cumAngle(t: number[], w: number[], i: number) {
  let a = 0;
  for (let j = 1; j <= i; j++) a += 0.5 * (w[j] + w[j - 1]) * (t[j] - t[j - 1]);
  return a;
}

function generator(p: Params, s: Settings): Result {
  const N = Math.max(1, Math.round(num(p, 'N'))), B = num(p, 'B'), A = num(p, 'Ac') / 1e4, w = (num(p, 'rpm') * 2 * Math.PI) / 60, R = num(p, 'R'), L = num(p, 'Lm') * 1e-3;
  const E0 = N * B * A * w;
  const emf = (t: number) => E0 * Math.sin(w * t);
  const tr = integrate((t, y) => [(emf(t) - R * y[0]) / L], [0], s);
  const Z = Math.hypot(R, w * L), phi = Math.atan2(w * L, R), I0 = E0 / Z;
  // exact including transient
  const iA = (t: number) => I0 * Math.sin(w * t - phi) + I0 * Math.sin(phi) * Math.exp((-R * t) / L);
  const ts = tr.t, is = tr.y.map((y) => y[0]);
  const Wm = cumtrapz(ts, ts.map((t, j) => emf(t) * is[j])), Q = cumtrapz(ts, is.map((i) => i * i * R));
  const cols = ['t', 'emf', 'i', 'i exact', 'V_load', 'P_elec', 'torque', 'W_mech', 'heat + ½Li²'];
  const rows = ts.map((t, j) => {
    const i = is[j];
    return [t, emf(t), i, iA(t), i * R, i * i * R, (emf(t) * i) / w, Wm[j], Q[j] + 0.5 * L * i * i];
  });
  const last = rows[rows.length - 1];
  return {
    cols, rows,
    notes: ['coil rotating in uniform B: emf = NBAω sin ωt; load R in series with coil inductance L; torque = emf·i/ω'],
    checks: [
      { l: 'max |i - exact|', exp: 0, act: maxOf(rows.map((r) => Math.abs(r[2] - r[3]))), u: 'A', abs: 1e-6 * I0 },
      { l: 'mech work = heat + magnetic energy', exp: last[7], act: last[8], u: 'J', tol: 1e-4, abs: 1e-9 },
    ],
    scalars: [{ l: 'peak emf NBAω', v: E0, u: 'V' }, { l: 'frequency', v: w / (2 * Math.PI), u: 'Hz' }, { l: 'peak current', v: I0, u: 'A' }, { l: 'phase lag', v: (phi * 180) / Math.PI, u: 'deg' }, { l: 'avg power ½I0²R', v: 0.5 * I0 * I0 * R, u: 'W' }, { l: 'avg torque', v: (0.5 * I0 * I0 * R) / w, u: 'N m' }],
    charts: [chart(cols, rows, 'ei', 'emf & current', 't', ['emf', 'i', 'i exact']), chart(cols, rows, 'p', 'power & torque', 't', ['P_elec', 'torque'])],
    draw(G, i) {
      const t = rows[i][0];
      G.view(-1.5, 1.5, -1.2, 1.2);
      for (let k = -4; k <= 4; k++) G.arrow(-1.4, k * 0.25, 260, 0, COL.grid);
      const a = w * t;
      G.line(-0.8 * Math.cos(a), -0.8 * Math.sin(a) * 0.3, 0.8 * Math.cos(a), 0.8 * Math.sin(a) * 0.3, COL.b, 3);
      G.hud([`t=${t.toExponential(3)} s  emf=${rows[i][1].toFixed(3)} V  i=${rows[i][2].toFixed(4)} A`]);
    },
  };
}
