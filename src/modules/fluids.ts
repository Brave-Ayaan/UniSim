import type { SimModule, Result, Params, Settings } from '../core/types';
import { integrate, G0, trapz, crossings, meanPeriod, fbdAscii, solve, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

export const fluids: SimModule = {
  id: 'fluids',
  name: 'Fluid dynamics',
  desc: 'Bernoulli/venturi, pipe flow (Hagen-Poiseuille FD solve, Colebrook), Torricelli drain, buoyancy',
  timeBased: true,
  settings: { dt: 0.01, steps: 1000, method: 'rk4' },
  modeSettings: { venturi: { steps: 1000 }, 'pipe flow': { steps: 400 }, 'tank drain': { dt: 0.1, steps: 6000 }, buoyancy: { dt: 0.002, steps: 5000 } },
  params: [
    { k: 'mode', l: 'mode', v: 'venturi', o: ['venturi', 'pipe flow', 'tank drain', 'buoyancy'] },
    { k: 'rho', l: 'fluid density', u: 'kg/m3', v: 1000, min: 1e-9, s: 10 },
    { k: 'g', l: 'gravity', u: 'm/s2', v: G0, s: 0.1 },
    { k: 'D1', l: 'inlet diameter', u: 'm', v: 0.1, min: 1e-9, s: 0.01, when: (p) => p.mode === 'venturi' },
    { k: 'D2', l: 'throat diameter', u: 'm', v: 0.05, min: 1e-9, s: 0.005, when: (p) => p.mode === 'venturi' },
    { k: 'Q', l: 'flow rate', u: 'L/s', v: 10, min: 0, s: 1, when: (p) => p.mode === 'venturi' || p.mode === 'pipe flow' },
    { k: 'P1', l: 'inlet pressure (abs)', u: 'kPa', v: 200, s: 10, when: (p) => p.mode === 'venturi' },
    { k: 'dz', l: 'elevation rise', u: 'm', v: 0, s: 0.5, when: (p) => p.mode === 'venturi' },
    { k: 'D', l: 'pipe diameter', u: 'm', v: 0.05, min: 1e-9, s: 0.005, when: (p) => p.mode === 'pipe flow' },
    { k: 'Lp', l: 'pipe length', u: 'm', v: 10, min: 1e-9, s: 1, when: (p) => p.mode === 'pipe flow' },
    { k: 'mu', l: 'viscosity', u: 'Pa s', v: 1.002e-3, min: 1e-12, s: 1e-4, when: (p) => p.mode === 'pipe flow' },
    { k: 'eps', l: 'roughness', u: 'mm', v: 0.045, min: 0, s: 0.005, when: (p) => p.mode === 'pipe flow' },
    { k: 'At', l: 'tank area', u: 'm2', v: 1, min: 1e-9, s: 0.1, when: (p) => p.mode === 'tank drain' },
    { k: 'ao', l: 'orifice area', u: 'cm2', v: 20, min: 1e-9, s: 1, when: (p) => p.mode === 'tank drain' },
    { k: 'Cd', l: 'discharge coeff', v: 0.61, min: 1e-9, max: 1, s: 0.01, when: (p) => p.mode === 'tank drain' },
    { k: 'h0', l: 'initial level', u: 'm', v: 2, min: 0, s: 0.1, when: (p) => p.mode === 'tank drain' },
    { k: 'side', l: 'cube side', u: 'm', v: 0.2, min: 1e-9, s: 0.01, when: (p) => p.mode === 'buoyancy' },
    { k: 'rhoo', l: 'object density', u: 'kg/m3', v: 500, min: 1e-9, s: 50, when: (p) => p.mode === 'buoyancy' },
    { k: 'z0', l: 'initial push down', u: 'm', v: 0.03, s: 0.01, when: (p) => p.mode === 'buoyancy' },
    { k: 'c', l: 'linear damping', u: 'N s/m', v: 0, min: 0, s: 1, when: (p) => p.mode === 'buoyancy' },
  ],
  run(p, s) {
    const m = str(p, 'mode');
    if (m === 'venturi') return venturi(p, s);
    if (m === 'pipe flow') return pipe(p, s);
    if (m === 'tank drain') return tank(p, s);
    return buoy(p, s);
  },
};

function venturi(p: Params, s: Settings): Result {
  const rho = num(p, 'rho'), g = num(p, 'g'), D1 = num(p, 'D1'), D2 = num(p, 'D2'), Q = num(p, 'Q') / 1e3, P1 = num(p, 'P1') * 1e3, dz = num(p, 'dz');
  const n = Math.min(2000, Math.max(10, Math.floor(s.steps)));
  // geometry: inlet 0..0.3, converge 0.3..0.5, throat 0.5..0.6, diffuse 0.6..1.0 (normalised length 1 m)
  const Dx = (x: number) => (x < 0.3 ? D1 : x < 0.5 ? D1 + ((D2 - D1) * (x - 0.3)) / 0.2 : x < 0.6 ? D2 : D2 + ((D1 - D2) * (x - 0.6)) / 0.4);
  const zx = (x: number) => dz * x;
  const v1 = Q / ((Math.PI * D1 * D1) / 4);
  const H = P1 / (rho * g) + (v1 * v1) / (2 * g);
  const cols = ['x', 'D', 'A', 'v', 'P (kPa)', 'z', 'total head'];
  const rows = [...Array(n + 1).keys()].map((k) => {
    const x = k / n, D = Dx(x), A = (Math.PI * D * D) / 4, v = Q / A;
    const P = P1 + 0.5 * rho * (v1 * v1 - v * v) - rho * g * zx(x);
    return [x, D, A, v, P / 1e3, zx(x), P / (rho * g) + (v * v) / (2 * g) + zx(x)];
  });
  const A1 = (Math.PI * D1 * D1) / 4, A2 = (Math.PI * D2 * D2) / 4, v2 = Q / A2;
  const P2 = P1 + 0.5 * rho * (v1 * v1 - v2 * v2) - rho * g * zx(0.55);
  const dP = P1 - P2 - rho * g * zx(0.55);
  const Qm = A2 * Math.sqrt((2 * dP) / (rho * (1 - (A2 / A1) ** 2)));
  return {
    cols, rows,
    notes: ['steady incompressible inviscid flow along a streamline; venturi meter equation recovers Q from measured ΔP'],
    checks: [
      { l: 'continuity A1v1 = A2v2', exp: Q, act: A2 * v2, u: 'm3/s' },
      { l: 'venturi meter Q from ΔP', exp: Q, act: Qm, u: 'm3/s' },
      { l: 'total head constant', exp: H + 0, act: rows[Math.round(n * 0.55)][6], u: 'm' },
    ],
    targets: [{ l: 'no cavitation (P2 > 2.339 kPa)', hit: P2 > 2339, err: P2 / 1e3, u: 'kPa' }],
    scalars: [{ l: 'v1', v: v1, u: 'm/s' }, { l: 'v2 (throat)', v: v2, u: 'm/s' }, { l: 'P2 (throat)', v: P2 / 1e3, u: 'kPa' }, { l: 'ΔP', v: (P1 - P2) / 1e3, u: 'kPa' }, { l: 'mass flow', v: rho * Q, u: 'kg/s' }],
    charts: [
      chart(cols, rows, 'p', 'pressure along pipe', 'x', ['P (kPa)'], { tAxis: false }),
      chart(cols, rows, 'v', 'velocity along pipe', 'x', ['v'], { tAxis: false, yl: 'm/s' }),
    ],
    draw(G, i) {
      G.view(-0.05, 1.05, -D1, D1);
      const xs = rows.map((r) => r[0]);
      G.path(xs, rows.map((r) => r[1] / 2), COL.fg);
      G.path(xs, rows.map((r) => -r[1] / 2), COL.fg);
      const ph = (performance.now() / 1000) % 1;
      for (let lane = -2; lane <= 2; lane++) {
        let x = (ph * 0.05) % 0.05;
        while (x < 1) {
          const D = Dx(x);
          G.circle(x, (lane / 5) * D, 1.5, COL.a, true, true);
          x += 0.012 * (Q / ((Math.PI * D * D) / 4)) / v1;
        }
      }
      const r = rows[i];
      G.line(r[0], -D1 / 2, r[0], D1 / 2, COL.f, 1, [2, 3]);
      G.hud([`x=${r[0].toFixed(3)} v=${r[3].toFixed(3)} m/s P=${r[4].toFixed(3)} kPa`]);
    },
  };
}

function pipe(p: Params, s: Settings): Result {
  const rho = num(p, 'rho'), g = num(p, 'g'), D = num(p, 'D'), L = num(p, 'Lp'), Q = num(p, 'Q') / 1e3, mu = num(p, 'mu'), eps = num(p, 'eps') / 1e3;
  const R = D / 2, A = Math.PI * R * R, V = Q / A, Re = (rho * V * D) / mu;
  const lam = Re < 2300;
  // Colebrook-White by fixed-point iteration
  let f = 0.02;
  for (let i = 0; i < 100; i++) f = (-2 * Math.log10(eps / D / 3.7 + 2.51 / (Re * Math.sqrt(f)))) ** -2;
  const fSJ = 0.25 / Math.log10(eps / D / 3.7 + 5.74 / Re ** 0.9) ** 2;
  const fUse = lam ? 64 / Re : f;
  const dP = (fUse * L * rho * V * V) / (2 * D);
  const dPhp = (128 * mu * L * Q) / (Math.PI * D ** 4);
  // finite-difference solve of (1/r) d/dr (r du/dr) = G/μ, G = dP/dx (<0), u(R)=0, du/dr(0)=0
  const n = Math.min(400, Math.max(10, Math.floor(s.steps)));
  const Gx = -dPhp / L;
  const h = R / n;
  const Amat = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(Gx / mu);
  for (let i = 0; i < n; i++) {
    const r = i * h;
    if (i === 0) { Amat[0][0] = -4 / (h * h); Amat[0][1] = 4 / (h * h); continue; }
    Amat[i][i - 1] = 1 / (h * h) - 1 / (2 * r * h);
    Amat[i][i] = -2 / (h * h);
    if (i + 1 < n) Amat[i][i + 1] = 1 / (h * h) + 1 / (2 * r * h);
  }
  const u = [...solve(Amat, b), 0];
  const rs = [...Array(n + 1).keys()].map((i) => i * h);
  const Qfd = trapz(rs, rs.map((r, i) => 2 * Math.PI * r * u[i]));
  const uA = (r: number) => (lam ? 2 * V * (1 - (r * r) / (R * R)) : ((60 / 49) * V) * Math.max(0, 1 - r / R) ** (1 / 7));
  const cols = ['r', 'u (FD laminar)', lam ? 'u analytic (parabolic)' : 'u (1/7 power law)', 'shear stress'];
  const rows = rs.map((r, i) => [r, u[i], uA(r), (-Gx * r) / 2]);
  return {
    cols, rows,
    notes: [`Re = ${Re.toFixed(1)} → ${lam ? 'laminar' : 'turbulent'}`, 'FD radial solve uses the Hagen-Poiseuille pressure gradient; recovers Q if the solver is correct'],
    checks: [
      { l: 'Q from FD velocity field', exp: Q, act: Qfd, u: 'm3/s', tol: 1e-3 },
      { l: 'centreline u = 2V (laminar FD)', exp: 2 * V, act: u[0], u: 'm/s', tol: 1e-3 },
      ...(lam ? [{ l: 'Darcy f=64/Re ΔP vs Hagen-Poiseuille', exp: dPhp, act: dP, u: 'Pa' }] : [{ l: 'Swamee-Jain vs Colebrook f', exp: f, act: fSJ, tol: 0.02, ref: true }]),
    ],
    scalars: [
      { l: 'mean velocity', v: V, u: 'm/s' }, { l: 'Reynolds', v: Re }, { l: 'friction factor', v: fUse }, { l: 'pressure drop', v: dP / 1e3, u: 'kPa' },
      { l: 'head loss', v: dP / (rho * g), u: 'm' }, { l: 'pumping power', v: dP * Q, u: 'W' }, { l: 'wall shear', v: (fUse * rho * V * V) / 8, u: 'Pa' },
    ],
    charts: [chart(cols, rows, 'prof', 'velocity profile u(r)', 'r', [cols[1], cols[2]], { tAxis: false, yl: 'm/s' })],
    draw(G) {
      G.view(-0.1, 1.1, -0.7, 0.7);
      G.line(0, 0.5, 1, 0.5, COL.fg); G.line(0, -0.5, 1, -0.5, COL.fg);
      const um = Math.max(maxOf(u), maxOf(rs.map(uA)));
      for (let k = -10; k <= 10; k++) {
        const r = Math.abs(k / 20) * D;
        const uu = lam ? 2 * V * (1 - (r * r) / (R * R)) : uA(r);
        G.arrow(0.2, k / 20, (uu / um) * 120, 0, COL.a);
      }
      G.hud([`Re=${Re.toFixed(1)}  f=${fUse.toFixed(5)}  ΔP=${(dP / 1e3).toFixed(3)} kPa`]);
    },
  };
}

function tank(p: Params, s: Settings): Result {
  const g = num(p, 'g'), A = num(p, 'At'), a = num(p, 'ao') / 1e4, Cd = num(p, 'Cd'), h0 = num(p, 'h0');
  const k = ((a * Cd) / A) * Math.sqrt(2 * g);
  const tr = integrate((_t, y) => [y[0] > 0 ? -k * Math.sqrt(y[0]) : 0], [h0], s, { stop: (_t, y) => y[0] <= 1e-12 });
  const hA = (t: number) => Math.max(0, Math.sqrt(h0) - (k / 2) * t) ** 2;
  const tD = (2 * Math.sqrt(h0)) / k;
  const cols = ['t', 'h', 'h analytic', 'v_jet', 'Q_out', 'volume'];
  const rows = tr.t.map((t, i) => {
    const h = Math.max(0, tr.y[i][0]);
    return [t, h, hA(t), Math.sqrt(2 * g * h), Cd * a * Math.sqrt(2 * g * h), A * h];
  });
  const cr = crossings(rows.map((r) => r[0]), rows.map((r) => r[1]), h0 * 0.25, -1)[0];
  const tq = (2 * (Math.sqrt(h0) - Math.sqrt(h0 * 0.25))) / k;
  return {
    cols, rows,
    notes: ['Torricelli: dh/dt = -(Cd a/A)√(2gh); √h singularity at h→0 limits accuracy near empty'],
    checks: [
      { l: 'time to quarter level', exp: tq, act: cr ?? NaN, u: 's' },
      { l: 'max |h error|', exp: 0, act: maxOf(rows.map((r) => Math.abs(r[1] - r[2]))), u: 'm', abs: 1e-4 * h0 },
    ],
    scalars: [{ l: 'drain time (analytic)', v: tD, u: 's' }, { l: 'initial jet speed', v: Math.sqrt(2 * g * h0), u: 'm/s' }, { l: 'initial outflow', v: Cd * a * Math.sqrt(2 * g * h0) * 1e3, u: 'L/s' }],
    charts: [chart(cols, rows, 'h', 'level', 't', ['h', 'h analytic'], { yl: 'm' }), chart(cols, rows, 'q', 'outflow', 't', ['Q_out'], { yl: 'm3/s' })],
    draw(G, i) {
      const r = rows[i];
      G.view(-1, 3, -0.3, h0 * 1.2 + 0.2, 20, false);
      G.line(0, 0, 0, h0 * 1.2, COL.fg); G.line(1, 0, 1, h0 * 1.2, COL.fg); G.line(0, 0, 1, 0, COL.fg);
      G.rect(0, 0, 1, r[1], 'rgba(127,209,255,0.3)', true);
      const v = r[3];
      const xs: number[] = [], ys: number[] = [];
      for (let t = 0; t < 1; t += 0.02) { xs.push(1 + v * t * 0.2); ys.push(0.05 - 0.5 * g * t * t * 0.2); }
      G.path(xs, ys, COL.a);
      G.hud([`t=${r[0].toFixed(3)} s  h=${r[1].toFixed(4)} m  v_jet=${v.toFixed(3)} m/s`]);
    },
  };
}

function buoy(p: Params, s: Settings): Result {
  const rho = num(p, 'rho'), g = num(p, 'g'), a = num(p, 'side'), ro = num(p, 'rhoo'), c = num(p, 'c');
  const m = ro * a ** 3, A = a * a;
  const deq = (a * ro) / rho;
  const sub = (d: number) => Math.max(0, Math.min(a, d));
  // d = depth of the cube bottom below the free surface
  const f = (_t: number, y: number[]) => [y[1], g - (rho * g * A * sub(y[0])) / m - (c * y[1]) / m];
  const tr = integrate(f, [deq + num(p, 'z0'), 0], s, { nq: 1 });
  const cols = ['t', 'depth', 'v', 'a', 'F_buoy', 'weight', 'KE', 'PE'];
  const rows = tr.t.map((t, i) => {
    const [d, v] = tr.y[i];
    const Fb = rho * g * A * sub(d);
    return [t, d, v, g - Fb / m - (c * v) / m, Fb, m * g, 0.5 * m * v * v, 0];
  });
  const T = 2 * Math.PI * Math.sqrt(m / (rho * g * A));
  const Tm = meanPeriod(crossings(rows.map((r) => r[0]), rows.map((r) => r[1] - deq), 0, 1));
  const linear = deq + Math.abs(num(p, 'z0')) <= a && deq - Math.abs(num(p, 'z0')) >= 0;
  const zeta = c / (2 * Math.sqrt(rho * g * A * m));
  const Td = T / Math.sqrt(Math.max(1e-12, 1 - zeta * zeta));
  return {
    cols, rows,
    notes: ro >= rho ? ['object denser than fluid: it sinks'] : linear ? ['hydrostatic restoring force is linear while partially submerged (no added mass)'] : ['oscillation leaves the linear (partially-submerged) range'],
    checks: [
      { l: 'equilibrium depth ρo a/ρf', exp: deq, act: rows[rows.length - 1][1], u: 'm', ref: c === 0 || ro >= rho },
      { l: 'heave period 2π√(m/ρgA)', exp: Td, act: Tm, u: 's', ref: !linear || ro >= rho },
      { l: 'Archimedes: buoyancy at eq = weight', exp: m * g, act: rho * g * A * deq, u: 'N' },
    ],
    scalars: [{ l: 'mass', v: m, u: 'kg' }, { l: 'equilibrium draft', v: deq, u: 'm' }, { l: 'natural period', v: T, u: 's' }, { l: 'damping ratio', v: zeta }, { l: 'reserve buoyancy', v: (rho * a ** 3 - m) * g, u: 'N' }],
    charts: [chart(cols, rows, 'd', 'draft', 't', ['depth'], { yl: 'm' }), chart(cols, rows, 'f', 'forces', 't', ['F_buoy', 'weight'], { yl: 'N' })],
    draw(G, i) {
      const r = rows[i];
      G.view(-2 * a, 2 * a, -1.5 * a, 1.5 * a);
      G.rect(-2 * a, -1.5 * a, 4 * a, 1.5 * a, 'rgba(127,209,255,0.15)', true);
      G.line(-2 * a, 0, 2 * a, 0, COL.a);
      G.rect(-a / 2, -r[1], a, a, COL.b);
      G.arrow(0, -r[1] + a / 2, 0, -25, COL.d, 'W');
      G.arrow(0.1 * a, -r[1] + a / 2, 0, (25 * r[4]) / (m * g), COL.c, 'Fb');
      G.hud([`t=${r[0].toFixed(3)} s  draft=${r[1].toFixed(4)} m`]);
    },
    fbd(i) {
      const r = rows[i];
      return fbdAscii('FBD floating cube', [['weight', 0, -m * g], ['buoyancy', 0, r[4]], ['damping', 0, -c * r[2] * -1]]);
    },
  };
}
