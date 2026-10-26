// Fracture, one load path: parts stacked in a column hang from the ceiling one under the other, and the load at
// the bottom pulls on all of them at once — so the weakest link breaks first and everything below it falls.
// Bars stretch (Ramberg–Osgood) and neck at their tensile strength; a plate with a bolt hole sees the stress
// concentration Kt; a cracked plate breaks when K reaches K_IC, and a cycling load grows its crack (Paris law).
import type { Catalog } from '../catalog';
import { G0 } from '../../core/num';
import { n, str, emptyScene, tchart, label, heatCol, COL, SCENE_W, SCENE_H, every, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const MAT: Record<string, { E: number; sy: number; su: number; nRO: number; KIC: number; C: number; m: number }> = {
  'structural steel': { E: 210e3, sy: 355, su: 510, nRO: 10, KIC: 50, C: 6.9e-12, m: 3 },
  'high-strength wire': { E: 200e3, sy: 1500, su: 1770, nRO: 20, KIC: 60, C: 5e-12, m: 3 },
  'aluminium 2024': { E: 73e3, sy: 345, su: 483, nRO: 15, KIC: 30, C: 1.6e-11, m: 3.2 },
  'copper': { E: 117e3, sy: 70, su: 220, nRO: 5, KIC: 100, C: 1e-11, m: 3 },
  'cast iron': { E: 110e3, sy: 200, su: 250, nRO: 30, KIC: 15, C: 5e-11, m: 3.5 },
};
const GEOS = ['edge crack, wide plate (Y = 1.12)', 'edge crack, finite width'];
const Yedge = (a: number, W: number, geo: string) => { if (geo === GEOS[0]) return 1.12; const r = Math.min(a / W, 0.95); return 1.12 - 0.231 * r + 10.55 * r ** 2 - 21.72 * r ** 3 + 30.39 * r ** 4; };
/** Heywood/Peterson Kt for a central hole in a finite-width plate, on the net-section stress */
const KtHole = (d: number, W: number) => { const r = 1 - d / W; return 2 + 0.284 * r - 0.6 * r * r + 1.32 * r ** 3; };

interface Part { e: Ent; k: string; mat: (typeof MAT)[string]; A: number; W: number; t: number; d: number; a: number; geo: string; L: number; failT: number; failMode: string; yieldT: number }

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const all = ents.filter((e) => ['bar', 'holed', 'cracked', 'weight'].includes(e.kind)).sort((a, b) => a.x - b.x);
  if (!all.some((e) => e.kind === 'weight')) return emptyScene('nothing pulls on the parts: press E and hang a weight under them');
  // columns: everything within 2 cells sideways hangs in one chain from the ceiling
  const colsE: Ent[][] = [];
  for (const e of all) { const c = colsE.find((q) => Math.abs(q[0].x - e.x) <= 2); if (c) c.push(e); else colsE.push([e]); }
  const chains = colsE.map((list) => {
    const parts: Part[] = list.filter((e) => e.kind !== 'weight').sort((a, b) => a.y - b.y).map((e) => {
      const mat = MAT[str(e.v.mat, 'structural steel')] ?? MAT['structural steel'];
      const W = n(e.v.W, 50), t = n(e.v.t, 5), d = Math.min(n(e.v.d, 10), 0.95 * W);
      const A = e.kind === 'bar' ? n(e.v.A, 50) : e.kind === 'holed' ? (W - d) * t : W * t;
      return { e, k: e.kind, mat, A, W, t, d, a: n(e.v.a0, 2), geo: str(e.v.geo, GEOS[0]), L: n(e.v.L, 1000), failT: NaN, failMode: '', yieldT: NaN };
    });
    const ws = list.filter((e) => e.kind === 'weight');
    const lowest = Math.max(...parts.map((q) => q.e.y), -Infinity);
    // only weights hanging below the lowest part load the chain (one above would just sit on the chain)
    const loads = ws.filter((w) => !parts.length || w.y > lowest);
    return { parts, loads, x: list[0].x, broken: NaN, at: -1 };
  });
  const F = (ch: (typeof chains)[number], t: number, peak = true) => ch.loads.reduce((a, w) => a + n(w.v.m, 100) * G0 + n(w.v.rate, 10) * t + (peak ? 1 : 0) * Math.abs(n(w.v.Famp, 0)), 0);
  const Fmin = (ch: (typeof chains)[number], t: number) => ch.loads.reduce((a, w) => a + n(w.v.m, 100) * G0 + n(w.v.rate, 10) * t - Math.abs(n(w.v.Famp, 0)), 0);
  const cyc = (ch: (typeof chains)[number]) => ch.loads.reduce((a, w) => (Math.abs(n(w.v.Famp, 0)) > 0 ? Math.max(a, n(w.v.f, 10)) : a), 0);
  // failure force of a part at its current crack length
  const strength = (q: Part, a = q.a) => {
    if (q.k === 'bar' || q.k === 'holed') return q.mat.su * q.A; // ductile: net section reaches the tensile strength
    // brittle: K = Yσ√(πa) reaches K_IC (a in m), unless the remaining ligament tears first
    const fr = (q.mat.KIC / (Yedge(a, q.W, q.geo) * Math.sqrt((Math.PI * a) / 1000))) * q.W * q.t, ny = q.mat.su * (q.W - a) * q.t;
    return Math.min(fr, ny);
  };
  const stressOf = (q: Part, Fn: number) => (q.k === 'holed' ? KtHole(q.d, q.W) * Fn / q.A : Fn / q.A);
  const dt = s.dt, steps = s.steps, ev = every(steps);
  const P = chains.flatMap((c) => c.parts);
  const cols = ['t', ...chains.map((_, i) => `chain ${i + 1} force (N)`), ...P.flatMap((q) => [`${q.e.name} stress (MPa)`, q.k === 'cracked' ? `${q.e.name} crack (mm)` : `${q.e.name} strain (%)`])];
  const rows: number[][] = [];
  const rec = (t: number) => rows.push([t, ...chains.map((c) => (Number.isNaN(c.broken) ? F(c, t) : 0)), ...P.flatMap((q) => {
    const ch = chains.find((c) => c.parts.includes(q))!, Fn = Number.isNaN(ch.broken) ? F(ch, t) : 0, sg = stressOf(q, Fn);
    return [sg, q.k === 'cracked' ? q.a : 100 * (Fn / q.A / q.mat.E + 0.002 * (Math.max(0, Fn / q.A) / q.mat.sy) ** q.mat.nRO)];
  })]);
  rec(0);
  for (let k = 1; k <= steps; k++) {
    const t0 = (k - 1) * dt, t1 = k * dt;
    for (const ch of chains) {
      if (!Number.isNaN(ch.broken)) continue;
      const f = cyc(ch);
      // fatigue: da/dt = f · C · ΔK^m, ΔK from the tension part of the cycle (rk4 over the step)
      const aOld = ch.parts.map((q) => q.a);
      if (f > 0) for (const q of ch.parts) if (q.k === 'cracked') {
        const rate = (a: number, t: number) => { const dS = Math.max(0, F(ch, t)) - Math.max(0, Fmin(ch, t)), dK = Yedge(a, q.W, q.geo) * (dS / (q.W * q.t)) * Math.sqrt(Math.PI * a / 1000); return f * q.mat.C * dK ** q.mat.m * 1000; };
        const a = q.a, k1 = rate(a, t0), k2 = rate(a + (dt / 2) * k1, t0 + dt / 2), k3 = rate(a + (dt / 2) * k2, t0 + dt / 2), k4 = rate(a + dt * k3, t1);
        q.a = Math.min(0.999 * q.W, a + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4));
      }
      // the weakest link: first part whose strength the peak load reaches; time interpolated within the step
      let first: Part | null = null, tf = Infinity;
      for (const q of ch.parts) {
        const S1 = strength(q), Fa = F(ch, t0), Fb = F(ch, t1);
        if (Fb >= S1) {
          let tt = Fb > Fa ? t0 + ((S1 - Fa) / (Fb - Fa)) * dt : t1;
          const a0 = aOld[ch.parts.indexOf(q)];
          if (q.k === 'cracked' && q.a > a0 && strength(q, a0) > Fb) {
            // the crack grew to critical within the step: find that length, and the time by interpolation
            let lo = a0, hi = q.a;
            for (let it = 0; it < 80; it++) { const mid = (lo + hi) / 2; if (strength(q, mid) > Fb) lo = mid; else hi = mid; }
            tt = t0 + (dt * ((lo + hi) / 2 - a0)) / (q.a - a0); q.a = (lo + hi) / 2;
          }
          if (tt < tf) { tf = Math.max(t0, tt); first = q; }
        }
        if (Number.isNaN(q.yieldT) && stressOf(q, Fb) >= q.mat.sy) q.yieldT = t1;
      }
      if (first) { first.failT = tf; first.failMode = first.k === 'cracked' ? (strength(first) < first.mat.su * (first.W - first.a) * first.t ? 'fracture (K = K_IC)' : 'net-section yield') : first.k === 'holed' ? 'net section tore' : 'necked and snapped'; ch.broken = tf; ch.at = ch.parts.indexOf(first); }
    }
    if (k % ev === 0 || k === steps) rec(t1);
  }
  const checks: Check[] = [];
  chains.forEach((ch, ci) => {
    if (!ch.parts.length || !ch.loads.length) return;
    const f = cyc(ch), F0 = F(ch, 0), slope = F(ch, 1) - F0;
    // σ = F/A at the start
    ch.parts.filter((q) => q.k === 'bar').forEach((q) => checks.push({ l: `${q.e.name}: stress σ = F/A`, exp: F0 / q.A, act: rows[0][1 + chains.length + 2 * P.indexOf(q)], u: 'MPa' }));
    if (f === 0 && slope > 0) {
      // ramped load: the first part to go is the one with the lowest failure force
      const weakest = Math.min(...ch.parts.map((q) => strength(q))), tExp = Math.max(0, (weakest - F0) / slope);
      if (tExp <= steps * dt) checks.push({ l: `chain ${ci + 1}: breaks when the load reaches the weakest part's strength`, exp: tExp, act: ch.broken, u: 's', tol: 1e-9, abs: 1e-9 });
    }
    const cr = ch.parts.filter((q) => q.k === 'cracked');
    if (f > 0 && cr.length === 1 && cr[0].geo === GEOS[0] && ch.parts.length === 1 && slope === 0 && Number.isFinite(cr[0].failT)) {
      // Paris law with constant Y: N = (a_c^(1−m/2) − a₀^(1−m/2)) / ((1−m/2) C (YΔσ√π)^m)
      const q = cr[0], Smax = F0 / (q.W * q.t), dS = (Math.max(0, F0) - Math.max(0, Fmin(ch, 0))) / (q.W * q.t), Y = 1.12, m = q.mat.m, C = q.mat.C;
      const ac = ((q.mat.KIC / (Y * Smax)) ** 2 / Math.PI) * 1000, a0 = n(q.e.v.a0, 2);
      const acc = Math.min(ac, q.W - (F0 / (q.mat.su * q.t)));
      const Nf = ((acc / 1000) ** (1 - m / 2) - (a0 / 1000) ** (1 - m / 2)) / ((1 - m / 2) * C * (Y * dS * Math.sqrt(Math.PI)) ** m);
      checks.push({ l: `${q.e.name}: cycles to failure (Paris law, closed form)`, exp: Nf, act: q.failT * f, u: 'cycles', tol: 1e-4 });
    }
  });
  const H = SCENE_H;
  return {
    cols, rows, checks,
    notes: ['parts in the same column hang one under another from the ceiling, so they all carry the same load: the weakest link fails first and everything below it falls', ...chains.flatMap((ch, i) => (Number.isNaN(ch.broken) ? [] : [`chain ${i + 1}: ${ch.parts[ch.at].e.name} failed at t = ${ch.broken.toPrecision(5)} s (${ch.parts[ch.at].failMode})`]))],
    scalars: [...chains.map((ch, i) => ({ l: `chain ${i + 1}: breaks at`, v: ch.broken, u: 's' })), ...P.flatMap((q) => [{ l: `${q.e.name}: failure load now`, v: strength(q) / 1000, u: 'kN' }, { l: `${q.e.name}: first yields at`, v: q.yieldT, u: 's' }])],
    charts: [
      tchart(cols, rows, 'F', 'loads', chains.map((_, i) => `chain ${i + 1} force (N)`), 'N'),
      tchart(cols, rows, 's', 'peak stress in each part', P.map((q) => `${q.e.name} stress (MPa)`), 'MPa'),
      tchart(cols, rows, 'a', 'crack growth', P.filter((q) => q.k === 'cracked').map((q) => `${q.e.name} crack (mm)`), 'mm'),
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)], t = rw[0];
      G.view(0, SCENE_W, -H, 0, 14);
      G.line(0, -1, SCENE_W, -1, COL.dim, 3);
      chains.forEach((ch, ci) => {
        const fell = !Number.isNaN(ch.broken) && t >= ch.broken ? Math.min(H, 0.5 * 30 * (t - ch.broken) ** 2 / Math.max(1e-9, rows[rows.length - 1][0] / 40)) : 0;
        let yPrev = -1;
        ch.parts.forEach((q, j) => {
          const below = !Number.isNaN(ch.broken) && t >= ch.broken && j >= ch.at, dy = below ? fell : 0, y = -q.e.y - dy;
          if (!(below && j === ch.at)) G.line(ch.x, yPrev, ch.x, y + 1, COL.dim, 2);
          const sg = rw[1 + chains.length + 2 * P.indexOf(q)], u = sg / q.mat.su;
          if (q.k === 'bar') G.rect(ch.x - 0.3, y - 1, 0.6, 2, heatCol(u), true);
          else { G.rect(ch.x - 1.2, y - 1, 2.4, 2, heatCol(u), true); if (q.k === 'holed') G.circle(ch.x, y, 0.4, COL.bg, true); else G.line(ch.x - 1.2, y, ch.x - 1.2 + 2.4 * Math.min(1, rw[2 + chains.length + 2 * P.indexOf(q)] / q.W), y, COL.bg, 2); }
          label(G, `${q.e.name} ${sg.toFixed(0)} MPa${Number.isFinite(q.failT) && t >= q.failT ? ' BROKEN' : ''}`, ch.x + 1.5, y, Number.isFinite(q.failT) && t >= q.failT ? COL.d : COL.dim, 4);
          yPrev = y - 1;
        });
        ch.loads.forEach((w) => { const y = -w.y - fell; G.line(ch.x, yPrev, ch.x, y + 1.5, COL.dim, 2); G.rect(ch.x - 1, y - 1, 2, 2.5, '#6e7681', true); label(G, `${w.name} ${(rw[1 + ci] / 1000).toFixed(2)} kN`, ch.x + 1.5, y, COL.dim, 4); });
      });
      G.hud([`t=${rw[0].toPrecision(4)} s  ${chains.length} chain${chains.length > 1 ? 's' : ''} hanging from the ceiling · ${P.length} part${P.length === 1 ? '' : 's'}`, 'colour = stress / tensile strength']);
    },
  };
}

