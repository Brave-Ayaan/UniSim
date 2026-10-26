// Fluids, one water system: tanks stand at the height you put them; a pipe joins the tanks either side of it
// (its length and drop come from where the tanks are), drains empty the tank they sit in, and floating blocks
// bob in a tank and push its water level up. Water runs downhill through the pipes until the levels settle.
import type { Catalog } from '../catalog';
import { n, emptyScene, tchart, simulate, label, COL, GROUND, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

/** Churchill (1977) friction factor: laminar, transitional and turbulent in one formula */
export function churchill(Re: number, rel: number) {
  if (Re < 1e-9) return 0;
  const A = (2.457 * Math.log(1 / ((7 / Re) ** 0.9 + 0.27 * rel))) ** 16, B = (37530 / Re) ** 16;
  return 8 * ((8 / Re) ** 12 + 1 / (A + B) ** 1.5) ** (1 / 12);
}

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.5), rho = n(p.rho, 998), g = n(p.g, 9.80665), mu = n(p.mu, 1.0e-3);
  const tanksE = ents.filter((e) => e.kind === 'tank').sort((a, b) => a.x - b.x);
  if (!tanksE.length) return emptyScene('no tanks: press E and add one (pipes, drains and floats need a tank)');
  const T = tanksE.map((e) => { const A = Math.max(1e-6, n(e.v.A, 1)); return { e, A, w: Math.sqrt(A), x: e.x * scale, z: Math.max(0, (GROUND - e.y) * scale), H: n(e.v.Hw, 2), V0: A * Math.max(0, n(e.v.h0, 1)) }; });
  const nearTank = (e: Ent) => { let bi = 0, bd = Infinity; T.forEach((t, i) => { const d = Math.hypot(t.e.x - e.x, (t.e.y - t.H / scale / 2) - e.y); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const pipes = ents.filter((e) => e.kind === 'pipe').map((e) => {
    const L = T.map((t, i) => [t, i] as const).filter(([t]) => t.e.x <= e.x).pop(), R = T.map((t, i) => [t, i] as const).find(([t]) => t.e.x > e.x);
    if (!L || !R) return null;
    const len = Math.hypot(R[0].x - L[0].x, R[0].z - L[0].z), D = Math.max(1e-5, n(e.v.D, 50) / 1000);
    return { e, a: L[1], b: R[1], L: Math.max(1e-6, len), D, Ar: (Math.PI / 4) * D * D, rel: n(e.v.eps, 0.05) / 1000 / D, K: n(e.v.K, 1.5) };
  }).filter((q): q is NonNullable<typeof q> => !!q);
  const drains = ents.filter((e) => e.kind === 'drain').map((e) => ({ e, t: nearTank(e), a: (Math.PI / 4) * (n(e.v.d, 20) / 1000) ** 2, Cd: n(e.v.Cd, 0.61) }));
  const floats = ents.filter((e) => e.kind === 'float').map((e) => {
    const t = nearTank(e), sd = Math.max(1e-4, Math.min(n(e.v.side, 0.5), 0.95 * T[t].w)), ro = n(e.v.rhoo, 500);
    return { e, t, s: sd, m: ro * sd ** 3, ro, c: n(e.v.c, 50), z0: Math.max(0, (GROUND - e.y) * scale - T[t].z) };
  });
  const NT = T.length, NF = floats.length;
  // water level in a tank: A h = V + displaced volume of its floats (solved by bisection; it is monotone)
  const level = (i: number, V: number, y: number[]) => {
    const fl = floats.map((f, j) => [f, j] as const).filter(([f]) => f.t === i);
    if (!fl.length) return V / T[i].A;
    let lo = 0, hi = V / T[i].A + fl.reduce((a, [f]) => a + f.s, 0) + 1;
    for (let k = 0; k < 60; k++) { const h = (lo + hi) / 2, vol = T[i].A * h - fl.reduce((a, [f, j]) => a + f.s * f.s * Math.max(0, Math.min(f.s, h - y[NT + 2 * j])), 0); if (vol > V) hi = h; else lo = h; }
    return (lo + hi) / 2;
  };
  const pipeQ = (pp: (typeof pipes)[number], ha: number, hb: number) => {
    // quasi-steady pipe: head difference = (f L/D + K) V²/2g, f from Churchill; flow only from water that is there
    const Ha = T[pp.a].z + ha, Hb = T[pp.b].z + hb, dH = Ha - Hb, up = dH > 0 ? ha : hb;
    if (dH === 0 || up <= 0) return 0;
    const H = Math.abs(dH);
    let lo = 0, hi = Math.sqrt((2 * g * H) / Math.max(pp.K, 1e-3)) + 1;
    for (let k = 0; k < 60; k++) { const V = (lo + hi) / 2, f = churchill((rho * V * pp.D) / mu, pp.rel); if (((f * pp.L) / pp.D + pp.K) * V * V / (2 * g) > H) hi = V; else lo = V; }
    return Math.sign(dH) * ((lo + hi) / 2) * pp.Ar * Math.min(1, up / 1e-3);
  };
  // state: tank volumes, float (z, vz) pairs, water drained out
  const f = (_t: number, y: number[]) => {
    const d = new Array(NT + 2 * NF + 1).fill(0), h = T.map((_, i) => level(i, y[i], y));
    for (const pp of pipes) { const Q = pipeQ(pp, h[pp.a], h[pp.b]); d[pp.a] -= Q; d[pp.b] += Q; }
    // a tank filled past its rim spills over it (broad-crested weir all round the rim); the spill is lost
    T.forEach((t, i) => { if (h[i] > t.H) { const Q = 1.705 * 4 * t.w * (h[i] - t.H) ** 1.5; d[i] -= Q; d[NT + 2 * NF] += Q; } });
    for (const dr of drains) { const Q = h[dr.t] > 0 ? dr.Cd * dr.a * Math.sqrt(2 * g * h[dr.t]) : 0; d[dr.t] -= Q; d[NT + 2 * NF] += Q; }
    floats.forEach((fl, j) => {
      const z = y[NT + 2 * j], vz = y[NT + 2 * j + 1], sub = fl.s * fl.s * Math.max(0, Math.min(fl.s, h[fl.t] - z));
      d[NT + 2 * j] = vz; d[NT + 2 * j + 1] = (rho * g * sub - fl.m * g - fl.c * vz) / fl.m;
    });
    return d;
  };
  const y0 = [...T.map((t) => t.V0), ...floats.flatMap((fl) => [Math.min(fl.z0, T[fl.t].H), 0]), 0];
  const cols = ['t', ...T.map((t) => `${t.e.name} level (m)`), ...pipes.map((pp) => `${pp.e.name} flow (L/s)`), ...drains.map((dr) => `${dr.e.name} outflow (L/s)`), ...floats.map((fl) => `${fl.e.name} draft (m)`), 'water in tanks (m3)', 'drained (m3)'];
  const rows: number[][] = [];
  const rec = (t: number, y: number[]) => {
    const h = T.map((_, i) => level(i, y[i], y));
    rows.push([t, ...h, ...pipes.map((pp) => pipeQ(pp, h[pp.a], h[pp.b]) * 1000), ...drains.map((dr) => (h[dr.t] > 0 ? dr.Cd * dr.a * Math.sqrt(2 * g * h[dr.t]) * 1000 : 0)), ...floats.map((fl, j) => Math.max(0, Math.min(fl.s, h[fl.t] - y[NT + 2 * j]))), T.reduce((a, _, i) => a + y[i], 0), y[NT + 2 * NF]]);
  };
  const yE = simulate(f, y0, s, rec, undefined, (_t, y) => {
    for (let i = 0; i < NT; i++) if (y[i] < 0) { y[NT + 2 * NF] += y[i]; y[i] = 0; } // a tank can't hold less than nothing
    floats.forEach((_, j) => { if (y[NT + 2 * j] < 0) { y[NT + 2 * j] = 0; y[NT + 2 * j + 1] = Math.max(0, y[NT + 2 * j + 1]); } });
    return y;
  });
  const V0 = T.reduce((a, t) => a + t.V0, 0), last = rows[rows.length - 1];
  const checks: Check[] = [{ l: 'volume conserved: in tanks + drained & spilled = start', exp: V0, act: T.reduce((a, _, i) => a + yE[i], 0) + yE[NT + 2 * NF], u: 'm3', abs: 1e-9 * Math.max(V0, 1e-9) }];
  T.forEach((t, i) => {
    const dr = drains.filter((q) => q.t === i), alone = !pipes.some((pp) => pp.a === i || pp.b === i) && !floats.some((fl) => fl.t === i) && t.V0 / t.A <= t.H;
    if (dr.length !== 1 || !alone || t.V0 <= 0) return;
    // Torricelli: √h falls linearly: √h(t) = √h₀ − (Cd a / A)√(g/2) t
    const tEnd = last[0], r = Math.sqrt(t.V0 / t.A) - ((dr[0].Cd * dr[0].a) / t.A) * Math.sqrt(g / 2) * tEnd;
    if (r > 0.05 * Math.sqrt(t.V0 / t.A)) checks.push({ l: `${t.e.name}: level by Torricelli (√h falls linearly)`, exp: r * r, act: last[1 + i], u: 'm', tol: 1e-6 });
    checks.push({ l: `${t.e.name}: empties after (A/Cd a)√(2h₀/g)`, exp: (t.A / (dr[0].Cd * dr[0].a)) * Math.sqrt((2 * t.V0) / t.A / g), act: NaN, u: 's', ref: true });
  });
  floats.forEach((fl, j) => {
    // Archimedes: a floating block sinks until it displaces its own weight of water: draft = (ρ_block/ρ) s
    if (fl.ro >= rho) return;
    const dr = last[1 + NT + pipes.length + drains.length + j], settled = Math.abs(yE[NT + 2 * j + 1]) < 1e-6 && yE[NT + 2 * j] > 1e-9;
    checks.push({ l: `${fl.e.name}: draft = (ρ_block/ρ_water) × side (Archimedes)`, exp: (fl.ro / rho) * fl.s, act: dr, u: 'm', tol: 1e-4, ref: !settled });
  });
  checks.forEach((c) => { if (Number.isNaN(c.act)) { const i = T.findIndex((t) => c.l.startsWith(t.e.name)), k = rows.findIndex((r) => r[1 + i] <= 1e-9); c.act = k > 0 ? rows[k][0] : NaN; c.l += ' (to the nearest recorded step)'; } });
  for (let i = checks.length - 1; i >= 0; i--) if (Number.isNaN(checks[i].act)) checks.splice(i, 1);
  const zTop = Math.max(...T.map((t) => t.z + t.H), 1);
  return {
    cols, rows, checks,
    notes: ['a pipe joins the nearest tank on its left to the nearest tank on its right, bottom to bottom: its length is the distance between them · drains and floats belong to the tank they are nearest'],
    scalars: [...T.map((t, i) => ({ l: `${t.e.name}: final level`, v: last[1 + i], u: 'm' })), ...pipes.map((pp, i) => ({ l: `${pp.e.name}: peak flow`, v: Math.max(...rows.map((r) => Math.abs(r[1 + NT + i]))), u: 'L/s' })), ...pipes.map((pp) => ({ l: `${pp.e.name}: length`, v: pp.L, u: 'm' })), { l: 'water drained', v: yE[NT + 2 * NF], u: 'm3' }],
    charts: [
      tchart(cols, rows, 'h', 'water levels', T.map((t) => `${t.e.name} level (m)`), 'm'),
      tchart(cols, rows, 'Q', 'flows', [...pipes.map((pp) => `${pp.e.name} flow (L/s)`), ...drains.map((dr) => `${dr.e.name} outflow (L/s)`)], 'L/s'),
      tchart(cols, rows, 'fl', 'float drafts', floats.map((fl) => `${fl.e.name} draft (m)`), 'm'),
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(0, SCENE_W * scale, -0.03 * zTop, zTop * 1.1, 14);
      G.ground(0, SCENE_W * scale, 0);
      pipes.forEach((pp, i) => {
        const A = T[pp.a], B = T[pp.b], Q = rw[1 + NT + i];
        G.line(A.x + A.w / 2, A.z, B.x - B.w / 2, B.z, COL.dim, 4);
        label(G, `${pp.e.name} ${Q.toFixed(2)} L/s`, (A.x + B.x) / 2, (A.z + B.z) / 2, COL.c, -8);
      });
      T.forEach((t, i) => {
        const h = rw[1 + i];
        if (t.z > 0) G.line(t.x, 0, t.x, t.z, COL.dim, 2);
        G.rect(t.x - t.w / 2, t.z, t.w, Math.min(h, t.H * 3), '#2c4f8a', true);
        G.path([t.x - t.w / 2, t.x - t.w / 2, t.x + t.w / 2, t.x + t.w / 2], [t.z + t.H, t.z, t.z, t.z + t.H], COL.fg, 2);
        label(G, `${t.e.name} ${h.toFixed(3)} m`, t.x - t.w / 2, t.z + Math.max(h, t.H), COL.dim, -6);
      });
      drains.forEach((dr, i) => { const t = T[dr.t], q = rw[1 + NT + pipes.length + i]; if (q > 0) G.line(t.x, t.z, t.x, 0, COL.c, 2, [3, 3]); label(G, `${q.toFixed(2)} L/s`, t.x, t.z, COL.c, 14); });
      floats.forEach((fl, j) => { const t = T[fl.t], h = rw[1 + fl.t], dr = rw[1 + NT + pipes.length + drains.length + j], zb = h - dr; G.rect(t.x - fl.s / 2, t.z + Math.max(0, zb), fl.s, fl.s, COL.e, true); });
      G.hud([`t=${rw[0].toFixed(1)} s  ${NT} tank${NT > 1 ? 's' : ''} · ${pipes.length} pipe${pipes.length === 1 ? '' : 's'} · ${drains.length} drain${drains.length === 1 ? '' : 's'} · ${NF} float${NF === 1 ? '' : 's'}`, `water in tanks ${rw[cols.indexOf('water in tanks (m3)')].toFixed(4)} m³ · drained ${rw[cols.indexOf('drained (m3)')].toFixed(4)} m³`]);
    },
  };
}

export const fluidsScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'tanks at different heights joined by pipes, with drains and floating blocks: water flows downhill until levels settle',
  settings: { dt: 0.05, steps: 6000, method: 'rk4' }, timeBased: true,
  envDefs: [
    { k: 'rho', l: 'liquid density', u: 'kg/m3', v: 998, min: 1, s: 10, d: 'Water ≈ 998, sea water ≈ 1025, oil ≈ 900.' },
    { k: 'mu', l: 'liquid viscosity', u: 'Pa s', v: 0.001, min: 1e-9, s: 0.0001, d: 'Water at 20 °C ≈ 0.001; honey ≈ 5.' },
    { k: 'g', l: 'gravity', u: 'm/s2', v: 9.80665, s: 0.1, d: 'Acceleration of free fall.' },
  ],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.5, min: 1e-3, s: 0.1, d: 'Size of one editor grid cell: sets tank heights and pipe lengths.' }],
  where: 'a tank\'s bottom sits where you put it (higher = more head) · a pipe joins the tanks to its left and right · drains and floats act on the tank they are nearest',
  kinds: [
    { kind: 'tank', name: 'tank', sprite: 'watertower', desc: 'an open tank, its bottom here', custom: [
      { k: 'A', l: 'floor area', u: 'm2', v: 1, min: 1e-6, s: 0.5, d: 'Horizontal cross-section of the tank.' },
      { k: 'h0', l: 'start depth', u: 'm', v: 1, min: 0, s: 0.1, d: 'Water depth at the start.' },
      { k: 'Hw', l: 'wall height', u: 'm', v: 2, min: 0.01, s: 0.5, d: 'Height of the tank walls: water above the rim spills over and is lost.' },
    ] },
    { kind: 'pipe', name: 'pipe', sprite: 'hose', desc: 'joins the tanks either side of it', custom: [
      { k: 'D', l: 'inner diameter', u: 'mm', v: 50, min: 0.01, s: 5, d: 'Pipe bore.' },
      { k: 'eps', l: 'wall roughness', u: 'mm', v: 0.05, min: 0, s: 0.01, d: 'Plastic ≈ 0.0015, steel ≈ 0.05, cast iron ≈ 0.26.' },
      { k: 'K', l: 'entry + exit losses K', v: 1.5, min: 0, s: 0.1, d: 'Minor losses (sharp entry 0.5 + exit 1).' },
    ] },
    { kind: 'drain', name: 'drain hole', sprite: 'drain', desc: 'a hole in the bottom of the nearest tank', custom: [
      { k: 'd', l: 'hole diameter', u: 'mm', v: 20, min: 0.01, s: 2, d: 'Diameter of the hole.' },
      { k: 'Cd', l: 'discharge coefficient', v: 0.61, min: 0, max: 1, s: 0.01, d: 'Sharp-edged hole ≈ 0.61, rounded ≈ 0.98.' },
    ] },
    { kind: 'float', name: 'floating block', sprite: 'boat', desc: 'a cube floating in the nearest tank', custom: [
      { k: 'side', l: 'size', u: 'm', v: 0.4, min: 1e-4, s: 0.05, d: 'Edge of the cube.' },
      { k: 'rhoo', l: 'density', u: 'kg/m3', v: 500, min: 1, s: 50, d: 'Wood ≈ 500, ice ≈ 917. Denser than the liquid sinks.' },
      { k: 'c', l: 'water damping', u: 'N s/m', v: 50, min: 0, s: 10, d: 'Resistance to bobbing.' },
    ] },
  ],
  presets: [
    { name: 'water tower', kind: 'tank', sprite: 'watertower', desc: '50 m², 10 m of water', v: { A: 50, h0: 10, Hw: 12 } },
    { name: 'rain barrel', kind: 'tank', sprite: 'barrel', desc: '0.3 m², 0.8 m deep', v: { A: 0.3, h0: 0.8, Hw: 1 } },
    { name: 'garden hose', kind: 'pipe', sprite: 'hose', desc: '16 mm bore', v: { D: 16, eps: 0.0015, K: 1.5 } },
    { name: 'water main', kind: 'pipe', sprite: 'pipe', desc: '200 mm cast iron', v: { D: 200, eps: 0.26, K: 1.5 } },
    { name: 'bath plug', kind: 'drain', sprite: 'drain', desc: '40 mm hole', v: { d: 40, Cd: 0.61 } },
    { name: 'wooden block', kind: 'float', sprite: 'crate', desc: 'pine, 600 kg/m³', v: { side: 0.3, rhoo: 600, c: 50 } },
    { name: 'ice cube (big)', kind: 'float', sprite: 'iceberg', desc: 'ice, 917 kg/m³', v: { side: 0.3, rhoo: 917, c: 50 } },
  ],
  start: [['tank', 10, 20, { A: 1, h0: 1.5 }], ['garden hose', 22, 26], ['tank', 34, 30, { A: 2, h0: 0.2 }], ['wooden block', 34, 26], ['bath plug', 50, 32], ['rain barrel', 50, 32]],
  tests: [
    { name: 'Torricelli tank', list: [['tank', 32, 30, { A: 1, h0: 2 }], ['drain', 32, 30]], s: { dt: 0.1, steps: 2000 } },
    { name: 'two tanks level out', list: [['tank', 10, 30, { h0: 1.5 }], ['pipe', 20, 30], ['tank', 30, 30, { h0: 0.1 }]], s: { dt: 0.1, steps: 3000 } },
    { name: 'float settles', list: [['tank', 32, 30, { A: 2, h0: 1 }], ['wooden block', 32, 30]], s: { dt: 0.002, steps: 20000 } },
  ],
  guide(g, X, Y, cp) { g.fillStyle = '#8b5a2b'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2); },
};
