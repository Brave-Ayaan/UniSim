// Kinetics, one bench: each flask runs its own reaction at its own temperature (Arrhenius). Exothermic
// reactions warm their flask; flasks standing next to each other share heat, so one hot reaction can speed up
// its neighbours. Hot plates and ice baths under a flask hold it towards their temperature; the room takes heat
// from everything.
import type { Catalog } from '../catalog';
import { RGAS } from '../../core/num';
import { n, str, emptyScene, tchart, simulate, energyCheck, spriteC, label, heatCol, COL, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const TYPES = ['A → P', 'A ⇌ B', 'A → B → C'];

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const Troom = n(p.Troom, 25) + 273.15, Gc = n(p.Gc, 0.5), reach = 4;
  const fl = ents.filter((e) => e.kind === 'flask');
  if (!fl.length) return emptyScene('no flasks: press E and add one');
  const F = fl.map((e) => {
    const V = Math.max(1e-6, n(e.v.V, 0.5));
    return { e, type: str(e.v.type, 'A → P'), order: n(e.v.order, 1), A0: n(e.v.A0, 1), V, Af: n(e.v.Af, 1e10), Ea: n(e.v.Ea, 75) * 1000, dH: n(e.v.dH, -50) * 1000, K298: Math.max(1e-30, n(e.v.K, 1)), Af2: n(e.v.Af2, 1e8), Ea2: n(e.v.Ea2, 60) * 1000, Cp: V * 4180, hA: n(e.v.hA, 1), T0: n(e.v.T0, 25) + 273.15 };
  });
  const N = F.length;
  const baths = ents.filter((e) => e.kind === 'bath').map((e) => {
    let bi = -1, bd = reach;
    fl.forEach((f, i) => { const d = Math.hypot(f.x - e.x, f.y - e.y); if (d <= bd) { bd = d; bi = i; } });
    return { e, i: bi, T: n(e.v.T, 80) + 273.15, G: n(e.v.G, 5) };
  });
  const pairs: [number, number][] = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (Math.hypot(fl[i].x - fl[j].x, fl[i].y - fl[j].y) <= reach) pairs.push([i, j]);
  const kOf = (Af: number, Ea: number, T: number) => Af * Math.exp(-Ea / (RGAS * T));
  // state per flask: A, B, C (mol/L), T (K); then heat in from baths, heat out to the room
  const rates = (q: (typeof F)[number], A: number, B: number, T: number) => {
    const k = kOf(q.Af, q.Ea, T);
    if (q.type === 'A ⇌ B') { const K = q.K298 * Math.exp((-q.dH / RGAS) * (1 / T - 1 / 298.15)); return [k * A - (k / K) * B, 0]; }
    if (q.type === 'A → B → C') return [k * Math.max(0, A), kOf(q.Af2, q.Ea2, T) * Math.max(0, B)];
    const Ap = Math.max(0, A);
    return [q.order === 0 ? k * (Ap / (Ap + 1e-9)) : k * Ap ** q.order, 0];
  };
  const f = (_t: number, y: number[]) => {
    const d = new Array(4 * N + 2).fill(0);
    F.forEach((q, i) => {
      const [A, B, , T] = y.slice(4 * i, 4 * i + 4), [r1, r2] = rates(q, A, B, T);
      d[4 * i] = -r1; d[4 * i + 1] = r1 - r2; d[4 * i + 2] = r2;
      const loss = q.hA * (T - Troom);
      d[4 * i + 3] += (-q.dH * r1 * q.V - q.dH * r2 * q.V - loss) / q.Cp;
      d[4 * N + 1] += loss;
    });
    for (const [i, j] of pairs) { const Q = Gc * (y[4 * j + 3] - y[4 * i + 3]); d[4 * i + 3] += Q / F[i].Cp; d[4 * j + 3] -= Q / F[j].Cp; }
    for (const b of baths) if (b.i >= 0) { const Q = b.G * (b.T - y[4 * b.i + 3]); d[4 * b.i + 3] += Q / F[b.i].Cp; d[4 * N] += Q; }
    return d;
  };
  // heat content + chemical enthalpy: Cp T + ΔH × (moles reacted per step)
  const H = (y: number[]) => F.reduce((a, q, i) => a + q.Cp * y[4 * i + 3] + q.dH * q.V * (q.A0 - y[4 * i]) + (q.type === 'A → B → C' ? q.dH * q.V * y[4 * i + 2] : 0), 0);
  const y0 = [...F.flatMap((q) => [q.A0, 0, 0, q.T0]), 0, 0];
  const cols = ['t', ...F.flatMap((q) => [`${q.e.name} [A] (mol/L)`, `${q.e.name} [B] (mol/L)`, `${q.e.name} [C] (mol/L)`, `${q.e.name} T (°C)`]), 'heat in from plates (J)', 'heat lost to room (J)'];
  const rows: number[][] = [];
  const yE = simulate(f, y0, s, (t, y) => rows.push([t, ...F.flatMap((_, i) => [y[4 * i], y[4 * i + 1], y[4 * i + 2], y[4 * i + 3] - 273.15]), y[4 * N], y[4 * N + 1]]));
  const H0 = H(y0);
  const checks: Check[] = [energyCheck('energy: heat + chemical enthalpy − plates + room losses = start', H0, H(yE) - yE[4 * N] + yE[4 * N + 1], F.reduce((a, q) => a + q.Cp * 10 + Math.abs(q.dH * q.V * q.A0), 0), s.method, 1e-8)];
  if (N === 1 && !baths.some((b) => b.i >= 0)) {
    const q = F[0], iso = q.dH === 0 && q.T0 === Troom;
    if (iso) {
      const t = rows[rows.length - 1][0], k = kOf(q.Af, q.Ea, q.T0), A0 = q.A0, last = rows[rows.length - 1];
      let exp: number, act = last[1], l: string;
      if (q.type === 'A ⇌ B') { const kb = k / q.K298, Aeq = (kb * A0) / (k + kb); exp = Aeq + (A0 - Aeq) * Math.exp(-(k + kb) * t); l = '[A] → equilibrium: Aeq + (A₀ − Aeq)e^(−(kf+kb)t)'; }
      else if (q.type === 'A → B → C') { const k2 = kOf(q.Af2, q.Ea2, q.T0); exp = Math.abs(k2 - k) > 1e-12 ? ((A0 * k) / (k2 - k)) * (Math.exp(-k * t) - Math.exp(-k2 * t)) : A0 * k * t * Math.exp(-k * t); act = last[2]; l = '[B] = A₀k₁/(k₂−k₁)(e^(−k₁t) − e^(−k₂t))'; }
      else if (q.order === 0) { exp = Math.max(0, A0 - k * t); l = '[A] = A₀ − kt (zero order)'; }
      else if (q.order === 2) { exp = A0 / (1 + k * A0 * t); l = '[A] = A₀/(1 + kA₀t) (second order)'; }
      else { exp = A0 * Math.exp(-k * t); l = '[A] = A₀e^(−kt) (first order)'; }
      checks.push({ l: `isothermal ${l}`, exp, act, u: 'mol/L', tol: 1e-6, abs: q.order === 0 ? 1e-6 * A0 : undefined, ref: q.order === 0 && exp < 1e-3 * A0 });
    }
  }
  const half = F.map((_, i) => { const A0 = rows[0][1 + 4 * i], r = rows.find((rw) => rw[1 + 4 * i] <= A0 / 2); return r ? r[0] : NaN; });
  const Tmax = F.map((_, i) => Math.max(...rows.map((r) => r[4 + 4 * i])));
  return {
    cols, rows, checks,
    notes: [`flasks within ${reach} cells of each other share heat; a hot plate or ice bath acts on the flask it is under`, ...F.filter((_, i) => Tmax[i] > 100).map((q) => `${q.e.name} passes 100 °C — boiling is not modelled`)],
    scalars: F.flatMap((q, i) => [{ l: `${q.e.name}: half-life of A`, v: half[i], u: 's' }, { l: `${q.e.name}: hottest`, v: Tmax[i], u: '°C' }, { l: `${q.e.name}: conversion`, v: 100 * (1 - rows[rows.length - 1][1 + 4 * i] / Math.max(1e-30, q.A0)), u: '%' }]),
    charts: [
      tchart(cols, rows, 'A', 'reactant A', F.map((q) => `${q.e.name} [A] (mol/L)`), 'mol/L'),
      tchart(cols, rows, 'T', 'temperatures', F.map((q) => `${q.e.name} T (°C)`), '°C'),
      tchart(cols, rows, 'B', 'products B and C', F.flatMap((q) => (q.type === 'A → P' ? [] : [`${q.e.name} [B] (mol/L)`, `${q.e.name} [C] (mol/L)`])), 'mol/L'),
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(0, SCENE_W, -36, 0, 14);
      const Tlo = Math.min(Troom, ...F.map((q) => q.T0), ...baths.map((b) => b.T)) - 273.15, Thi = Math.max(Tlo + 1, ...Tmax, ...baths.map((b) => b.T - 273.15));
      for (const [i, j] of pairs) G.line(fl[i].x, -fl[i].y, fl[j].x, -fl[j].y, '#3a3f47', 3);
      for (const b of baths) { spriteC(G, b.e.sprite, b.e.x, -b.e.y, 3); if (b.i >= 0) G.line(b.e.x, -b.e.y, fl[b.i].x, -fl[b.i].y, b.T > Troom ? COL.d : COL.c, 1, [2, 3]); }
      F.forEach((q, i) => {
        const T = rw[4 + 4 * i], A = rw[1 + 4 * i];
        G.circle(q.e.x, -q.e.y, 2.6, heatCol((T - Tlo) / (Thi - Tlo)), true);
        spriteC(G, q.e.sprite, q.e.x, -q.e.y, 3);
        G.rect(q.e.x + 2.8, -q.e.y - 2, 0.6, 4 * Math.min(1, A / Math.max(1e-30, q.A0)), COL.e, true);
        label(G, `${q.e.name} ${T.toFixed(1)} °C  [A] ${A.toPrecision(3)}`, q.e.x - 3, -q.e.y + 3.5, COL.dim, 0);
      });
      G.hud([`t=${rw[0].toFixed(0)} s  ${N} flask${N > 1 ? 's' : ''} · ${pairs.length} touching · room ${(Troom - 273.15).toFixed(1)} °C`, 'bar = reactant left · colour = temperature']);
    },
  };
}