const matDef = { k: 'mat', l: 'material', v: 'structural steel', o: Object.keys(MAT), d: 'Sets E, yield and tensile strength, K_IC and the Paris constants.' };
export const fractureScene: Catalog = {
  env: [], engine: 'scene', run,
  desc: 'parts hanging in series from the ceiling under a growing or cycling load: the weakest link breaks first',
  settings: { dt: 1, steps: 2000, method: 'rk4' }, timeBased: true,
  envDefs: [],
  globals: [],
  where: 'parts in one column hang one under another from the ceiling · hang a weight below them · columns side by side are separate chains',
  kinds: [
    { kind: 'bar', name: 'bar or cable', sprite: 'cable', desc: 'a rod or cable in tension', custom: [
      matDef, { k: 'A', l: 'cross-section', u: 'mm2', v: 50, min: 1e-6, s: 5, d: 'Area carrying the load.' },
    ] },
    { kind: 'holed', name: 'plate with a hole', sprite: 'bracket', desc: 'a bracket with a bolt hole', custom: [
      matDef, { k: 'W', l: 'width', u: 'mm', v: 60, min: 0.1, s: 5, d: 'Plate width.' }, { k: 't', l: 'thickness', u: 'mm', v: 5, min: 0.01, s: 1, d: 'Plate thickness.' },
      { k: 'd', l: 'hole diameter', u: 'mm', v: 12, min: 0, s: 1, d: 'The hole concentrates stress: peak = Kt × net stress.' },
    ] },
    { kind: 'cracked', name: 'cracked plate', sprite: 'wingskin', desc: 'a plate with an edge crack', custom: [
      matDef, { k: 'W', l: 'width', u: 'mm', v: 100, min: 0.1, s: 5, d: 'Plate width.' }, { k: 't', l: 'thickness', u: 'mm', v: 3, min: 0.01, s: 0.5, d: 'Plate thickness.' },
      { k: 'a0', l: 'crack length', u: 'mm', v: 2, min: 1e-3, s: 0.5, d: 'Starting crack depth from the edge.' },
      { k: 'geo', l: 'geometry factor', v: GEOS[0], o: GEOS, d: 'Y in K = Yσ√(πa).' },
    ] },
    { kind: 'weight', name: 'load', sprite: 'weight', desc: 'pulls down on the chain above it', custom: [
      { k: 'm', l: 'hanging mass', u: 'kg', v: 100, min: 0, s: 10, d: 'Dead weight.' },
      { k: 'rate', l: 'extra pull growing at', u: 'N/s', v: 100, s: 10, d: 'Ramp: like a bucket filling up.' },
      { k: 'Famp', l: 'vibration amplitude', u: 'N', v: 0, min: 0, s: 100, d: 'A cycling load ± this much: grows cracks (fatigue).' },
      { k: 'f', l: 'vibration frequency', u: 'Hz', v: 10, min: 0, s: 1, d: 'Cycles per second.' },
    ] },
  ],
  presets: [
    { name: 'steel cable', kind: 'bar', sprite: 'cable', desc: '50 mm² wire rope', v: { mat: 'high-strength wire', A: 50 } },
    { name: 'copper wire', kind: 'bar', sprite: 'cable', desc: '10 mm², soft', v: { mat: 'copper', A: 10 } },
    { name: 'aluminium bracket', kind: 'holed', sprite: 'bracket', desc: 'plate with a bolt hole', v: { mat: 'aluminium 2024', W: 60, t: 5, d: 12 } },
    { name: 'cracked wing skin', kind: 'cracked', sprite: 'wingskin', desc: 'fatigue crack growth', v: { mat: 'aluminium 2024', W: 100, t: 3, a0: 2 } },
    { name: 'washing machine', kind: 'weight', sprite: 'washer', desc: '80 kg vibrating ±2 kN', v: { m: 80, rate: 0, Famp: 2000, f: 20 } },
    { name: 'filling bucket', kind: 'weight', sprite: 'barrel', desc: 'grows 200 N/s', v: { m: 10, rate: 200, Famp: 0 } },
  ],
  start: [['copper wire', 16, 6], ['aluminium bracket', 16, 14], ['filling bucket', 16, 24], ['cracked wing skin', 44, 10], ['washing machine', 44, 24]],
  tests: [
    { name: 'weakest link (ramp)', list: [['steel cable', 32, 6], ['aluminium bracket', 32, 12], ['bar', 32, 18, { A: 30 }], ['filling bucket', 32, 26]] },
    { name: 'brittle crack (ramp)', list: [['cracked', 32, 10, { mat: 'cast iron', a0: 5 }], ['filling bucket', 32, 26]] },
    { name: 'fatigue (Paris law)', list: [['cracked wing skin', 32, 10], ['weight', 32, 26, { m: 2000, rate: 0, Famp: 15000, f: 10 }]], s: { dt: 20, steps: 5000 } },
  ],
  guide(g, X, Y, cp) { g.fillStyle = '#4b525c'; g.fillRect(X(0), Y(0), cp * SCENE_W, 3); },
};
