// Trusses, one valley: each bridge's left support is where you put it and it spans to the right. Vehicles placed
// on a deck drive along it (and onto the next bridge if the decks line up); loads placed on a deck just sit there.
// Every step the frame is solved by the stiffness method, so member forces follow the traffic across.
import type { Catalog } from '../catalog';
import { G0 } from '../../core/num';
import { n, str, emptyScene, tchart, sprite, label, every, COL, GROUND, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

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

function build(e: Ent, scale: number) {
  const type = str(e.v.type, 'pratt'), np = Math.max(2, Math.round(n(e.v.n, 6) / 2) * 2), L = Math.max(0.1, n(e.v.span, 24)), h = Math.max(0.01, n(e.v.h, 4));
  const x0 = e.x * scale, y0 = Math.max(0, (GROUND - e.y) * scale), dx = L / np;
  const X: number[] = [], Y: number[] = [], mem: [number, number][] = [], top: number[] = [];
  for (let i = 0; i <= np; i++) { X.push(x0 + i * dx); Y.push(y0); }
  for (let i = 0; i < np; i++) mem.push([i, i + 1]);
  if (type === 'warren') {
    for (let i = 0; i < np; i++) { top.push(X.length); X.push(x0 + (i + 0.5) * dx); Y.push(y0 + h); }
    for (let i = 0; i < np - 1; i++) mem.push([top[i], top[i + 1]]);
    for (let i = 0; i < np; i++) { mem.push([i, top[i]]); mem.push([top[i], i + 1]); }
  } else {
    top[0] = -1;
    for (let i = 1; i < np; i++) { top[i] = X.length; X.push(x0 + i * dx); Y.push(y0 + h); }
    for (let i = 1; i < np - 1; i++) mem.push([top[i], top[i + 1]]);
    for (let i = 1; i < np; i++) mem.push([i, top[i]]);
    mem.push([0, top[1]]); mem.push([np, top[np - 1]]);
    for (let i = 1; i < np - 1; i++) { const left = i + 1 <= np / 2; if (type === 'pratt') mem.push(left ? [top[i], i + 1] : [i, top[i + 1]]); else mem.push(left ? [i, top[i + 1]] : [top[i], i + 1]); }
  }
  const E = n(e.v.E, 200) * 1e9, A = n(e.v.A, 100) * 1e-4, fy = n(e.v.fy, 250) * 1e6, N = X.length;
  const geo = mem.map(([a, b]) => { const lx = X[b] - X[a], ly = Y[b] - Y[a], l = Math.hypot(lx, ly); return { c: lx / l, s: ly / l, l }; });
  const K = Array.from({ length: 2 * N }, () => new Array(2 * N).fill(0));
  mem.forEach(([a, b], k) => {
    const { c, s, l } = geo[k], kk = (E * A) / l, m = [[c * c, c * s], [c * s, s * s]], d = [2 * a, 2 * b];
    for (let I = 0; I < 2; I++) for (let J = 0; J < 2; J++) for (let r = 0; r < 2; r++) for (let q = 0; q < 2; q++) K[d[I] + r][d[J] + q] += (I === J ? 1 : -1) * kk * m[r][q];
  });
  // own weight: steel members, half of each member to each end joint
  const selfW = new Array(N).fill(0);
  mem.forEach(([a, b], k) => { const w = 7850 * A * geo[k].l * G0; selfW[a] += w / 2; selfW[b] += w / 2; });
  const fixed = [0, 1, 2 * np + 1], free = [...Array(2 * N).keys()].filter((i) => !fixed.includes(i));
  const Kf = free.map((i) => free.map((j) => K[i][j]));
  return { e, type, np, L, h, x0, y0, dx, X, Y, mem, geo, E, A, fy, N, K, fixed, free, Kf, selfW, I2: (A * A) / 12 };
}

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 1);
  const B = ents.filter((e) => e.kind === 'bridge').map((e) => build(e, scale));
  if (!B.length) return emptyScene('no bridge: press E and add one (its left support goes where you put it)');
  const V = ents.filter((e) => e.kind === 'veh').map((e) => ({ e, m: n(e.v.m, 2) * 1000, v: n(e.v.v, 10), x: e.x * scale, y: Math.max(0, (GROUND - e.y) * scale) }));
  const onBridge = (x: number, y: number) => B.findIndex((b) => Math.abs(y - b.y0) <= 3 * scale && x >= b.x0 - 1e-9 && x <= b.x0 + b.L + 1e-9);
  const dt = s.dt, steps = s.steps, ev = every(steps);
  const solveAll = (t: number) => B.map((b, bi) => {
    const F = new Array(2 * b.N).fill(0);
    b.selfW.forEach((w, i) => (F[2 * i + 1] -= w));
    let Pv = 0, Mv = 0;
    for (const q of V) {
      const x = q.x + q.v * t;
      if (onBridge(x, q.y) !== bi) continue;
      // a vehicle on the deck loads the two deck joints either side of it (simply supported stringers)
      const u = Math.min(b.np - 1e-12, Math.max(0, (x - b.x0) / b.dx)), i = Math.floor(u), f = u - i, W = q.m * G0;
      F[2 * i + 1] -= W * (1 - f); F[2 * (i + 1) + 1] -= W * f; Pv += W; Mv += W * (x - b.x0);
    }
    const sol = solve(b.Kf, b.free.map((i) => F[i])), u = new Array(2 * b.N).fill(0);
    b.free.forEach((i, k) => (u[i] = sol[k]));
    const reac = b.fixed.map((i) => b.K[i].reduce((a, kij, j) => a + kij * u[j], 0) - F[i]);
    const Nf = b.mem.map(([a, c], k) => { const { c: cc, s: ss, l } = b.geo[k]; return ((b.E * b.A) / l) * ((u[2 * c] - u[2 * a]) * cc + (u[2 * c + 1] - u[2 * a + 1]) * ss); });
    let resid = 0;
    b.free.forEach((i) => (resid = Math.max(resid, Math.abs(b.K[i].reduce((a, kij, j) => a + kij * u[j], 0) - F[i]))));
    const Wself = b.selfW.reduce((a, w) => a + w, 0), Mself = b.selfW.reduce((a, w, i) => a + w * (b.X[i] - b.x0), 0);
    return { u, reac, Nf, resid, Ptot: Pv + Wself, Mtot: Mv + Mself, util: Math.max(...Nf.map((x) => Math.abs(x) / b.A / b.fy)), fs: Math.min(...Nf.map((x, k) => (x < 0 ? (Math.PI ** 2 * b.E * b.I2) / b.geo[k].l ** 2 / -x : Infinity))), mid: -u[2 * (b.np / 2) + 1] };
  });
  const cols = ['t', ...V.map((q) => `${q.e.name} x (m)`), ...B.flatMap((b) => [`${b.e.name} reaction A (kN)`, `${b.e.name} reaction B (kN)`, `${b.e.name} max utilization`, `${b.e.name} midspan sag (mm)`])];
  const rows: number[][] = [], states: ReturnType<typeof solveAll>[] = [];
  let worstR = 0, worstM = 0, worstRes = 0;
  const first = B.map(() => ({ yieldT: NaN, buckleT: NaN }));
  for (let k = 0; k <= steps; k++) {
    const t = k * dt, st = solveAll(t);
    st.forEach((q, bi) => {
      worstR = Math.max(worstR, Math.abs(q.reac[1] + q.reac[2] - q.Ptot) / Math.max(1, q.Ptot));
      worstM = Math.max(worstM, Math.abs(q.reac[2] * B[bi].L - q.Mtot) / Math.max(1, q.Mtot));
      worstRes = Math.max(worstRes, q.resid / Math.max(1, q.Ptot));
      if (Number.isNaN(first[bi].yieldT) && q.util >= 1) first[bi].yieldT = t;
      if (Number.isNaN(first[bi].buckleT) && q.fs <= 1) first[bi].buckleT = t;
    });
    if (k % ev === 0 || k === steps) { rows.push([t, ...V.map((q) => q.x + q.v * t), ...st.flatMap((q) => [q.reac[1] / 1e3, q.reac[2] / 1e3, q.util, q.mid * 1e3])]); states.push(st); }
  }
  const checks: Check[] = [
    { l: 'every step: reactions A + B = total load on each bridge (relative error)', exp: 0, act: worstR, abs: 1e-9 },
    { l: 'every step: moments about A balance, R_B·L = Σ W·x (relative error)', exp: 0, act: worstM, abs: 1e-9 },
    { l: 'every step: worst joint force imbalance (relative)', exp: 0, act: worstRes, abs: 1e-9 },
  ];
  B.forEach((b, bi) => checks.push({ l: `${b.e.name}: horizontal reaction (rollers carry none)`, exp: 0, act: states[states.length - 1][bi].reac[0] / 1e3, u: 'kN', abs: 1e-6 }));
  const peakU = B.map((_, bi) => Math.max(...states.map((st) => st[bi].util))), minFS = B.map((_, bi) => Math.min(...states.map((st) => st[bi].fs)));
  const xs = [...B.flatMap((b) => [b.x0, b.x0 + b.L]), ...rows.flatMap((r) => V.map((_, i) => r[1 + i]))], ys = B.map((b) => b.y0 + b.h);
  const xl = Math.min(0, ...xs), xr = Math.max(SCENE_W * scale, ...xs), yt = Math.max(GROUND * scale * 0.5, ...ys) * 1.2;
  return {
    cols, rows, checks,
    notes: ['each bridge: pinned at its left support (where you put it), on rollers at the right · vehicles on a deck drive along it and onto the next deck if they line up · steel self-weight included', ...B.flatMap((b, bi) => [...(Number.isFinite(first[bi].yieldT) ? [`${b.e.name}: a member yields at t = ${first[bi].yieldT.toFixed(2)} s`] : []), ...(Number.isFinite(first[bi].buckleT) ? [`${b.e.name}: a member buckles at t = ${first[bi].buckleT.toFixed(2)} s`] : [])])],
    targets: B.flatMap((b, bi) => [{ l: `${b.e.name}: never yields (peak σ/fy < 1)`, hit: peakU[bi] < 1, err: peakU[bi] }, { l: `${b.e.name}: never buckles (min FS > 1)`, hit: minFS[bi] > 1, err: minFS[bi] }]),
    scalars: B.flatMap((b, bi) => [{ l: `${b.e.name}: peak utilization σ/fy`, v: peakU[bi] }, { l: `${b.e.name}: min buckling safety factor`, v: minFS[bi] }, { l: `${b.e.name}: worst midspan sag`, v: Math.max(...states.map((st) => st[bi].mid)) * 1e3, u: 'mm' }, { l: `${b.e.name}: own weight`, v: b.selfW.reduce((a, w) => a + w, 0) / 1e3, u: 'kN' }]),
    charts: [
      tchart(cols, rows, 'R', 'support reactions', B.flatMap((b) => [`${b.e.name} reaction A (kN)`, `${b.e.name} reaction B (kN)`]), 'kN'),
      tchart(cols, rows, 'u', 'worst member utilization', B.map((b) => `${b.e.name} max utilization`), 'σ/fy'),
      tchart(cols, rows, 'd', 'midspan sag', B.map((b) => `${b.e.name} midspan sag (mm)`), 'mm'),
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)], st = states[Math.min(k, states.length - 1)];
      G.view(xl, xr, -0.05 * yt, yt, 14);
      G.ground(xl, xr, 0);
      B.forEach((b, bi) => {
        const q = st[bi], mx = Math.max(1e-9, ...q.Nf.map(Math.abs)), ds = Math.max(...q.u.map(Math.abs)), sc = ds > 0 ? (0.03 * b.L) / ds : 1;
        if (b.y0 > 0) { G.line(b.x0, 0, b.x0, b.y0, COL.dim, 3); G.line(b.x0 + b.L, 0, b.x0 + b.L, b.y0, COL.dim, 3); }
        b.mem.forEach(([a, c], m) => { const f = q.Nf[m]; G.line(b.X[a] + q.u[2 * a] * sc, b.Y[a] + q.u[2 * a + 1] * sc, b.X[c] + q.u[2 * c] * sc, b.Y[c] + q.u[2 * c + 1] * sc, Math.abs(f) / b.A >= b.fy ? '#ffffff' : f > 0 ? COL.b : COL.a, 1 + 2 * (Math.abs(f) / mx)); });
        label(G, `${b.e.name}  σ/fy ${q.util.toFixed(2)}`, b.x0, b.y0 + b.h, COL.dim, -6);
      });
      V.forEach((q, i) => { const x = rw[1 + i], bi = onBridge(x, q.y); sprite(G, q.e.sprite, x, bi >= 0 ? B[bi].y0 : q.y, 2); });
      G.hud([`t=${rw[0].toFixed(2)} s  ${B.length} bridge${B.length > 1 ? 's' : ''} · ${V.length} load${V.length === 1 ? '' : 's'}`, 'orange = tension, cyan = compression, white = yielding (sag exaggerated)']);
    },
  };
}

