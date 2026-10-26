// Granular, one box: every heap pours its grains from where you put it into the same box, so sand lands on
// gravel and marbles roll off both. Pegs are fixed round obstacles (a Galton board). Grains are discs with
// spring-dashpot contacts and Coulomb friction (discrete elements), stepped with symplectic Euler.
import type { Catalog } from '../catalog';
import { rng } from '../../core/num';
import { n, emptyScene, tchart, label, COL, GROUND, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const PAL = ['#d9b27a', '#7fd1ff', '#b0b8c4', '#e05555', '#5cb85c', '#9b6bd6', '#f0913a'];

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.01), g = n(p.g, 9.80665), W = SCENE_W * scale, Htop = GROUND * scale;
  const heaps = ents.filter((e) => e.kind === 'heap');
  if (!heaps.length) return emptyScene('no grains: press E and add a heap (it pours from where you put it)');
  const pegs = ents.filter((e) => e.kind === 'peg').map((e) => ({ e, x: e.x * scale, y: (GROUND - e.y) * scale, r: n(e.v.r, 0.005) }));
  // grains: each heap's grains start packed in a column above its spot (seeded, so runs repeat)
  const X: number[] = [], Y: number[] = [], VX: number[] = [], VY: number[] = [], R: number[] = [], M: number[] = [], H: number[] = [], EE: number[] = [], MU: number[] = [];
  heaps.forEach((e, hi) => {
    const N = Math.max(1, Math.min(600, Math.round(n(e.v.N, 100)))), r = Math.max(1e-5, n(e.v.r, 0.004)), rho = n(e.v.rho, 2600), v0 = n(e.v.v0, 0), rand = rng(1000 + e.id * 7);
    const cols = Math.max(1, Math.round(n(e.v.w, 8))), x0 = e.x * scale, y0 = (GROUND - e.y) * scale;
    for (let i = 0; i < N; i++) {
      const c = i % cols, row = Math.floor(i / cols), a = rand() * 2 * Math.PI;
      X.push(Math.min(W - r, Math.max(r, x0 + ((c - (cols - 1) / 2) * 2.2 + (rand() - 0.5) * 0.2) * r))); Y.push(Math.max(r, y0 + r + row * 2.2 * r));
      VX.push(v0 * Math.cos(a)); VY.push(v0 * Math.sin(a)); R.push(r * (0.9 + 0.2 * rand())); M.push(rho * Math.PI * R[R.length - 1] ** 2 * 0.01); // 1 cm deep discs
      H.push(hi); EE.push(Math.min(1, Math.max(0, n(e.v.e, 0.4)))); MU.push(Math.max(0, n(e.v.mu, 0.5)));
    }
  });
  const N = X.length, dt = s.dt, steps = s.steps, tc = 25 * dt, mMin = Math.min(...M);
  const kn = (m: number) => m * (Math.PI / tc) ** 2;
  const zeta = (e: number) => (e >= 1 ? 0 : e <= 0 ? 1 : -Math.log(e) / Math.sqrt(Math.PI ** 2 + Math.log(e) ** 2));
  const rMax = Math.max(...R, ...pegs.map((q) => q.r)), cell = 2 * rMax;
  const nx = Math.max(1, Math.ceil(W / cell));
  let diss = 0, elastic = 0;
  const AX = new Float64Array(N), AY = new Float64Array(N);
  const contact = (i: number, j: number, dx: number, dy: number, d: number, rs: number, mj: number, vxj: number, vyj: number) => {
    // linear spring-dashpot along the normal, Coulomb-limited viscous friction along the tangent
    const ov = rs - d; if (ov <= 0) return;
    const nxv = dx / d, nyv = dy / d, meff = Number.isFinite(mj) ? (M[i] * mj) / (M[i] + mj) : M[i];
    const k = kn(meff), c = 2 * zeta(Number.isFinite(mj) ? Math.min(EE[i], EE[j] ?? 1) : EE[i]) * Math.sqrt(k * meff);
    const rvx = VX[i] - vxj, rvy = VY[i] - vyj, vn = rvx * nxv + rvy * nyv, vtx = rvx - vn * nxv, vty = rvy - vn * nyv, vt = Math.hypot(vtx, vty);
    const Fn = Math.max(0, k * ov - c * vn), mu = j >= 0 ? Math.min(MU[i], MU[j]) : MU[i];
    const Ft = vt > 1e-12 ? Math.min(mu * Fn, 2 * meff * vt / dt * 0.5) : 0;
    const fx = Fn * nxv - (vt > 1e-12 ? (Ft * vtx) / vt : 0), fy = Fn * nyv - (vt > 1e-12 ? (Ft * vty) / vt : 0);
    AX[i] += fx / M[i]; AY[i] += fy / M[i];
    if (j >= 0) { AX[j] -= fx / M[j]; AY[j] -= fy / M[j]; }
    diss += ((Fn - k * ov) * -vn + Ft * vt) * dt; elastic += 0.5 * k * ov * ov;
  };
  const forces = () => {
    AX.fill(0); AY.fill(0); elastic = 0;
    const grid = new Map<number, number[]>();
    for (let i = 0; i < N; i++) { const key = Math.floor(X[i] / cell) + nx * Math.floor(Y[i] / cell); (grid.get(key) ?? grid.set(key, []).get(key)!).push(i); }
    for (let i = 0; i < N; i++) {
      AY[i] -= g;
      const cx = Math.floor(X[i] / cell), cy = Math.floor(Y[i] / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const list = grid.get(cx + ox + nx * (cy + oy)); if (!list) continue;
        for (const j of list) { if (j <= i) continue; const dx = X[i] - X[j], dy = Y[i] - Y[j], d = Math.hypot(dx, dy); if (d < R[i] + R[j] && d > 0) contact(i, j, dx, dy, d, R[i] + R[j], M[j], VX[j], VY[j]); }
      }
      // floor, side walls, pegs
      if (Y[i] < R[i]) contact(i, -1, 0, 1, 1, R[i] - Y[i] + 1, Infinity, 0, 0);
      if (X[i] < R[i]) contact(i, -1, 1, 0, 1, R[i] - X[i] + 1, Infinity, 0, 0);
      if (X[i] > W - R[i]) contact(i, -1, -1, 0, 1, R[i] - (W - X[i]) + 1, Infinity, 0, 0);
      for (const q of pegs) { const dx = X[i] - q.x, dy = Y[i] - q.y, d = Math.hypot(dx, dy); if (d < R[i] + q.r && d > 0) contact(i, -1, dx, dy, d, R[i] + q.r, Infinity, 0, 0); }
    }
  };
  const KE = () => { let a = 0; for (let i = 0; i < N; i++) a += 0.5 * M[i] * (VX[i] ** 2 + VY[i] ** 2); return a; };
  const PE = () => { let a = 0; for (let i = 0; i < N; i++) a += M[i] * g * Y[i]; return a; };
  const frames: Float32Array[] = [];
  const cols = ['t', 'kinetic (J)', 'height energy (J)', 'lost in contacts (J)', 'pile height (m)', ...heaps.flatMap((e) => [`${e.name} centre x (m)`, `${e.name} centre y (m)`])];
  const rows: number[][] = [];
  const ev = Math.max(1, Math.ceil(steps / 400));
  const rec = (t: number) => {
    const f = new Float32Array(2 * N); for (let i = 0; i < N; i++) { f[2 * i] = X[i]; f[2 * i + 1] = Y[i]; } frames.push(f);
    const cm = heaps.flatMap((_, hi) => { let sx = 0, sy = 0, sm = 0; for (let i = 0; i < N; i++) if (H[i] === hi) { sx += M[i] * X[i]; sy += M[i] * Y[i]; sm += M[i]; } return [sx / sm, sy / sm]; });
    let top = 0; for (let i = 0; i < N; i++) if (Math.hypot(VX[i], VY[i]) < 0.05) top = Math.max(top, Y[i] + R[i]);
    rows.push([t, KE(), PE(), diss, top, ...cm]);
  };
  forces();
  const E0 = KE() + PE() + elastic;
  rec(0);
  for (let k = 1; k <= steps; k++) {
    for (let i = 0; i < N; i++) { VX[i] += AX[i] * dt; VY[i] += AY[i] * dt; X[i] += VX[i] * dt; Y[i] += VY[i] * dt; }
    forces();
    if (k % ev === 0 || k === steps) rec(k * dt);
  }
  const E1 = KE() + PE() + elastic, last = rows[rows.length - 1];
  const checks: Check[] = [{ l: 'energy: kinetic + height + contact springs + losses = start (symplectic Euler: approximate)', exp: E0, act: E1 + diss, u: 'J', tol: 0.02, ref: true }];
  if (g === 0 && EE.every((e) => e === 1) && MU.every((m) => m === 0) && !pegs.length) checks.push({ l: 'elastic frictionless gas: energy conserved', exp: E0, act: E1 + diss, u: 'J', tol: 2e-3 });
  checks.push({ l: 'grains settle (kinetic energy → 0)', exp: 0, act: last[1] / Math.max(1e-30, E0), tol: 0, abs: 1e-3, ref: true });
  void mMin;
  return {
    cols, rows, checks,
    notes: [`${N} grains in one box ${W.toFixed(3)} m wide · each heap pours from where you put it · grains are 1 cm thick discs · contacts: spring-dashpot + Coulomb friction (method setting not used: DEM uses symplectic Euler)`],
    scalars: [{ l: 'grains', v: N }, { l: 'pile height', v: last[4] * 1000, u: 'mm' }, { l: 'energy lost in contacts', v: diss, u: 'J' }, ...heaps.map((e, hi) => ({ l: `${e.name}: grains`, v: H.filter((h) => h === hi).length }))],
    charts: [tchart(cols, rows, 'E', 'energy', ['kinetic (J)', 'height energy (J)', 'lost in contacts (J)'], 'J'), tchart(cols, rows, 'h', 'pile height', ['pile height (m)'], 'm')],
    draw(G: Gfx, k: number) {
      const f = frames[Math.min(k, frames.length - 1)], rw = rows[Math.min(k, rows.length - 1)];
      G.view(0, W, 0, Htop, 14);
      G.line(0, 0, W, 0, COL.dim, 2); G.line(0, 0, 0, Htop, COL.dim, 2); G.line(W, 0, W, Htop, COL.dim, 2);
      for (const q of pegs) G.circle(q.x, q.y, q.r, COL.fg, true);
      for (let i = 0; i < N; i++) G.circle(f[2 * i], f[2 * i + 1], Math.max(R[i], 1.2 / G.sx), PAL[H[i] % PAL.length], true);
      heaps.forEach((e, hi) => label(G, e.name, e.x * scale, (GROUND - e.y) * scale, PAL[hi % PAL.length], -4));
      G.hud([`t=${rw[0].toFixed(3)} s  ${N} grains from ${heaps.length} heap${heaps.length > 1 ? 's' : ''} · ${pegs.length} peg${pegs.length === 1 ? '' : 's'}`, `kinetic ${rw[1].toExponential(2)} J · pile ${(rw[4] * 1000).toFixed(1)} mm`]);
    },
  };
}

