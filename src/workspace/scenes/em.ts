// Charges, one plane: every charge pulls or pushes every other one (Coulomb), all inside the same uniform
// magnetic and electric fields. Anchored charges stay put. Drag from a charge to throw it. Two size regimes:
// charged balls (µC, grams, metres, seconds) or particles (elementary charges, electron masses, mm, ns).
import type { Catalog } from '../catalog';
import { step } from '../../core/num';
import { n, str, emptyScene, tchart, every, energyCheck, spriteC, label, COL, SCENE_W, SCENE_H, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const KE = 8.9875517923e9, QE = 1.602176634e-19, ME = 9.1093837015e-31;
const UNITS = ['charged balls', 'particles'];
const U = (u: string) => (u === 'particles' ? { q: QE, m: ME, L: 1e-3, T: 1e-9, qs: 'e', ms: 'mₑ', Ls: 'mm', Ts: 'ns', vs: 'mm/ns' } : { q: 1e-6, m: 1e-3, L: 1, T: 1, qs: 'µC', ms: 'g', Ls: 'm', Ts: 's', vs: 'm/s' });

/** fixed output steps, each split into as many sub-steps as the fastest / most accelerated charge needs */
function simulateAdaptive(f: (t: number, y: number[]) => number[], y0: number[], s: Settings, N: number, soft: number, rec: (t: number, y: number[]) => void) {
  let y = y0, t = 0;
  rec(0, y);
  const ev = every(s.steps);
  for (let k = 1; k <= s.steps; k++) {
    const d = f(t, y);
    let vmax = 0, amax = 0;
    for (let i = 0; i < N; i++) { vmax = Math.max(vmax, Math.hypot(y[2 * N + 2 * i], y[2 * N + 2 * i + 1])); amax = Math.max(amax, Math.hypot(d[2 * N + 2 * i], d[2 * N + 2 * i + 1])); }
    const h = Math.min(s.dt, (0.02 * soft) / Math.max(vmax, 1e-300), 0.05 * Math.sqrt(soft / Math.max(amax, 1e-300)));
    const ns = Math.min(2000, Math.max(1, Math.ceil(s.dt / h)));
    for (let j = 0; j < ns; j++) { y = step(f, t, y, s.dt / ns, s.method, 2 * N); t += s.dt / ns; }
    t = k * s.dt;
    if (k % ev === 0 || k === s.steps) rec(t, y);
  }
  return y;
}

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const u = U(str(p.units, UNITS[0])), scale = n(p.ws_scale, 0.02) * u.L, B = n(p.B, 0), Ex = n(p.Ex, 0), Ey = n(p.Ey, 0);
  const cs = ents.filter((e) => e.kind === 'charge');
  if (!cs.length) return emptyScene('no charges: press E and add some');
  const N = cs.length;
  const q = cs.map((e) => n(e.v.q, 1) * u.q), m = cs.map((e) => Math.max(1e-40, n(e.v.m, 1) * u.m)), fixed = cs.map((e) => str(e.v.fixed, 'no') === 'yes');
  const soft = 0.5 * scale; // softening length: charges closer than this stop speeding up (no singular collisions)
  const x0 = cs.map((e) => [e.x * scale, (SCENE_H - e.y) * scale]);
  const dt = s.dt * u.T, st = { ...s, dt };
  // state: x, y per charge, then vx, vy, then work done by the uniform E field
  const f = (_t: number, y: number[]) => {
    const d = new Array(4 * N + 1).fill(0);
    let wE = 0;
    for (let i = 0; i < N; i++) {
      if (fixed[i]) continue;
      const vx = y[2 * N + 2 * i], vy = y[2 * N + 2 * i + 1];
      d[2 * i] = vx; d[2 * i + 1] = vy;
      let fx = q[i] * (Ex + vy * B), fy = q[i] * (Ey - vx * B);
      wE += q[i] * (Ex * vx + Ey * vy);
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const dx = y[2 * i] - y[2 * j], dy = y[2 * i + 1] - y[2 * j + 1], r2 = dx * dx + dy * dy + soft * soft, k = (KE * q[i] * q[j]) / (r2 * Math.sqrt(r2));
        fx += k * dx; fy += k * dy;
      }
      d[2 * N + 2 * i] = fx / m[i]; d[2 * N + 2 * i + 1] = fy / m[i];
    }
    d[4 * N] = wE;
    return d;
  };
  const energy = (y: number[]) => {
    let K = 0, P = 0;
    for (let i = 0; i < N; i++) {
      K += 0.5 * m[i] * (y[2 * N + 2 * i] ** 2 + y[2 * N + 2 * i + 1] ** 2);
      for (let j = i + 1; j < N; j++) P += (KE * q[i] * q[j]) / Math.sqrt((y[2 * i] - y[2 * j]) ** 2 + (y[2 * i + 1] - y[2 * j + 1]) ** 2 + soft * soft);
    }
    return { K, P };
  };
  const y0 = [...x0.flat(), ...cs.flatMap((e, i) => (fixed[i] ? [0, 0] : [n(e.v.vx, 0) * (u.L / u.T), n(e.v.vy, 0) * (u.L / u.T)])), 0];
  const cols = ['t', ...cs.flatMap((e) => [`${e.name} x (${u.Ls})`, `${e.name} y (${u.Ls})`, `${e.name} speed (${u.vs})`]), 'kinetic (J)', 'electric PE (J)', 'work by E field (J)'];
  const rows: number[][] = [];
  // close encounters: split a step into sub-steps so no charge moves more than a fraction of the softening length
  const yE = simulateAdaptive(f, y0, st, N, soft, (t, y) => { const e = energy(y); rows.push([t / u.T, ...cs.flatMap((_, i) => [y[2 * i] / u.L, y[2 * i + 1] / u.L, Math.hypot(y[2 * N + 2 * i], y[2 * N + 2 * i + 1]) / (u.L / u.T)]), e.K, e.P, y[4 * N]]); });
  const e0 = energy(y0), e1 = energy(yE), Es = Math.max(e0.K + Math.abs(e0.P), e1.K, Math.abs(yE[4 * N]), 1e-300);
  const checks: Check[] = [energyCheck('energy: KE + PE − work by E field = start', e0.K + e0.P, e1.K + e1.P - yE[4 * N], Es, s.method, 1e-6)];
  if (!fixed.some(Boolean) && Ex === 0 && Ey === 0) {
    const mom = (y: number[], c: 0 | 1) => cs.reduce((a, _, i) => a + m[i] * y[2 * N + 2 * i + c] + (c === 0 ? -q[i] * B * y[2 * i + 1] : q[i] * B * y[2 * i]), 0);
    const ps = Math.max(1e-300, ...cs.map((_, i) => Math.sqrt(2 * m[i] * Es) + Math.abs(q[i] * B) * SCENE_W * scale));
    checks.push({ l: `canonical momentum x conserved (m vx${B ? ' − qBy' : ''})`, exp: mom(y0, 0), act: mom(yE, 0), u: 'kg m/s', abs: 1e-7 * ps, ref: s.method !== 'rk4' });
  }
  if (N === 1 && !fixed[0] && B !== 0 && Ex === 0 && Ey === 0) {
    const v = Math.hypot(y0[2], y0[3]), r = (m[0] * v) / Math.abs(q[0] * B);
    // exact gyration centre from the start state: x + m vy/(qB), y − m vx/(qB)
    const cx = (y0[0] + (m[0] * y0[3]) / (q[0] * B)) / u.L, cy = (y0[1] - (m[0] * y0[2]) / (q[0] * B)) / u.L;
    checks.push({ l: 'speed constant in a pure magnetic field', exp: v / (u.L / u.T), act: rows[rows.length - 1][3], u: u.vs, tol: 1e-6, ref: s.method !== 'rk4' });
    checks.push({ l: 'cyclotron radius m v / |q B|', exp: r / u.L, act: Math.max(...rows.map((rw) => Math.hypot(rw[1] - cx, rw[2] - cy))), u: u.Ls, tol: 1e-5, ref: s.method !== 'rk4' });
  }
  const W = SCENE_W * scale / u.L, H = SCENE_H * scale / u.L;
  return {
    cols, rows, checks,
    notes: [`units: charge in ${u.qs}, mass in ${u.ms}, distance in ${u.Ls}, time in ${u.Ts} · Coulomb force softened within ${(soft / u.L).toPrecision(2)} ${u.Ls} · B points out of the screen`],
    scalars: [{ l: 'charges', v: N }, { l: 'start kinetic energy', v: e0.K, u: 'J' }, { l: 'start electric PE', v: e0.P, u: 'J' }, ...cs.map((e, i) => ({ l: `${e.name}: cyclotron period 2πm/|qB|`, v: B ? (2 * Math.PI * m[i]) / Math.abs(q[i] * B) / u.T : Infinity, u: u.Ts }))],
    charts: [
      { id: 'path', title: 'paths', xl: `x (${u.Ls})`, yl: `y (${u.Ls})`, equal: true, series: cs.map((e, i) => ({ name: e.name, x: rows.map((r) => r[1 + 3 * i]), y: rows.map((r) => r[2 + 3 * i]) })) },
      tchart(cols, rows, 'E', 'energy', ['kinetic (J)', 'electric PE (J)', 'work by E field (J)'], 'J'),
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(0, W, 0, H, 14);
      // field arrows / B markers on a coarse grid
      for (let gx = 4; gx < SCENE_W; gx += 8) for (let gy = 4; gy < SCENE_H; gy += 8) {
        const X = (gx * scale) / u.L, Y = ((SCENE_H - gy) * scale) / u.L;
        if (B) G.textPx(B > 0 ? '·' : '×', G.X(X) - 2, G.Y(Y) + 4, '#2b3036');
        if (Ex || Ey) { const L = Math.hypot(Ex, Ey), sc = (2 * scale) / u.L / L; G.line(X, Y, X + Ex * sc, Y + Ey * sc, '#3a3f47'); }
      }
      cs.forEach((e, i) => {
        const tr = rows.slice(Math.max(0, k - 300), k + 1);
        G.path(tr.map((r) => r[1 + 3 * i]), tr.map((r) => r[2 + 3 * i]), q[i] > 0 ? '#ff6b6b' : '#7fd1ff');
        const x = rw[1 + 3 * i], y = rw[2 + 3 * i];
        G.circle(x, y, 6, q[i] > 0 ? COL.d : COL.a, true, true);
        G.textPx(q[i] > 0 ? '+' : '−', G.X(x) - 3, G.Y(y) + 4, COL.bg);
        if (fixed[i]) G.circle(x, y, 9, COL.dim, false, true);
        label(G, e.name, x, y, COL.dim, -10);
        void spriteC;
      });
      G.hud([`t=${rw[0].toPrecision(4)} ${u.Ts}  ${N} charge${N > 1 ? 's' : ''}  B=${B} T  E=(${Ex}, ${Ey}) V/m`, `KE ${rw[cols.indexOf('kinetic (J)')].toExponential(4)} J · PE ${rw[cols.indexOf('electric PE (J)')].toExponential(4)} J`]);
    },
  };
}