export const trussScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'truss bridges with traffic driving across: member forces, reactions and sag follow every vehicle',
  settings: { dt: 0.05, steps: 300, method: 'rk4' }, timeBased: true,
  envDefs: [],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 1, min: 1e-3, s: 0.5, d: 'Size of one editor grid cell.' }],
  where: 'a bridge\'s left support is where you put it, spanning right · put vehicles or loads on its deck line (same height) · decks that line up form one road',
  kinds: [
    { kind: 'bridge', name: 'truss bridge', sprite: 'footbridge', desc: 'a pin-jointed steel truss', custom: [
      { k: 'type', l: 'truss type', v: 'pratt', o: ['pratt', 'warren', 'howe'], d: 'Pattern of the diagonals.' },
      { k: 'n', l: 'panels (even)', v: 6, min: 2, max: 40, s: 2, d: 'Number of bays along the span.' },
      { k: 'span', l: 'span', u: 'm', v: 24, min: 0.1, s: 1, d: 'Distance between the supports.' },
      { k: 'h', l: 'height', u: 'm', v: 4, min: 0.01, s: 0.5, d: 'Depth of the truss (deeper = smaller chord forces).' },
      { k: 'A', l: 'member area', u: 'cm2', v: 100, min: 1e-6, s: 5, d: 'Cross-section of every member (solid square for buckling).' },
      { k: 'E', l: 'Young modulus', u: 'GPa', v: 200, min: 1e-6, s: 10, d: 'Steel ≈ 200.' },
      { k: 'fy', l: 'yield strength', u: 'MPa', v: 250, min: 1e-6, s: 10, d: 'Members yield above this stress.' },
    ] },
    { kind: 'veh', name: 'vehicle or load', sprite: 'truck', desc: 'a weight on the deck, driving or parked', aim: { kind: 'len', field: 'v', per: 1 }, custom: [
      { k: 'm', l: 'mass', u: 't', v: 20, min: 0, s: 1, d: 'Weight it puts on the deck.' },
      { k: 'v', l: 'speed (→ +)', u: 'm/s', v: 10, s: 1, d: 'Driving speed (0 = parked load). Drag sideways in EDIT.' },
    ] },
  ],
  presets: [
    { name: 'footbridge', kind: 'bridge', sprite: 'footbridge', desc: 'Warren, 12 m, light', v: { type: 'warren', n: 6, span: 12, h: 2, A: 20 } },
    { name: 'railway bridge', kind: 'bridge', sprite: 'railbridge', desc: 'Pratt, 40 m, heavy', v: { type: 'pratt', n: 10, span: 40, h: 6, A: 300 } },
    { name: 'roof truss', kind: 'bridge', sprite: 'rooftruss', desc: 'Howe, 8 m', v: { type: 'howe', n: 4, span: 8, h: 2, A: 30 } },
    { name: 'lorry', kind: 'veh', sprite: 'truck', desc: '40 t at 15 m/s', v: { m: 40, v: 15 } },
    { name: 'car', kind: 'veh', sprite: 'car', desc: '1.5 t at 20 m/s', v: { m: 1.5, v: 20 } },
    { name: 'locomotive', kind: 'veh', sprite: 'train', desc: '120 t at 10 m/s', v: { m: 120, v: 10 } },
    { name: 'crowd', kind: 'veh', sprite: 'person', desc: '5 t standing still', v: { m: 5, v: 0 } },
  ],
  start: [['bridge', 8, 24], ['bridge', 32, 24, { type: 'warren' }], ['lorry', 2, 24], ['car', 20, 24, { v: -8 }]],
  tests: [
    { name: 'parked load at midspan', list: [['bridge', 20, 24], ['crowd', 32, 24]], s: { steps: 10 } },
    { name: 'locomotive over the railway bridge', list: [['railway bridge', 10, 30], ['locomotive', 4, 30]], s: { dt: 0.1, steps: 600 } },
  ],
  guide(g, X, Y, cp, p, ents) {
    g.fillStyle = '#8b5a2b'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2);
    g.strokeStyle = '#4b525c';
    for (const e of ents.filter((q) => q.k === 'bridge')) { const sc = n(p.ws_scale, 1), L = n(p[`e${e.id}_span`], 24) / sc, h = n(p[`e${e.id}_h`], 4) / sc; g.strokeRect(X(e.x), Y(e.y) - h * cp, L * cp, h * cp); }
  },
};