export const granularScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'heaps of sand, marbles and gravel poured into one box, over pegs: piles, avalanches and mixing',
  settings: { dt: 2e-4, steps: 8000, method: 'semi' }, timeBased: true,
  envDefs: [{ k: 'g', l: 'gravity', u: 'm/s2', v: 9.80665, s: 0.1, d: 'Acceleration of free fall (0 = a grain gas).' }],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.01, min: 1e-5, s: 0.002, d: 'Size of one editor grid cell: sets the box size.' }],
  where: 'each heap pours from where you put it (higher = falls further) · pegs are fixed obstacles · the box is the whole scene',
  kinds: [
    { kind: 'heap', name: 'heap of grains', sprite: 'sandpile', desc: 'grains poured from here', custom: [
      { k: 'N', l: 'grains', v: 100, min: 1, max: 600, s: 10, d: 'How many grains (more = slower).' },
      { k: 'r', l: 'grain radius', u: 'm', v: 0.004, min: 1e-5, s: 0.001, d: 'Grain size.' },
      { k: 'rho', l: 'grain density', u: 'kg/m3', v: 2600, min: 1, s: 100, d: 'Sand/glass ≈ 2600, steel 7850.' },
      { k: 'e', l: 'bounciness', v: 0.4, min: 0, max: 1, s: 0.05, d: 'Restitution of grain impacts.' },
      { k: 'mu', l: 'friction μ', v: 0.5, min: 0, s: 0.05, d: 'Grain-grain friction: sets how steep a pile can stand.' },
      { k: 'w', l: 'pour width (grains)', v: 8, min: 1, max: 60, s: 1, d: 'How many grains side by side in the falling column.' },
      { k: 'v0', l: 'shake speed', u: 'm/s', v: 0, min: 0, s: 0.1, d: 'Random start speed (a hot grain gas).' },
    ] },
    { kind: 'peg', name: 'peg', sprite: 'post', desc: 'a fixed round obstacle', custom: [{ k: 'r', l: 'radius', u: 'm', v: 0.005, min: 1e-5, s: 0.001, d: 'Peg radius.' }] },
  ],
  presets: [
    { name: 'dry sand', kind: 'heap', sprite: 'sand', desc: 'μ 0.5', v: { N: 150, r: 0.004, e: 0.4, mu: 0.5 } },
    { name: 'glass marbles', kind: 'heap', sprite: 'marbles', desc: 'bouncy, slippery', v: { N: 60, r: 0.007, e: 0.9, mu: 0.1, w: 5 } },
    { name: 'gravel', kind: 'heap', sprite: 'gravel', desc: 'coarse, rough', v: { N: 60, r: 0.009, e: 0.3, mu: 0.8, w: 5 } },
    { name: 'grain gas', kind: 'heap', sprite: 'marbles', desc: 'elastic, frictionless, shaken', v: { N: 100, r: 0.004, e: 1, mu: 0, v0: 1, w: 10 } },
  ],
  start: [['dry sand', 20, 4], ['glass marbles', 40, 4], ['peg', 30, 22], ['peg', 34, 22], ['peg', 32, 26]],
  tests: [
    { name: 'single sand pile', list: [['dry sand', 32, 10]], s: { steps: 6000 } },
    { name: 'grain gas (no gravity)', list: [['grain gas', 32, 20]], p: { g: 0 }, s: { steps: 3000 } },
  ],
  guide(g, X, Y, cp) { g.fillStyle = '#4b525c'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2); g.fillRect(X(0) - 2, Y(0), 2, cp * GROUND); g.fillRect(X(SCENE_W), Y(0), 2, cp * GROUND); },
};