export const emScene: Catalog = {
  env: [], engine: 'scene', run,
  desc: 'charges that push and pull on each other (Coulomb) inside uniform magnetic and electric fields',
  settings: { dt: 0.0005, steps: 6000, method: 'rk4' }, timeBased: true,
  envDefs: [
    { k: 'B', l: 'magnetic field B (out of screen)', u: 'T', v: 0, s: 0.01, d: 'Uniform field everywhere: bends moving charges into circles.' },
    { k: 'Ex', l: 'electric field x', u: 'V/m', v: 0, s: 100, d: 'Uniform electric field, x part.' },
    { k: 'Ey', l: 'electric field y', u: 'V/m', v: 0, s: 100, d: 'Uniform electric field, y part.' },
  ],
  globals: [
    { k: 'units', l: 'size regime', v: UNITS[0], o: UNITS, d: 'charged balls: µC, grams, metres, seconds · particles: elementary charges, electron masses, mm, ns (timestep is then in ns).' },
    { k: 'ws_scale', l: 'scene: distance per cell', u: 'm or mm', v: 0.02, min: 1e-9, s: 0.005, d: 'One editor cell, in metres (balls) or mm (particles).' },
  ],
  where: 'charges sit where you put them · drag from one to throw it (arrow = velocity) · anchored charges never move',
  kinds: [
    { kind: 'charge', name: 'charge', sprite: 'electron', desc: 'a charged object', aim: { kind: 'vel', fx: 'vx', fy: 'vy', per: 0.05 }, custom: [
      { k: 'q', l: 'charge', u: 'µC or e', v: 0.1, s: 0.05, d: 'Charge (µC for balls, elementary charges for particles); sign decides attract / repel.' },
      { k: 'm', l: 'mass', u: 'g or mₑ', v: 1, min: 1e-12, s: 0.1, d: 'Mass (grams for balls, electron masses for particles: proton = 1836).' },
      { k: 'vx', l: 'start velocity x', u: 'm/s or mm/ns', v: 0, s: 0.05, d: 'Throw it: drag from the charge in EDIT.' },
      { k: 'vy', l: 'start velocity y', u: 'm/s or mm/ns', v: 0, s: 0.05, d: 'Vertical part of the throw.' },
      { k: 'fixed', l: 'anchored', v: 'no', o: ['no', 'yes'], d: 'An anchored charge pushes and pulls but never moves.' },
    ] },
  ],
  presets: [
    { name: 'charged pith ball (+)', kind: 'charge', sprite: 'pithball', desc: '+0.1 µC, 1 g', v: { q: 0.1, m: 1 } },
    { name: 'charged pith ball (−)', kind: 'charge', sprite: 'pithball', desc: '−0.1 µC, 1 g', v: { q: -0.1, m: 1 } },
    { name: 'Van de Graaff dome', kind: 'charge', sprite: 'dome', desc: 'anchored +2 µC', v: { q: 2, m: 1000, fixed: 'yes' } },
    { name: 'electron', kind: 'charge', sprite: 'electron', desc: 'particles regime: e⁻ at 1 mm/ns', v: { q: -1, m: 1, vx: 1, vy: 0 } },
    { name: 'proton', kind: 'charge', sprite: 'electron', desc: 'particles regime: p⁺', v: { q: 1, m: 1836.15, vx: 0.01, vy: 0 } },
  ],
  start: [['charged pith ball (+)', 24, 18, { vy: 0.3 }], ['charged pith ball (−)', 40, 18, { vy: -0.3 }]],
  tests: [
    { name: 'electron in a magnet (particles)', list: [['electron', 32, 18]], p: { units: 'particles', ws_scale: 0.05, B: 0.01 } },
    { name: 'ball orbiting a dome', list: [['Van de Graaff dome', 32, 18], ['charged pith ball (−)', 32, 8, { vx: 1.2 }]] },
    { name: 'three balls in a field', list: [['charge', 20, 18], ['charge', 30, 12, { q: -0.1 }], ['charge', 40, 22]], p: { Ey: -20000 } },
  ],
};
