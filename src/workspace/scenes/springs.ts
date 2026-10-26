// Springs, one rail: masses placed on the same row are joined in a chain, each by its own spring (and damper)
// to its left neighbour; the end masses are tied to the walls when they are on. A shaker drives the mass it
// touches. Pull a mass sideways in EDIT to start it displaced: the whole chain responds together.
import type { Catalog } from '../catalog';
import { n, str, emptyScene, tchart, simulate, energyCheck, spriteC, label, COL, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';
import { crossings, meanPeriod } from '../../core/num';

/** eigenvalues of a symmetric matrix (cyclic Jacobi) */
function eigSym(A0: number[][]): number[] {
  const N = A0.length, A = A0.map((r) => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) off += A[i][j] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < N; p++) for (let q = p + 1; q < N; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < N; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < N; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
    }
  }
  return A.map((r, i) => r[i]).sort((a, b) => a - b);
}

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.05), wallL = str(p.wallL, 'on') === 'on', wallR = str(p.wallR, 'on') === 'on';
  const masses = ents.filter((e) => e.kind === 'mass').sort((a, b) => a.x - b.x);
  if (!masses.length) return emptyScene('no masses: press E and add some on the same row (they get joined by springs)');
  // chains: masses within 1.5 rows of each other share a rail
  const chains: Ent[][] = [];
  for (const m of masses) { const c = chains.find((ch) => Math.abs(ch[0].y - m.y) <= 1.5); if (c) c.push(m); else chains.push([m]); }
  const N = masses.length, idx = (e: Ent) => masses.indexOf(e);
  const M = masses.map((e) => Math.max(1e-9, n(e.v.m, 1)));
  // springs: [left index or -1 (wall), right index or -2 (wall), k, c, rest length]
  const springs: [number, number, number, number, number][] = [];
  const W = SCENE_W * scale;
  for (const ch of chains) ch.forEach((e, i) => {
    const k = n(e.v.k, 100), c = n(e.v.c, 0);
    if (i > 0) springs.push([idx(ch[i - 1]), idx(e), k, c, (e.x - ch[i - 1].x) * scale]);
    else if (wallL) springs.push([-1, idx(e), k, c, e.x * scale]);
    if (i === ch.length - 1 && wallR) springs.push([idx(e), -2, k, c, W - e.x * scale]);
  });
  const shakers = ents.filter((e) => e.kind === 'shaker').map((e) => {
    let bi = -1, bd = 3;
    masses.forEach((m, i) => { const d = Math.hypot(m.x - e.x, m.y - e.y); if (d <= bd) { bd = d; bi = i; } });
    return { e, F0: n(e.v.F0, 10), f: n(e.v.f, 1), i: bi };
  });
  const x0 = masses.map((e) => e.x * scale);
  const pos = (y: number[], i: number) => (i === -1 ? 0 : i === -2 ? W : x0[i] + y[i]);
  const vel = (y: number[], i: number) => (i < 0 ? 0 : y[N + i]);
  const f = (t: number, y: number[]) => {
    const d = new Array(2 * N + 2).fill(0);
    for (let i = 0; i < N; i++) d[i] = y[N + i];
    let diss = 0, drive = 0;
    for (const [a, b, k, c, L0] of springs) {
      const ext = pos(y, b) - pos(y, a) - L0, rate = vel(y, b) - vel(y, a), F = k * ext + c * rate; // tension
      if (a >= 0) d[N + a] += F / M[a];
      if (b >= 0) d[N + b] -= F / M[b];
      diss += c * rate * rate;
    }
    for (const sh of shakers) if (sh.i >= 0) { const F = sh.F0 * Math.sin(2 * Math.PI * sh.f * t); d[N + sh.i] += F / M[sh.i]; drive += F * y[N + sh.i]; }
    d[2 * N] = diss; d[2 * N + 1] = drive;
    return d;
  };
  const E = (y: number[]) => masses.reduce((a, _, i) => a + 0.5 * M[i] * y[N + i] ** 2, 0) + springs.reduce((a, [i, j, k, , L0]) => a + 0.5 * k * (pos(y, j) - pos(y, i) - L0) ** 2, 0);
  const y0 = [...masses.map((e) => n(e.v.x0, 0)), ...masses.map((e) => n(e.v.v0, 0)), 0, 0];
  const cols = ['t', ...masses.flatMap((e) => [`${e.name} x (m)`, `${e.name} v (m/s)`]), 'energy (J)', 'dissipated (J)', 'driver work (J)'];
  const rows: number[][] = [];
  const yE = simulate(f, y0, s, (t, y) => rows.push([t, ...masses.flatMap((_, i) => [y[i], y[N + i]]), E(y), y[2 * N], y[2 * N + 1]]), N);
  const E0 = E(y0);
  const checks: Check[] = [energyCheck('energy: E_end + dissipated − driver work = E_0', E0, E(yE) + yE[2 * N] - yE[2 * N + 1], Math.max(E0, yE[2 * N + 1], 1e-12), s.method, 1e-6)];
  // normal modes of the undamped chain: ω² = eig(M^-½ K M^-½)
  const K = [...Array(N)].map(() => new Array(N).fill(0));
  for (const [a, b, k] of springs) { if (a >= 0) K[a][a] += k; if (b >= 0) K[b][b] += k; if (a >= 0 && b >= 0) { K[a][b] -= k; K[b][a] -= k; } }
  const om = eigSym(K.map((r, i) => r.map((v, j) => v / Math.sqrt(M[i] * M[j])))).map((l) => Math.sqrt(Math.max(0, l)));
  const undamped = springs.every((q) => q[3] === 0) && !shakers.some((q) => q.i >= 0);
  if (N === 1 && undamped && om[0] > 0) {
    const cr = crossings(rows.map((r) => r[0]), rows.map((r) => r[1]), 0, 1), T = meanPeriod(cr);
    checks.push({ l: `${masses[0].name}: period 2π√(m/k_total)`, exp: (2 * Math.PI) / om[0], act: T, u: 's', tol: 2e-3, ref: !Number.isFinite(T) });
  }
  const tied = springs.some((q) => q[0] === -1 || q[1] === -2);
  if (!tied && !shakers.some((q) => q.i >= 0)) {
    const mom = (y: number[]) => masses.reduce((a, _, i) => a + M[i] * y[N + i], 0);
    checks.push({ l: 'momentum conserved (no walls)', exp: mom(y0), act: mom(yE), u: 'kg m/s', abs: 1e-9 * Math.max(1e-12, ...masses.map((_, i) => M[i] * Math.abs(y0[N + i]) + Math.sqrt(M[i] * E0))) });
  }
  const amp = Math.max(1e-9, ...rows.flatMap((r) => masses.map((_, i) => Math.abs(r[1 + 2 * i]))));
  return {
    cols, rows, checks,
    notes: ['masses on the same row form a chain: each mass is joined to its left neighbour by its own spring; with walls on, the end masses are tied to the walls (the right wall uses the last mass\'s spring)'],
    scalars: [...om.map((w, i) => ({ l: `normal mode ${i + 1} frequency`, v: w / (2 * Math.PI), u: 'Hz' })), { l: 'start energy', v: E0, u: 'J' }, { l: 'dissipated', v: yE[2 * N], u: 'J' }],
    charts: [tchart(cols, rows, 'x', 'displacements', masses.map((e) => `${e.name} x (m)`), 'm'), tchart(cols, rows, 'E', 'energy', ['energy (J)', 'dissipated (J)', 'driver work (J)'], 'J')],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      const H = 36 * scale;
      G.view(0, W, 0, H, 14);
      const y = [...masses.map((_, i) => rw[1 + 2 * i]), ...masses.map((_, i) => rw[2 + 2 * i])];
      const hOf = (e: Ent) => (36 - e.y) * scale;
      if (wallL) G.rect(-0.015 * W, 0, 0.015 * W, H, COL.dim, true);
      if (wallR) G.rect(W, 0, 0.015 * W, H, COL.dim, true);
      for (const [a, b] of springs) { const h = hOf(masses[a >= 0 ? a : b]); G.spring(pos(y, a), h, pos(y, b), h, COL.fg, 10, 5); }
      masses.forEach((e, i) => { spriteC(G, e.sprite, pos(y, i), hOf(e), 3); label(G, `${e.name} ${(rw[1 + 2 * i] * 1e3).toFixed(1)} mm`, pos(y, i), hOf(e), COL.dim, -16); });
      shakers.forEach((sh) => { if (sh.i >= 0) { const h = hOf(masses[sh.i]); spriteC(G, sh.e.sprite, pos(y, sh.i), h - 3 * scale, 2); } });
      G.hud([`t=${rw[0].toFixed(3)} s  ${N} mass${N > 1 ? 'es' : ''} · ${springs.length} springs · ${chains.length} rail${chains.length > 1 ? 's' : ''}`, `E=${rw[cols.indexOf('energy (J)')].toFixed(5)} J  (largest swing ${(amp * 1e3).toFixed(1)} mm)`]);
    },
  };
}

