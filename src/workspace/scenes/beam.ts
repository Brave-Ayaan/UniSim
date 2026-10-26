// Beams, one side view: beams are placed where they span, loads (people, crates, a car) sit on the beam
// directly below them and can walk along it, extra props under a beam support it. Everything on one beam acts
// together (finite elements, exact at the nodes); deflection, bending moment and stress follow.
import type { Catalog } from '../catalog';
import { G0 } from '../../core/num';
import { n, str, emptyScene, tchart, sprite, label, heatCol, sceneView, GROUND, SCENE_W, COL, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const MAT: Record<string, { E: number; rho: number; sy: number }> = {
  steel: { E: 200e9, rho: 7850, sy: 250e6 }, aluminium: { E: 69e9, rho: 2700, sy: 270e6 },
  timber: { E: 11e9, rho: 500, sy: 40e6 }, fibreglass: { E: 25e9, rho: 1900, sy: 200e6 }, concrete: { E: 30e9, rho: 2400, sy: 3e6 },
};
const SUP = ['simply supported', 'cantilever', 'fixed both ends'];

/** dense Cholesky factor of a symmetric positive-definite matrix (in place, lower) */
function chol(A: number[][]) {
  const N = A.length;
  for (let j = 0; j < N; j++) {
    let d = A[j][j];
    for (let k = 0; k < j; k++) d -= A[j][k] * A[j][k];
    if (!(d > 0)) throw new Error('beam is not held up (add a support or change its type)');
    A[j][j] = Math.sqrt(d);
    for (let i = j + 1; i < N; i++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= A[i][k] * A[j][k]; A[i][j] = s / A[j][j]; }
  }
  return (b: number[]) => {
    const y = b.slice();
    for (let i = 0; i < N; i++) { for (let k = 0; k < i; k++) y[i] -= A[i][k] * y[k]; y[i] /= A[i][i]; }
    for (let i = N - 1; i >= 0; i--) { for (let k = i + 1; k < N; k++) y[i] -= A[k][i] * y[k]; y[i] /= A[i][i]; }
    return y;
  };
}

interface BeamModel { e: Ent; L: number; x0: number; y0: number; EI: number; q: number; sy: number; c: number; I: number; sup: string; props: number[]; nodes: number[]; solve: (loads: [number, number][]) => { u: number[]; R: [number, number][]; Rm: number[] } }

function model(e: Ent, scale: number, props: number[]): BeamModel {
  const L = n(e.v.L, 4), m = MAT[str(e.v.mat, 'timber')] ?? MAT.timber, b = n(e.v.b, 100) / 1e3, h = n(e.v.h, 200) / 1e3;
  const I = (b * h ** 3) / 12, EI = m.E * I, q = m.rho * G0 * b * h, sup = str(e.v.sup, SUP[0]);
  const x0 = e.x * scale, y0 = (GROUND - e.y) * scale;
  const nodes = [...new Set([...Array(61).keys()].map((i) => (L * i) / 60).concat(props).map((x) => +x.toFixed(9)))].sort((a, c) => a - c);
  const N = nodes.length, D = 2 * N;
  const K = [...Array(D)].map(() => new Array(D).fill(0)), fq = new Array(D).fill(0);
  for (let i = 0; i < N - 1; i++) {
    const l = nodes[i + 1] - nodes[i], k = EI / l ** 3, ix = [2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3];
    const ke = [[12, 6 * l, -12, 6 * l], [6 * l, 4 * l * l, -6 * l, 2 * l * l], [-12, -6 * l, 12, -6 * l], [6 * l, 2 * l * l, -6 * l, 4 * l * l]];
    for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) K[ix[a]][ix[c]] += k * ke[a][c];
    const fe = [-q * l / 2, -q * l * l / 12, -q * l / 2, q * l * l / 12]; // self-weight, downward
    for (let a = 0; a < 4; a++) fq[ix[a]] += fe[a];
  }
  const fixed = new Set<number>();
  const pin = (x: number) => fixed.add(2 * nodes.indexOf(+x.toFixed(9)));
  if (sup === 'cantilever') { fixed.add(0); fixed.add(1); }
  else if (sup === 'fixed both ends') { fixed.add(0); fixed.add(1); fixed.add(D - 2); fixed.add(D - 1); }
  else { pin(0); pin(L); }
  for (const x of props) pin(x);
  const free = [...Array(D).keys()].filter((d) => !fixed.has(d));
  const back = chol(free.map((i) => free.map((j) => K[i][j])));
  const solve = (loads: [number, number][]) => {
    const f = fq.slice();
    for (const [x, P] of loads) {
      let i = 0;
      while (i < N - 2 && nodes[i + 1] <= x) i++;
      const l = nodes[i + 1] - nodes[i], xi = Math.min(1, Math.max(0, (x - nodes[i]) / l));
      const Nn = [1 - 3 * xi ** 2 + 2 * xi ** 3, l * (xi - 2 * xi ** 2 + xi ** 3), 3 * xi ** 2 - 2 * xi ** 3, l * (-(xi ** 2) + xi ** 3)];
      for (let a = 0; a < 4; a++) f[2 * i + a] -= P * Nn[a];
    }
    const uf = back(free.map((d) => f[d])), u = new Array(D).fill(0);
    free.forEach((d, k) => (u[d] = uf[k]));
    // reactions at the supported degrees of freedom: R = K u − f
    const R: [number, number][] = [...fixed].filter((d) => d % 2 === 0).map((d) => [nodes[d / 2], K[d].reduce((a, kk, j) => a + kk * u[j], 0) - f[d]]);
    const Rm = [...fixed].filter((d) => d % 2 === 1).map((d) => K[d].reduce((a, kk, j) => a + kk * u[j], 0) - f[d]);
    return { u, R, Rm };
  };
  return { e, L, x0, y0, EI, q, sy: m.sy, c: h / 2, I, sup, props, nodes, solve };
}