export const kineticsScene: Catalog = {
  env: [], engine: 'scene', run,
  desc: 'flasks of reactions on one bench: Arrhenius rates, reaction heat warming neighbours, hot plates and ice baths',
  settings: { dt: 1, steps: 3600, method: 'rk4' }, timeBased: true,
  envDefs: [{ k: 'Troom', l: 'room temperature', u: '°C', v: 25, s: 1, d: 'Air temperature around the bench.' }],
  globals: [{ k: 'Gc', l: 'flask-to-flask heat contact', u: 'W/K', v: 0.5, min: 0, s: 0.1, d: 'How well two touching flasks share heat (flasks within 4 cells touch).' }],
  where: 'flasks within 4 cells of each other touch and share heat · a hot plate or ice bath acts on the nearest flask',
  kinds: [
    { kind: 'flask', name: 'flask', sprite: 'flask', desc: 'a reaction vessel', custom: [
      { k: 'type', l: 'reaction', v: 'A → P', o: TYPES, d: 'A → P, reversible A ⇌ B, or two steps A → B → C.' },
      { k: 'order', l: 'order in A', v: '1', o: ['0', '1', '2'], d: 'Rate = k[A]^order (for A → P).', when: (q) => str(q.type, 'A → P') === 'A → P' },
      { k: 'A0', l: 'start [A]', u: 'mol/L', v: 1, min: 0, s: 0.1, d: 'Starting concentration of A.' },
      { k: 'V', l: 'volume', u: 'L', v: 0.5, min: 1e-6, s: 0.1, d: 'Liquid volume (heat capacity ≈ water).' },
      { k: 'T0', l: 'start temperature', u: '°C', v: 25, s: 1, d: 'Temperature at the start.' },
      { k: 'Af', l: 'pre-exponential A', u: '1/s', v: 1e10, min: 0, s: 1e9, d: 'Arrhenius prefactor: k = A e^(−Ea/RT).' },
      { k: 'Ea', l: 'activation energy', u: 'kJ/mol', v: 75, min: 0, s: 5, d: 'Higher = more sensitive to temperature.' },
      { k: 'dH', l: 'reaction enthalpy ΔH', u: 'kJ/mol', v: -50, s: 10, d: 'Negative = exothermic (gives out heat).' },
      { k: 'K', l: 'equilibrium constant at 25 °C', v: 1, min: 1e-12, s: 0.5, d: '[B]/[A] at equilibrium (shifts with temperature by ΔH).', when: (q) => str(q.type, 'A → P') === 'A ⇌ B' },
      { k: 'Af2', l: 'step 2 prefactor', u: '1/s', v: 1e8, min: 0, s: 1e7, d: 'Arrhenius prefactor of B → C.', when: (q) => str(q.type, 'A → P') === 'A → B → C' },
      { k: 'Ea2', l: 'step 2 activation energy', u: 'kJ/mol', v: 60, min: 0, s: 5, d: 'Activation energy of B → C.', when: (q) => str(q.type, 'A → P') === 'A → B → C' },
      { k: 'hA', l: 'heat loss to the room', u: 'W/K', v: 1, min: 0, s: 0.2, d: 'Insulated flask ≈ 0.1, open beaker ≈ 2.' },
    ] },
    { kind: 'bath', name: 'hot plate / ice bath', sprite: 'hotplate', desc: 'holds the flask above it towards a temperature', custom: [
      { k: 'T', l: 'set temperature', u: '°C', v: 80, s: 5, d: 'Hot plate (above room) or ice bath (below).' },
      { k: 'G', l: 'heat transfer', u: 'W/K', v: 5, min: 0, s: 1, d: 'How strongly it pulls the flask to its temperature.' },
    ] },
  ],
  presets: [
    { name: 'hydrogen peroxide (warm)', kind: 'flask', sprite: 'flask', desc: '1st order, starts at 57 °C', v: { type: 'A → P', order: 1, A0: 1, Af: 1e10, Ea: 75, dH: -98, T0: 57 } },
    { name: 'cold storage', kind: 'flask', sprite: 'tube', desc: 'same reaction at 5 °C', v: { type: 'A → P', order: 1, A0: 1, Af: 1e10, Ea: 75, dH: -98, T0: 5 } },
    { name: 'runaway batch', kind: 'flask', sprite: 'flask', desc: 'strongly exothermic, insulated', v: { type: 'A → P', order: 1, A0: 2, Af: 1e13, Ea: 100, dH: -150, T0: 40, hA: 0.1 } },
    { name: 'isomerisation', kind: 'flask', sprite: 'tube', desc: 'A ⇌ B, K = 3', v: { type: 'A ⇌ B', A0: 1, Af: 1e9, Ea: 70, dH: -20, K: 3, T0: 25 } },
    { name: 'drug metabolism', kind: 'flask', sprite: 'tube', desc: 'A → B → C', v: { type: 'A → B → C', A0: 1, Af: 1e9, Ea: 65, Af2: 1e8, Ea2: 62, dH: 0, T0: 37, hA: 0 } },
    { name: 'ice bath', kind: 'bath', sprite: 'icebath', desc: '0 °C', v: { T: 0, G: 10 } },
  ],
  start: [['runaway batch', 20, 18], ['hydrogen peroxide (warm)', 24, 18, { T0: 25 }], ['cold storage', 44, 18], ['ice bath', 44, 22]],
  tests: [
    { name: 'isothermal first order', list: [['flask', 32, 18, { dH: 0 }]] },
    { name: 'isothermal second order', list: [['flask', 32, 18, { dH: 0, order: 2, Af: 1e11 }]] },
    { name: 'isothermal zero order', list: [['flask', 32, 18, { dH: 0, order: 0, A0: 5, Af: 1e10 }]] },
    { name: 'isothermal equilibrium', list: [['isomerisation', 32, 18, { dH: 0 }]] },
    { name: 'isothermal two steps', list: [['drug metabolism', 32, 18, { T0: 25 }]] },
    { name: 'hot plate chain', list: [['flask', 20, 18], ['flask', 24, 18], ['flask', 28, 18], ['bath', 20, 22]] },
  ],
  guide(g, X, Y, _cp, _p, ents) {
    const fls = ents.filter((e) => e.k === 'flask');
    g.strokeStyle = '#3a3f47'; g.lineWidth = 2;
    for (let i = 0; i < fls.length; i++) for (let j = i + 1; j < fls.length; j++) if (Math.hypot(fls[i].x - fls[j].x, fls[i].y - fls[j].y) <= 4) { g.beginPath(); g.moveTo(X(fls[i].x), Y(fls[i].y)); g.lineTo(X(fls[j].x), Y(fls[j].y)); g.stroke(); }
    g.lineWidth = 1;
  },
};
