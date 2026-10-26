// Circuits, one loop: components stacked in the same column are wired in parallel, and the columns, left to
// right, are wired in series around one loop. So moving a lamp sideways takes it out of parallel and puts it in
// series. Batteries (DC or AC) drive it; resistors and lamps heat up, capacitors and coils store energy, and
// switches open and close on their own timers. Solved by nodal analysis with trapezoidal steps.
import type { Catalog } from '../catalog';
import { n, str, emptyScene, tchart, sprite, label, COL, SCENE_W, SCENE_H, every, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

type Kind = 'battery' | 'resistor' | 'lamp' | 'cap' | 'ind' | 'switch';
interface Comp { e: Ent; k: Kind; col: number; a: number; b: number; V: number; r: number; ac: boolean; f: number; R: number; C: number; L: number; ton: number; toff: number; Prated: number; v: number; i: number }

/** solve A x = b (Gaussian elimination with partial pivoting) */
function solve(A: number[][], b: number[]): number[] {
  const N = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < N; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= N; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(N).fill(0);
  for (let r = N - 1; r >= 0; r--) { let s = M[r][N]; for (let k = r + 1; k < N; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const parts = ents.filter((e) => ['battery', 'resistor', 'lamp', 'cap', 'ind', 'switch'].includes(e.kind)).sort((a, b) => a.x - b.x);
  if (!parts.length) return emptyScene('no components: press E and add a battery and something for it to drive');
  // columns: parts within 2 cells sideways of the previous one stack in parallel
  const colOf: number[] = [];
  let nc = 0;
  parts.forEach((e, i) => { if (i > 0 && e.x - parts[i - 1].x > 2) nc++; colOf.push(nc); });
  const C = nc + 1, NN = C === 1 ? 2 : C;
  const comps: Comp[] = parts.map((e, i) => {
    const col = colOf[i], a = C === 1 ? 0 : col, b = C === 1 ? 1 : (col + 1) % C;
    return { e, k: e.kind as Kind, col, a, b, V: n(e.v.V, 1.5), r: Math.max(1e-6, n(e.v.r, 0.1)), ac: str(e.v.type, 'DC') === 'AC', f: n(e.v.f, 50), R: Math.max(1e-9, n(e.v.R, 10)), C: Math.max(1e-15, n(e.v.C, 100) * 1e-6), L: Math.max(1e-12, n(e.v.L, 10) * 1e-3), ton: n(e.v.ton, 0), toff: n(e.v.toff, 1e9), Prated: Math.max(1e-9, n(e.v.P, 5)), v: 0, i: 0 };
  });
  const dt = s.dt, steps = s.steps, ev = every(steps);
  const emf = (q: Comp, t: number) => (q.ac ? q.V * Math.SQRT2 * Math.sin(2 * Math.PI * q.f * t) : q.V);
  const closed = (q: Comp, t: number) => t >= q.ton && t < q.toff;
  // branch current a→b = G·(va − vb) + J
  const stamp = (q: Comp, t: number): [number, number] => {
    switch (q.k) {
      case 'battery': return [1 / q.r, emf(q, t) / q.r];
      case 'resistor': case 'lamp': return [1 / q.R, 0];
      case 'switch': return [closed(q, t) ? 1e6 : 1e-9, 0];
      case 'cap': { const G = (2 * q.C) / dt; return [G, -(G * q.v + q.i)]; }
      case 'ind': { const G = dt / (2 * q.L); return [G, q.i + G * q.v]; }
    }
  };
  const solveAt = (t: number) => {
    const M = NN - 1, A = [...Array(M)].map(() => new Array(M).fill(0)), rhs = new Array(M).fill(0), GJ = comps.map((q) => stamp(q, t));
    comps.forEach((q, j) => {
      const [G, J] = GJ[j], a = q.a - 1, b = q.b - 1;
      if (a >= 0) { A[a][a] += G; rhs[a] -= J; } if (b >= 0) { A[b][b] += G; rhs[b] += J; }
      if (a >= 0 && b >= 0) { A[a][b] -= G; A[b][a] -= G; }
    });
    for (let i = 0; i < M; i++) A[i][i] += 1e-12;
    const vn = [0, ...solve(A, rhs)];
    return comps.map((q, j) => { const v = vn[q.a] - vn[q.b]; return [v, GJ[j][0] * v + GJ[j][1]]; });
  };
  // the moment everything is connected (t = 0): capacitors are still empty (they act as wires) and coils
  // still carry no current (they act as breaks)
  const cS = comps.map((q) => [q.C, q.L]);
  comps.forEach((q) => { if (q.k === 'cap') { q.C = 1e9 * dt; q.v = 0; q.i = 0; } if (q.k === 'ind') q.L = 1e18 * dt; });
  solveAt(0).forEach(([v, i], j) => { const q = comps[j]; q.v = q.k === 'cap' ? 0 : v; q.i = q.k === 'ind' ? 0 : i; });
  comps.forEach((q, j) => { [q.C, q.L] = cS[j]; });
  let supplied = 0, heat = 0;
  const stored = () => comps.reduce((a, q) => a + (q.k === 'cap' ? 0.5 * q.C * q.v * q.v : q.k === 'ind' ? 0.5 * q.L * q.i * q.i : 0), 0);
  const cols = ['t', ...comps.flatMap((q) => [`${q.e.name} current (A)`, `${q.e.name} voltage (V)`]), 'supplied (J)', 'heat (J)', 'stored (J)'];
  const rows: number[][] = [];
  const rec = (t: number) => rows.push([t, ...comps.flatMap((q) => [q.i, q.k === 'battery' ? -q.v : q.v]), supplied, heat, stored()]);
  rec(0);
  for (let k = 1; k <= steps; k++) {
    const t0 = (k - 1) * dt, t1 = k * dt, prev = comps.map((q) => [q.v, q.i]), sol = solveAt(t1);
    comps.forEach((q, j) => {
      const [v0, i0] = prev[j], [v1, i1] = sol[j], va = (v0 + v1) / 2, ia = (i0 + i1) / 2;
      // energy per branch from step-averaged voltage and current (Tellegen: these balance exactly)
      if (q.k === 'battery') { const ea = (emf(q, t0) + emf(q, t1)) / 2; supplied += ea * ia * dt; heat += (ea + va) * ia * dt; } // EMF work, and r·i² inside
      else if (q.k !== 'cap' && q.k !== 'ind') heat += va * ia * dt;
      q.v = v1; q.i = i1;
    });
    if (k % ev === 0 || k === steps) rec(t1);
  }
  const checks: Check[] = [{ l: 'energy: supplied = heat + stored (capacitors & coils)', exp: supplied, act: heat + stored(), u: 'J', abs: 1e-9 * Math.max(1e-12, Math.abs(supplied), heat) }];
  const bats = comps.filter((q) => q.k === 'battery'), last = rows[rows.length - 1];
  const resistive = comps.every((q) => q.k === 'battery' || q.k === 'resistor' || q.k === 'lamp' || (q.k === 'switch' && q.toff > last[0] && q.ton <= 0));
  if (bats.length === 1 && !bats[0].ac && resistive && C > 1 && comps.filter((q) => q.col === bats[0].col).length === 1) {
    // series–parallel: I = V / (r + Σ over columns of the parallel resistance)
    const Rcol = [...Array(C).keys()].filter((c) => c !== bats[0].col).map((c) => 1 / comps.filter((q) => q.col === c).reduce((a, q) => a + (q.k === 'switch' ? 1e6 : 1 / q.R), 0));
    const I = bats[0].V / (bats[0].r + Rcol.reduce((a, b) => a + b, 0));
    checks.push({ l: 'battery current V / (r + Σ column resistances)', exp: I, act: last[1 + 2 * comps.indexOf(bats[0])], u: 'A', tol: 1e-5 });
  }
  const cap = comps.filter((q) => q.k === 'cap');
  if (bats.length === 1 && !bats[0].ac && cap.length === 1 && C === 3 && comps.length === 3 && comps.some((q) => q.k === 'resistor')) {
    // RC charging: v_C = V (1 − e^(−t/τ)), τ = (R + r) C
    const R = comps.find((q) => q.k === 'resistor')!.R + bats[0].r, tau = R * cap[0].C, t = last[0];
    checks.push({ l: 'capacitor voltage V(1 − e^(−t/RC))', exp: bats[0].V * (1 - Math.exp(-t / tau)), act: Math.abs(last[2 + 2 * comps.indexOf(cap[0])]), u: 'V', tol: 1e-4 });
  }
  const colX = [...Array(C).keys()].map((c) => { const xs = comps.filter((q) => q.col === c).map((q) => q.e.x); return [Math.min(...xs) - 1.5, Math.max(...xs) + 1.5]; });
  const colY = [...Array(C).keys()].map((c) => { const ys = comps.filter((q) => q.col === c).map((q) => q.e.y); return [Math.min(...ys) - 2, Math.max(...ys) + 1]; });
  const top = Math.min(...colY.map((q) => q[0])) - 3;
  return {
    cols, rows, checks,
    notes: ['parts stacked in the same column are in parallel; the columns, left to right, are in series around one loop (the last column wires back to the first)', ...(C === 1 ? ['only one column: everything is in parallel across the same two wires'] : [])],
    scalars: [...comps.filter((q) => q.k === 'lamp').map((q) => ({ l: `${q.e.name}: brightness at the end`, v: (100 * Math.abs(last[1 + 2 * comps.indexOf(q)] * last[2 + 2 * comps.indexOf(q)])) / q.Prated, u: '% of rated' })), ...comps.flatMap((q) => [{ l: `${q.e.name}: final current`, v: last[1 + 2 * comps.indexOf(q)], u: 'A' }, { l: `${q.e.name}: final voltage`, v: last[2 + 2 * comps.indexOf(q)], u: 'V' }]), { l: 'energy supplied', v: supplied, u: 'J' }, { l: 'turned to heat & light', v: heat, u: 'J' }],
    charts: [
      tchart(cols, rows, 'i', 'currents', comps.map((q) => `${q.e.name} current (A)`), 'A'),
      tchart(cols, rows, 'v', 'voltages', comps.map((q) => `${q.e.name} voltage (V)`), 'V'),
      tchart(cols, rows, 'E', 'energy', ['supplied (J)', 'heat (J)', 'stored (J)'], 'J'),
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(0, SCENE_W, -SCENE_H, 0, 14);
      const Y = (y: number) => -y, w = COL.dim;
      // rails of each column, series links between them, and the return wire over the top
      for (let c = 0; c < C; c++) {
        const [x0, x1] = colX[c], [y0, y1] = colY[c];
        G.line(x0, Y(y0), x0, Y(y1), w, 2); G.line(x1, Y(y0), x1, Y(y1), w, 2);
        if (c < C - 1) G.line(x1, Y(y0), colX[c + 1][0], Y(colY[c + 1][0]), w, 2);
      }
      if (C > 1) { G.line(colX[C - 1][1], Y(colY[C - 1][0]), colX[C - 1][1], Y(top), w, 2); G.line(colX[C - 1][1], Y(top), colX[0][0], Y(top), w, 2); G.line(colX[0][0], Y(top), colX[0][0], Y(colY[0][0]), w, 2); }
      comps.forEach((q, j) => {
        const [x0, x1] = colX[q.col], y = Y(q.e.y - 1), I = rw[1 + 2 * j], V = rw[2 + 2 * j];
        G.line(x0, y, q.e.x - 1, y, w, 2); G.line(q.e.x + 1, y, x1, y, w, 2);
        if (q.k === 'lamp') { const f = Math.min(1, Math.abs(I * V) / q.Prated); if (f > 0.01) G.circle(q.e.x, y + 0.6, 0.6 + 2.2 * f, `rgba(255,207,92,${0.25 + 0.5 * f})`, true); }
        sprite(G, q.e.sprite, q.e.x, Y(q.e.y), 2);
        label(G, `${q.e.name} ${I.toFixed(3)} A ${V.toFixed(2)} V`, q.e.x, Y(q.e.y), COL.dim, 14);
      });
      G.hud([`t=${rw[0].toExponential(3)} s  ${comps.length} parts in ${C} column${C > 1 ? 's' : ''} (series) · same column = parallel`, `supplied ${rw[cols.indexOf('supplied (J)')].toPrecision(5)} J · heat ${rw[cols.indexOf('heat (J)')].toPrecision(5)} J · stored ${rw[cols.indexOf('stored (J)')].toPrecision(5)} J`]);
    },
  };
}

export const circuitsScene: Catalog = {
  env: [], engine: 'scene', run,
  desc: 'one circuit you lay out: parts stacked in a column are in parallel, columns side by side are in series',
  settings: { dt: 1e-4, steps: 5000, method: 'rk4' }, timeBased: true,
  envDefs: [],
  globals: [],
  where: 'stack parts in the same column to wire them in parallel · put columns side by side to wire them in series (left to right around one loop)',
  kinds: [
    { kind: 'battery', name: 'battery', sprite: 'battery', desc: 'a DC or AC source with internal resistance', custom: [
      { k: 'type', l: 'type', v: 'DC', o: ['DC', 'AC'], d: 'DC = steady; AC = sine wave (the voltage is the RMS value).' },
      { k: 'V', l: 'voltage', u: 'V', v: 9, s: 0.5, d: 'EMF (RMS for AC). It pushes current left → right through its column.' },
      { k: 'r', l: 'internal resistance', u: 'Ω', v: 0.5, min: 1e-6, s: 0.1, d: 'Resistance inside the battery.' },
      { k: 'f', l: 'AC frequency', u: 'Hz', v: 50, min: 0, s: 10, d: 'Frequency of an AC supply.', when: (p) => str(p.type, 'DC') === 'AC' },
    ] },
    { kind: 'resistor', name: 'resistor', sprite: 'resistor', desc: 'a fixed resistance', custom: [{ k: 'R', l: 'resistance', u: 'Ω', v: 100, min: 1e-9, s: 10, d: 'Resistance.' }] },
    { kind: 'lamp', name: 'lamp', sprite: 'bulb', desc: 'a bulb: glows with the power it gets', custom: [
      { k: 'R', l: 'hot resistance', u: 'Ω', v: 12, min: 1e-9, s: 1, d: 'Filament resistance when lit.' },
      { k: 'P', l: 'rated power', u: 'W', v: 6, min: 1e-9, s: 1, d: 'Full brightness at this power.' },
    ] },
    { kind: 'cap', name: 'capacitor', sprite: 'capacitor', desc: 'stores charge', custom: [{ k: 'C', l: 'capacitance', u: 'µF', v: 1000, min: 1e-9, s: 100, d: 'Capacitance (starts uncharged).' }] },
    { kind: 'ind', name: 'coil', sprite: 'coil', desc: 'an inductor: resists changes of current', custom: [{ k: 'L', l: 'inductance', u: 'mH', v: 100, min: 1e-9, s: 10, d: 'Inductance (starts with no current).' }] },
    { kind: 'switch', name: 'switch', sprite: 'switch', desc: 'closes at one time and opens at another', custom: [
      { k: 'ton', l: 'closes at', u: 's', v: 0, min: 0, s: 0.01, d: 'Time it closes.' },
      { k: 'toff', l: 'opens at', u: 's', v: 1e9, min: 0, s: 0.01, d: 'Time it opens again.' },
    ] },
  ],
  presets: [
    { name: 'AA cell', kind: 'battery', sprite: 'battery', desc: '1.5 V, 0.15 Ω', v: { type: 'DC', V: 1.5, r: 0.15 } },
    { name: 'car battery', kind: 'battery', sprite: 'carbattery', desc: '12.6 V, 0.01 Ω', v: { type: 'DC', V: 12.6, r: 0.01 } },
    { name: 'mains socket', kind: 'battery', sprite: 'socket', desc: '230 V AC, 50 Hz', v: { type: 'AC', V: 230, r: 0.5, f: 50 } },
    { name: 'car headlight', kind: 'lamp', sprite: 'bulb', desc: '55 W at 12 V', v: { R: 2.62, P: 55 } },
    { name: 'torch bulb', kind: 'lamp', sprite: 'bulb', desc: '0.5 W at 3 V', v: { R: 18, P: 0.5 } },
    { name: 'camera flash capacitor', kind: 'cap', sprite: 'flash', desc: '1000 µF', v: { C: 1000 } },
    { name: 'radio tuning coil', kind: 'ind', sprite: 'radio', desc: '1 mH', v: { L: 1 } },
  ],
  start: [['battery', 12, 16, { V: 12, r: 0.1 }], ['switch', 24, 16, { ton: 0.05 }], ['car headlight', 36, 12], ['torch bulb', 36, 20], ['cap', 48, 16, { C: 50000 }]],
  tests: [
    { name: 'series–parallel lamps', list: [['car battery', 10, 16], ['resistor', 22, 16, { R: 2 }], ['car headlight', 34, 12], ['car headlight', 34, 20], ['torch bulb', 46, 16]] },
    { name: 'RC charging', list: [['battery', 10, 16, { V: 10, r: 1 }], ['resistor', 22, 16, { R: 99 }], ['cap', 34, 16, { C: 1000 }]], s: { dt: 1e-4, steps: 2000 } },
    { name: 'AC through RLC', list: [['mains socket', 10, 16], ['resistor', 22, 16, { R: 10 }], ['ind', 34, 16, { L: 100 }], ['cap', 46, 16, { C: 101.3 }]], s: { dt: 2e-5, steps: 10000 } },
    { name: 'coil switched off', list: [['car battery', 10, 16], ['resistor', 22, 16, { R: 1 }], ['ind', 34, 12, { L: 10 }], ['resistor', 34, 20, { R: 50 }], ['switch', 46, 16, { toff: 0.2 }]], s: { dt: 1e-4, steps: 4000 } },
  ],
  guide(g, X, Y, _cp, _p, ents) {
    // show which parts share a column (parallel)
    const xs = ents.map((e) => e.x).sort((a, b) => a - b);
    const groups: number[][] = [];
    xs.forEach((x, i) => { if (i === 0 || x - xs[i - 1] > 2) groups.push([x]); else groups[groups.length - 1].push(x); });
    g.strokeStyle = '#2b3036';
    for (const gr of groups) { const x0 = Math.min(...gr) - 1.5, x1 = Math.max(...gr) + 1.5; g.strokeRect(X(x0), Y(2), X(x1) - X(x0), Y(SCENE_H - 2) - Y(2)); }
  },
};