/** closed-form deflection (up positive) at x for point loads + self-weight: simply supported or cantilever */
function closed(bm: BeamModel, loads: [number, number][], x: number) {
  const { L, EI, q } = bm;
  let w = 0;
  if (bm.sup === 'cantilever') {
    for (const [a, P] of loads) w -= x <= a ? (P * x * x * (3 * a - x)) / (6 * EI) : (P * a * a * (3 * x - a)) / (6 * EI);
    w -= (q * x * x * (6 * L * L - 4 * L * x + x * x)) / (24 * EI);
  } else {
    for (const [a, P] of loads) { const b = L - a; w -= x <= a ? (P * b * x * (L * L - b * b - x * x)) / (6 * EI * L) : (P * a * (L - x) * (2 * L * x - x * x - a * a)) / (6 * EI * L); }
    w -= (q * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EI);
  }
  return w;
}

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.1);
  const beams = ents.filter((e) => e.kind === 'beam'), loads = ents.filter((e) => e.kind === 'load'), props = ents.filter((e) => e.kind === 'prop');
  if (!beams.length) return emptyScene('no beam: press E and add one, then put loads on top of it');
  const notes: string[] = [];
  const span = (b: Ent) => [b.x * scale, b.x * scale + n(b.v.L, 4)];
  // a load rests on the highest beam below it that spans its x; a prop holds up the lowest beam above it
  const under = (e: Ent, below: boolean) => beams.filter((b) => { const [a, c] = span(b); const x = e.x * scale; return x >= a - 1e-9 && x <= c + 1e-9 && (below ? b.y > e.y - 0.5 : b.y < e.y + 0.5); }).sort((a, b) => (below ? a.y - b.y : b.y - a.y))[0];
  const propOf = new Map<Ent, number[]>(beams.map((b) => [b, []]));
  for (const pr of props) { const b = under(pr, false); if (b) propOf.get(b)!.push(pr.x * scale - b.x * scale); else notes.push(`${pr.name} is not under a beam`); }
  const models = beams.map((b) => model(b, scale, propOf.get(b)!));
  const T = s.dt * s.steps;
  // walking loads: position along the beam at time t (they step off at the ends)
  const placed = loads.map((e) => ({ e, P: n(e.v.m, 80) * G0, v: n(e.v.walk, 0), b: under(e, true) }));
  for (const q of placed) if (!q.b) notes.push(`${q.e.name} is not above any beam: it rests on the ground`);
  const loadsAt = (bm: BeamModel, t: number): [number, number][] => placed.filter((q) => q.b === bm.e).map((q) => [q.e.x * scale + q.v * t - bm.x0, q.P] as [number, number]).filter(([x]) => x >= 0 && x <= bm.L);
  const xs = (bm: BeamModel) => bm.nodes;
  const momentAt = (bm: BeamModel, R: [number, number][], Rm: number[], ld: [number, number][], x: number) => {
    // bending moment by statics from the left end (sagging positive)
    let M = 0;
    for (const [xr, F] of R) if (xr <= x) M += F * (x - xr);
    for (const [xa, P] of ld) if (xa <= x) M -= P * (x - xa);
    M -= (bm.q * x * x) / 2;
    if (Rm.length) M -= Rm[0];
    return M;
  };
  const cols = ['t', ...models.flatMap((bm) => [`${bm.e.name} max deflection (mm)`, `${bm.e.name} max moment (kN m)`, `${bm.e.name} max stress (MPa)`, `${bm.e.name} support force (kN)`])];
  const rows: number[][] = [];
  const frames: { u: number[]; M: number[]; ld: [number, number][] }[][] = [];
  const nrec = Math.min(400, Math.max(1, s.steps));
  let worst = models.map(() => ({ s: 0, t: 0 }));
  for (let k = 0; k <= nrec; k++) {
    const t = (T * k) / nrec, row = [t], fr: { u: number[]; M: number[]; ld: [number, number][] }[] = [];
    models.forEach((bm, bi) => {
      const ld = loadsAt(bm, t), r = bm.solve(ld);
      const M = xs(bm).map((x) => momentAt(bm, r.R, r.Rm, ld, x)).concat(ld.map(([x]) => momentAt(bm, r.R, r.Rm, ld, x)));
      const Mmax = Math.max(...M.map(Math.abs)), wmax = Math.max(...r.u.filter((_, i) => i % 2 === 0).map(Math.abs));
      const sig = (Mmax * bm.c) / bm.I;
      if (sig > worst[bi].s) worst[bi] = { s: sig, t };
      row.push(wmax * 1e3, Mmax / 1e3, sig / 1e6, r.R.reduce((a, q) => a + q[1], 0) / 1e3);
      fr.push({ u: r.u, M: xs(bm).map((x) => momentAt(bm, r.R, r.Rm, ld, x)), ld });
    });
    rows.push(row); frames.push(fr);
  }
  // checks at t = 0: equilibrium for every beam, closed-form superposition where it applies
  const checks: Check[] = [];
  models.forEach((bm) => {
    const ld = loadsAt(bm, 0), r = bm.solve(ld);
    const W = ld.reduce((a, q) => a + q[1], 0) + bm.q * bm.L;
    checks.push({ l: `${bm.e.name}: support forces = total weight`, exp: W, act: r.R.reduce((a, q) => a + q[1], 0), u: 'N', tol: 1e-9 });
    const Mo = ld.reduce((a, q) => a + q[0] * q[1], 0) + (bm.q * bm.L * bm.L) / 2;
    checks.push({ l: `${bm.e.name}: moments about the left end balance`, exp: Mo, act: r.R.reduce((a, q) => a + q[0] * q[1], 0) + r.Rm.reduce((a, q) => a + q, 0), u: 'N m', tol: 1e-9 });
    if (!bm.props.length && bm.sup !== 'fixed both ends') {
      let best = 0;
      bm.nodes.forEach((_, i) => { if (Math.abs(r.u[2 * i]) > Math.abs(r.u[2 * best])) best = i; });
      checks.push({ l: `${bm.e.name}: deflection vs textbook superposition (${bm.sup})`, exp: closed(bm, ld, bm.nodes[best]) * 1e3, act: r.u[2 * best] * 1e3, u: 'mm', tol: 1e-6 });
    }
  });
  const scalars = models.flatMap((bm, i) => [
    { l: `${bm.e.name}: worst stress`, v: worst[i].s / 1e6, u: 'MPa' }, { l: `${bm.e.name}: safety factor (yield)`, v: bm.sy / Math.max(worst[i].s, 1e-9) },
    { l: `${bm.e.name}: self-weight`, v: bm.q * bm.L / G0, u: 'kg' }, { l: `${bm.e.name}: bending stiffness EI`, v: bm.EI / 1e3, u: 'kN m²' },
  ]);
  models.forEach((bm, i) => { if (worst[i].s > bm.sy) notes.push(`${bm.e.name} is overloaded: stress ${(worst[i].s / 1e6).toFixed(1)} MPa > yield ${(bm.sy / 1e6).toFixed(0)} MPa at t = ${worst[i].t.toFixed(2)} s`); });
  const wAll = Math.max(1e-12, ...rows.flatMap((r) => models.map((_, i) => r[1 + 4 * i])));
  const exag = Math.max(1, (1.2 * scale * 1e3) / wAll);
  notes.unshift(`side view · deflection drawn ×${exag.toPrecision(2)} · loads rest on the beam directly below them, props hold up the beam directly above them`);
  return {
    cols, rows, checks, scalars, notes,
    charts: [
      tchart(cols, rows, 'defl', 'max deflection', models.map((bm) => `${bm.e.name} max deflection (mm)`), 'mm'),
      tchart(cols, rows, 'stress', 'max bending stress', models.map((bm) => `${bm.e.name} max stress (MPa)`), 'MPa'),
      { id: 'moment', title: 'bending moment along each beam (t = 0)', xl: 'x along beam (m)', yl: 'kN m', series: models.map((bm, i) => ({ name: bm.e.name, x: bm.nodes, y: frames[0][i].M.map((M) => M / 1e3) })) },
    ],
    draw(G: Gfx, k: number) {
      const fi = Math.min(frames.length - 1, Math.round((k / Math.max(1, rows.length - 1)) * (frames.length - 1))), fr = frames[fi], t = rows[fi][0];
      sceneView(G, scale);
      G.ground(0, SCENE_W * scale, 0);
      models.forEach((bm, i) => {
        const { u, M, ld } = fr[i], Mm = Math.max(1e-9, ...M.map(Math.abs));
        const X = bm.nodes.map((x) => bm.x0 + x), Y = bm.nodes.map((_, j) => bm.y0 + exag * u[2 * j]);
        for (let j = 0; j < X.length - 1; j++) G.line(X[j], Y[j], X[j + 1], Y[j + 1], heatCol(Math.abs(M[j]) / Mm), 4);
        const tri = (x: number, y: number, c: string) => G.path([x, x - 0.15 * scale * 3, x + 0.15 * scale * 3, x], [y, y - 0.3 * scale * 3, y - 0.3 * scale * 3, y], c, 1, true);
        if (bm.sup === 'simply supported') { tri(bm.x0, bm.y0, COL.fg); tri(bm.x0 + bm.L, bm.y0, COL.fg); }
        else { G.line(bm.x0, bm.y0 - 2 * scale, bm.x0, bm.y0 + 2 * scale, COL.fg, 4); if (bm.sup === 'fixed both ends') G.line(bm.x0 + bm.L, bm.y0 - 2 * scale, bm.x0 + bm.L, bm.y0 + 2 * scale, COL.fg, 4); }
        for (const xp of bm.props) { G.line(bm.x0 + xp, 0, bm.x0 + xp, bm.y0, COL.dim, 3); tri(bm.x0 + xp, bm.y0, COL.dim); }
        for (const [xa] of ld) {
          const j = Math.max(0, bm.nodes.findIndex((x) => x >= xa)), q = placed.find((z) => z.b === bm.e && Math.abs(z.e.x * scale + z.v * t - bm.x0 - xa) < 1e-9);
          if (q) sprite(G, q.e.sprite, bm.x0 + xa, Y[j], 2);
        }
        label(G, `${bm.e.name}  ${rows[fi][1 + 4 * i].toFixed(2)} mm · ${rows[fi][3 + 4 * i].toFixed(1)} MPa`, bm.x0, bm.y0, COL.dim, 22);
      });
      for (const q of placed) if (!q.b) sprite(G, q.e.sprite, q.e.x * scale, 0, 2);
      G.hud([`t=${t.toFixed(2)} s   ${models.length} beam${models.length > 1 ? 's' : ''} · ${placed.length} load${placed.length === 1 ? '' : 's'} · ${props.length} prop${props.length === 1 ? '' : 's'}`, 'colour = bending moment (blue low → red high)']);
    },
  };
}