export const springsScene: Catalog = {
  env: [], engine: 'scene', run,
  desc: 'masses joined by springs and dampers on rails between walls, with shakers: coupled oscillation and normal modes',
  settings: { dt: 0.002, steps: 5000, method: 'rk4' }, timeBased: true,
  envDefs: [],
  globals: [
    { k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.05, min: 1e-4, s: 0.01, d: 'Size of one editor grid cell (sets the spring rest lengths).' },
    { k: 'wallL', l: 'left wall', v: 'on', o: ['on', 'off'], d: 'Tie the leftmost mass of each rail to the left wall.' },
    { k: 'wallR', l: 'right wall', v: 'on', o: ['on', 'off'], d: 'Tie the rightmost mass of each rail to the right wall.' },
  ],
  where: 'masses on the same row are joined by springs (left to right); walls tie the ends · drag a mass sideways to pull it out of place',
  kinds: [
    { kind: 'mass', name: 'mass', sprite: 'weight', desc: 'a mass on the rail, with its spring to the left', aim: { kind: 'len', field: 'x0', per: 0.01 }, custom: [
      { k: 'm', l: 'mass', u: 'kg', v: 1, min: 1e-6, s: 0.1, d: 'Mass of this block.' },
      { k: 'k', l: 'spring to the left: stiffness', u: 'N/m', v: 100, min: 0, s: 10, d: 'Stiffness of the spring joining it to its left neighbour (or wall).' },
      { k: 'c', l: 'spring to the left: damping', u: 'N s/m', v: 0, min: 0, s: 0.5, d: 'Damper alongside that spring.' },
      { k: 'x0', l: 'start displacement', u: 'm', v: 0.05, s: 0.01, d: 'How far it is pulled from where it sits (drag it in EDIT).' },
      { k: 'v0', l: 'start push', u: 'm/s', v: 0, s: 0.1, d: 'Initial velocity.' },
    ] },
    { kind: 'shaker', name: 'shaker', sprite: 'washer', desc: 'drives the mass it touches with F₀ sin(2πft)', custom: [
      { k: 'F0', l: 'force amplitude', u: 'N', v: 10, s: 1, d: 'Peak driving force.' },
      { k: 'f', l: 'frequency', u: 'Hz', v: 1, min: 0, s: 0.1, d: 'Driving frequency: near a normal mode it resonates.' },
    ] },
  ],
  presets: [
    { name: 'car suspension', kind: 'mass', sprite: 'carspring', desc: '300 kg, 20 kN/m, damped', v: { m: 300, k: 20000, c: 1500, x0: 0.05, v0: 0 } },
    { name: 'slinky', kind: 'mass', sprite: 'slinky', desc: 'soft and light', v: { m: 0.2, k: 2, c: 0.01, x0: 0.2, v0: 0 } },
    { name: 'bungee jumper', kind: 'mass', sprite: 'bungee', desc: '70 kg on a 100 N/m cord', v: { m: 70, k: 100, c: 20, x0: 1, v0: 0 } },
    { name: 'washing machine drum', kind: 'shaker', sprite: 'washer', desc: '200 N at 3 Hz', v: { F0: 200, f: 3 } },
  ],
  start: [['mass', 22, 18], ['mass', 42, 18, { x0: 0 }]],
  tests: [
    { name: 'single mass (period)', list: [['mass', 32, 18]], p: { wallR: 'off' } },
    { name: 'free chain (momentum)', list: [['mass', 22, 18, { v0: 1 }], ['mass', 32, 18, { x0: 0 }], ['mass', 42, 18, { x0: 0 }]], p: { wallL: 'off', wallR: 'off' } },
    { name: 'driven damped chain', list: [['mass', 22, 18, { c: 1 }], ['mass', 42, 18, { x0: 0, c: 1 }], ['shaker', 42, 19, { f: 1.2 }]] },
  ],
  guide(g, X, Y, cp, p, ents) {
    g.fillStyle = '#4b525c';
    if (str(p.wallL, 'on') === 'on') g.fillRect(X(0) - 4, Y(0), 4, cp * 36);
    if (str(p.wallR, 'on') === 'on') g.fillRect(X(SCENE_W), Y(0), 4, cp * 36);
    const rows = [...new Set(ents.filter((e) => e.k === 'mass').map((e) => Math.round(e.y)))];
    g.strokeStyle = '#2b3036';
    for (const r of rows) { g.beginPath(); g.moveTo(X(0), Y(r)); g.lineTo(X(SCENE_W), Y(r)); g.stroke(); }
  },
};