export const beamScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'beams, props and loads in one side view: people and crates rest or walk on the beam below them; FE deflection, moment, stress',
  settings: { dt: 0.01, steps: 400, method: 'rk4' }, timeBased: true,
  envDefs: [],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.1, min: 0.001, s: 0.02, d: 'Size of one editor grid cell.' }],
  where: 'a beam starts at its left end (where you put it) · loads rest on the beam right below them · props hold up the beam right above them · drag a load sideways to make it walk',
  kinds: [
    { kind: 'beam', name: 'beam', sprite: 'ibeam', desc: 'a beam (left end at its position)', custom: [
      { k: 'sup', l: 'supports', v: SUP[0], o: SUP, d: 'simply supported = resting on both ends; cantilever = built into a wall at the left end; fixed both ends = built in at both ends.' },
      { k: 'L', l: 'length', u: 'm', v: 4, min: 0.05, s: 0.1, d: 'Span of the beam.' },
      { k: 'mat', l: 'material', v: 'timber', o: Object.keys(MAT), d: 'Sets stiffness E, density and yield strength.' },
      { k: 'b', l: 'section width', u: 'mm', v: 100, min: 1, s: 10, d: 'Width of the rectangular cross-section.' },
      { k: 'h', l: 'section depth', u: 'mm', v: 200, min: 1, s: 10, d: 'Depth (height) of the cross-section: stiffness grows with h³.' },
    ] },
    { kind: 'load', name: 'load', sprite: 'person', desc: 'a weight resting on the beam below', aim: { kind: 'len', field: 'walk', per: 0.25 }, custom: [
      { k: 'm', l: 'mass', u: 'kg', v: 80, min: 0, s: 10, d: 'Its weight m·g pushes on the beam.' },
      { k: 'walk', l: 'walking speed', u: 'm/s', v: 0, s: 0.1, d: 'Moves along the beam (+ = right); it steps off at the end.' },
    ] },
    { kind: 'prop', name: 'prop', sprite: 'post', desc: 'an extra support under a beam', custom: [] },
  ],
  presets: [
    { name: 'diving board', kind: 'beam', sprite: 'divingboard', desc: 'fibreglass cantilever 4.8 m', v: { sup: 'cantilever', L: 4.8, mat: 'fibreglass', b: 500, h: 60 } },
    { name: 'bookshelf', kind: 'beam', sprite: 'shelf', desc: '1 m pine shelf', v: { sup: 'simply supported', L: 1, mat: 'timber', b: 250, h: 20 } },
    { name: 'floor joist', kind: 'beam', sprite: 'joist', desc: '4 m timber joist', v: { sup: 'simply supported', L: 4, mat: 'timber', b: 50, h: 200 } },
    { name: 'steel I-beam (as solid)', kind: 'beam', sprite: 'ibeam', desc: '6 m steel', v: { sup: 'fixed both ends', L: 6, mat: 'steel', b: 100, h: 250 } },
    { name: 'person walking', kind: 'load', sprite: 'person', desc: '80 kg at 1.4 m/s', v: { m: 80, walk: 1.4 } },
    { name: 'crate', kind: 'load', sprite: 'crate', desc: '200 kg', v: { m: 200, walk: 0 } },
    { name: 'stack of books', kind: 'load', sprite: 'books', desc: '15 kg', v: { m: 15, walk: 0 } },
  ],
  start: [['beam', 12, 22], ['load', 30, 18]],
  tests: [
    { name: 'cantilever with two loads', list: [['beam', 12, 22, { sup: 'cantilever' }], ['load', 30, 18], ['crate', 45, 18]] },
    { name: 'propped beam, walking person', list: [['beam', 12, 22], ['prop', 32, 28], ['person walking', 14, 18]] },
    { name: 'two beams stacked', list: [['beam', 8, 16, { L: 3 }], ['beam', 20, 26, { L: 3 }], ['load', 15, 12], ['load', 30, 22]] },
  ],
  guide(g, X, Y, cp, p, ents) {
    const sc = n(p.ws_scale, 0.1);
    g.fillStyle = '#8b5a2b'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2);
    for (const b of ents.filter((e) => e.k === 'beam')) { const L = n(p[`e${b.id}_L`], 4) / sc; g.fillStyle = '#c9a227'; g.fillRect(X(b.x), Y(b.y) - 2, L * cp, 4); }
  },
};
