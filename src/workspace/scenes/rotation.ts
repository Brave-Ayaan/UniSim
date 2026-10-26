// Rotation, one floor: ramps are wedges standing on the floor (the top corner is where you put them, so their
// height comes from the position and their steepness from the angle). Balls, cylinders, hoops and boxes sit on
// the surface under them and roll — or slip, when the friction can't keep up — down the ramps, along the floor,
// up the next ramp, and knock into each other. A ramp's tall back face is a wall.
import type { Catalog } from '../catalog';
import { DEG } from '../../core/num';
import { n, str, emptyScene, tchart, label, every, energyCheck, COL, GROUND, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const BETA: Record<string, number> = { 'solid sphere': 0.4, 'hollow sphere': 2 / 3, 'solid cylinder': 0.5, 'hoop': 1, 'sliding box': 0 };

interface Piece { x: number[]; y: number[]; s: number[] }
/** floor + wedges → surface pieces separated by walls (the vertical faces) */
function surface(ramps: { xt: number; H: number; tan: number; right: boolean }[], W: number): Piece[] {
  const fs = ramps.map((r) => ({ a: r.right ? r.xt : r.xt - r.H / r.tan, b: r.right ? r.xt + r.H / r.tan : r.xt, f: (x: number) => (r.right ? r.H - (x - r.xt) * r.tan : r.H - (r.xt - x) * r.tan) }));
  const h = (x: number, side: number) => fs.reduce((m, q) => { const inside = side < 0 ? x > q.a && x <= q.b + 1e-12 : x >= q.a - 1e-12 && x < q.b; return inside ? Math.max(m, q.f(x)) : m; }, 0);
  const cut = new Set<number>([0, W]);
  for (const q of fs) { cut.add(Math.max(0, Math.min(W, q.a))); cut.add(Math.max(0, Math.min(W, q.b))); }
  // kinks where two ramp faces cross
  for (let i = 0; i < ramps.length; i++) for (let j = i + 1; j < ramps.length; j++) {
    const A = fs[i], B = fs[j], x0 = Math.max(A.a, B.a), x1 = Math.min(A.b, B.b);
    if (x1 <= x0) continue;
    const d0 = A.f(x0) - B.f(x0), d1 = A.f(x1) - B.f(x1);
    if (d0 * d1 < 0) cut.add(x0 + ((x1 - x0) * d0) / (d0 - d1));
  }
  const xs = [...cut].sort((a, b) => a - b);
  const pieces: Piece[] = [];
  let cur: Piece = { x: [0], y: [h(0, 1)], s: [0] };
  for (let i = 1; i < xs.length; i++) {
    const xa = xs[i - 1], xb = xs[i], yl = h(xb, -1), yr = h(xb, 1);
    const L = cur.x.length - 1;
    cur.x.push(xb); cur.y.push(yl); cur.s.push(cur.s[L] + Math.hypot(xb - xa, yl - cur.y[L]));
    if (i < xs.length - 1 && Math.abs(yr - yl) > 1e-9) { pieces.push(cur); cur = { x: [xb], y: [yr], s: [0] }; }
  }
  pieces.push(cur);
  return pieces;
}
const segOf = (P: Piece, s: number) => { let i = 0; while (i < P.s.length - 2 && s > P.s[i + 1]) i++; return i; };
const at = (P: Piece, s: number) => { const i = segOf(P, s), ds = P.s[i + 1] - P.s[i] || 1, f = (s - P.s[i]) / ds; return { x: P.x[i] + f * (P.x[i + 1] - P.x[i]), y: P.y[i] + f * (P.y[i + 1] - P.y[i]), sn: (P.y[i + 1] - P.y[i]) / ds, cs: (P.x[i + 1] - P.x[i]) / ds, i }; };
const sOfX = (P: Piece, x: number) => { let i = 0; while (i < P.x.length - 2 && x > P.x[i + 1]) i++; const f = (x - P.x[i]) / (P.x[i + 1] - P.x[i] || 1); return P.s[i] + f * (P.s[i + 1] - P.s[i]); };

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.1), g = n(p.g, 9.80665), W = SCENE_W * scale;
  const rampE = ents.filter((e) => e.kind === 'ramp');
  const ramps = rampE.map((e) => ({ xt: e.x * scale, H: Math.max(0, (GROUND - e.y) * scale), tan: Math.tan(Math.max(1, Math.min(89, n(e.v.th, 20))) * DEG), right: str(e.v.face, 'down to the right') === 'down to the right' }));
  const pieces = surface(ramps, W);
  const rollE = ents.filter((e) => e.kind === 'roller');
  if (!rollE.length) return emptyScene('nothing to roll: press E and add a ball, cylinder, hoop or box');
  const R = rollE.map((e) => {
    const x = Math.max(0, Math.min(W, e.x * scale)), pi = pieces.findIndex((P) => x >= P.x[0] - 1e-12 && x <= P.x[P.x.length - 1] + 1e-12), P = pieces[Math.max(0, pi)];
    const shape = str(e.v.shape, 'solid sphere'), m = Math.max(1e-6, n(e.v.m, 1)), r = Math.max(1e-4, n(e.v.r, 0.1)), beta = BETA[shape] ?? 0.4;
    const s0 = Math.max(r, Math.min(P.s[P.s.length - 1] - r, sOfX(P, x)));
    return { e, P, shape, box: shape === 'sliding box', m, r, beta, I: beta * m * r * r, mus: n(e.v.mus, 0.5), muk: n(e.v.muk, 0.4), eb: n(e.v.eb, 0.5), s: s0, v: n(e.v.v0, 0), w: n(e.v.v0, 0) / r, rolling: shape !== 'sliding box', s0, rolledAll: true, slipped: false };
  });
  const N = R.length, dt = s.dt, steps = s.steps, ev = every(steps);
  const E = () => R.reduce((a, q) => a + 0.5 * q.m * q.v * q.v + 0.5 * q.I * q.w * q.w + q.m * g * at(q.P, q.s).y, 0);
  let diss = 0;
  const cols = ['t', ...R.flatMap((q) => [`${q.e.name} x (m)`, `${q.e.name} height (m)`, `${q.e.name} speed (m/s)`, `${q.e.name} spin (rpm)`, `${q.e.name} slip (m/s)`]), 'energy (J)', 'friction & impacts (J)'];
  const rows: number[][] = [];
  const angle = R.map(() => 0), turns: number[][] = [];
  const rec = (t: number) => turns.push(angle.slice()) && rows.push([t, ...R.flatMap((q) => { const c = at(q.P, q.s); return [c.x, c.y, q.v, (q.w * 60) / (2 * Math.PI), q.box ? q.v : q.v - q.w * q.r]; }), E(), diss]);
  const E0 = E();
  rec(0);
  const footT = R.map(() => NaN);
  for (let k = 1; k <= steps; k++) {
    const t0 = (k - 1) * dt;
    R.forEach((q, i) => {
      // on each flat face of the surface the acceleration is constant, so the motion is solved exactly from event
      // to event: reaching a corner of the surface, the slip reaching zero (it grips again), a box stopping
      let left = dt;
      for (let guard = 0; guard < 64 && left > 0; guard++) {
        const P = q.P, last = P.s.length - 1;
        let j = segOf(P, q.s);
        if (q.s === P.s[j + 1] && j + 1 < last && (q.v > 0 || (q.v === 0 && P.y[j + 2] < P.y[j + 1]))) j++;
        if (q.s === P.s[j] && j > 0 && (q.v < 0 || (q.v === 0 && P.y[j - 1] < P.y[j]))) j--;
        const ds = P.s[j + 1] - P.s[j] || 1, sn = (P.y[j + 1] - P.y[j]) / ds, cs = (P.x[j + 1] - P.x[j]) / ds, Nn = q.m * g * cs, gt = -g * sn;
        if (q.rolling && Math.abs((gt * q.m * q.beta) / (1 + q.beta)) > q.mus * Nn) { q.rolling = false; q.slipped = true; }
        let a: number, aw = 0, f = 0;
        const u = q.box ? q.v : q.v - q.w * q.r;
        if (q.rolling) a = gt / (1 + q.beta);
        else if (q.box && q.v === 0 && Math.abs(gt) <= (q.mus * Nn) / q.m) break; // static friction holds the box
        else { f = -q.muk * Nn * Math.sign(u || gt); a = gt + f / q.m; if (!q.box) aw = (-f * q.r) / q.I; }
        const au = q.box ? a : a - aw * q.r;
        // earliest event in this step
        let tau = left, ev = 0;
        const hit = (b: number) => { const d = b - q.s, disc = q.v * q.v + 2 * a * d; if (disc < 0) return Infinity; const r = Math.abs(a) < 1e-15 ? (Math.abs(q.v) > 0 ? d / q.v : Infinity) : (-q.v + Math.sign(d) * Math.sqrt(disc)) / a; return r > 1e-15 ? r : Infinity; };
        const tb = Math.min(j + 1 < last ? hit(P.s[j + 1]) : Infinity, j > 0 ? hit(P.s[j]) : Infinity);
        if (tb < tau) { tau = tb; ev = 1; }
        if (!q.rolling && u !== 0 && u * au < 0 && -u / au < tau) { tau = -u / au; ev = 2; }
        q.s += q.v * tau + 0.5 * a * tau * tau;
        diss += -f * (u * tau + 0.5 * au * tau * tau);
        q.v += a * tau;
        if (q.rolling) q.w = q.v / q.r; else if (!q.box) q.w += aw * tau;
        left -= tau;
        if (ev === 1) {
          q.s = Math.abs(q.s - P.s[j + 1]) < Math.abs(q.s - P.s[j]) ? P.s[j + 1] : P.s[j];
          if (Number.isNaN(footT[i])) footT[i] = t0 + dt - left;
        }
        if (ev === 2) { if (q.box) q.v = 0; else { q.w = q.v / q.r; q.rolling = true; } }
      }
    });
    // impacts: rollers on the same surface piece (along the surface), and the walls at its ends
    const imp = (a: (typeof R)[number], b: (typeof R)[number] | null, e: number, dir: number) => {
      const before = 0.5 * a.m * a.v ** 2 + (b ? 0.5 * b.m * b.v ** 2 : 0);
      if (!b) a.v = -e * a.v; else { const M = a.m + b.m, vc = (a.m * a.v + b.m * b.v) / M, dv = a.v - b.v; a.v = vc - (e * b.m * dv) / M; b.v = vc + (e * a.m * dv) / M; }
      if (!a.box) a.rolling = false; if (b && !b.box) b.rolling = false; void dir;
      diss += before - 0.5 * a.m * a.v ** 2 - (b ? 0.5 * b.m * b.v ** 2 : 0);
    };
    for (const P of pieces) {
      const on = R.filter((q) => q.P === P).sort((a, b) => a.s - b.s);
      for (let j = 0; j < on.length - 1; j++) { const a = on[j], b = on[j + 1]; if (b.s - a.s < a.r + b.r && a.v > b.v) imp(a, b, Math.min(a.eb, b.eb), 1); }
      for (const q of on) {
        if (q.s < q.r && q.v < 0) imp(q, null, q.eb, -1);
        if (q.s > P.s[P.s.length - 1] - q.r && q.v > 0) imp(q, null, q.eb, 1);
      }
    }
    R.forEach((q, i) => { angle[i] -= (q.box ? 0 : q.w) * dt; });
    if (k % ev === 0 || k === steps) rec(k * dt);
  }
  const checks: Check[] = [energyCheck('energy: kinetic + spin + height + losses = start', E0, E() + diss, Math.max(Math.abs(E0), ...R.map((q) => q.m * g * Math.max(...q.P.y))), s.method, 1e-9)];
  if (N === 1) {
    const q = R[0], c = at(q.P, q.s0), sinT = Math.abs(c.sn), cosT = c.cs, i = c.i, L = c.sn < 0 ? q.P.s[i + 1] - q.s0 : q.s0 - q.P.s[i];
    if (sinT > 1e-9 && n(q.e.v.v0, 0) === 0 && Number.isFinite(footT[0])) {
      const rolls = !q.box && Math.tan(Math.asin(sinT)) * q.beta / (1 + q.beta) <= q.mus;
      const a = rolls ? (g * sinT) / (1 + q.beta) : g * (sinT - q.muk * cosT);
      if (a > 0) checks.push({ l: rolls ? `${q.e.name}: time down the slope √(2L(1+β)/(g sinθ)) (rolls)` : `${q.e.name}: time down the slope √(2L/(g(sinθ−μk cosθ))) (slips)`, exp: Math.sqrt((2 * L) / a), act: footT[0], u: 's', tol: 1e-6 });
    }
  }
  const tOf = (k: number) => rows[Math.min(k, rows.length - 1)];
  return {
    cols, rows, checks,
    notes: ['ramps are wedges: their top corner is where you put them, the slope comes down to the floor · objects stay on the surface; a wedge\'s steep back face is a wall', ...R.filter((q) => q.slipped).map((q) => `${q.e.name} slips: the slope needs more grip than μs gives`)],
    scalars: [...R.flatMap((q, i) => [{ l: `${q.e.name}: top speed`, v: Math.max(...rows.map((r) => Math.abs(r[3 + 5 * i]))), u: 'm/s' }, { l: `${q.e.name}: reached the end of its slope at`, v: footT[i], u: 's' }]), { l: 'start energy', v: E0, u: 'J' }, { l: 'lost to friction & impacts', v: diss, u: 'J' }],
    charts: [
      tchart(cols, rows, 'v', 'speed', R.map((q) => `${q.e.name} speed (m/s)`), 'm/s'),
      tchart(cols, rows, 'slip', 'slip speed (0 = rolling)', R.filter((q) => !q.box).map((q) => `${q.e.name} slip (m/s)`), 'm/s'),
      tchart(cols, rows, 'E', 'energy', ['energy (J)', 'friction & impacts (J)'], 'J'),
    ],
    draw(G: Gfx, k: number) {
      const rw = tOf(k), H = Math.max(1, ...pieces.flatMap((P) => P.y)) * 1.2;
      G.view(0, W, -0.05 * H, H, 14);
      for (const P of pieces) { G.path([P.x[0], ...P.x, P.x[P.x.length - 1]], [0, ...P.y, 0], '#3a3f47', 1, true); G.path(P.x, P.y, COL.fg, 2); }
      G.ground(0, W, 0);
      R.forEach((q, i) => {
        const x = rw[1 + 5 * i], y = rw[2 + 5 * i], c = at(q.P, sOfX(q.P, x)), nx = -c.sn, ny = c.cs, rp = Math.max(q.r, 4 / G.sx), cx = x + nx * rp, cy = y + ny * rp;
        if (q.box) { G.rect(cx - rp, cy - rp, 2 * rp, 2 * rp, COL.e, true); }
        else {
          G.circle(cx, cy, rp, COL.e, false);
          const ph = turns[Math.min(k, turns.length - 1)][i];
          G.line(cx, cy, cx + rp * Math.cos(-ph), cy + rp * Math.sin(-ph), COL.e, 2);
        }
        label(G, `${q.e.name} ${Math.abs(rw[3 + 5 * i]).toFixed(2)} m/s${Math.abs(rw[5 + 5 * i]) > 1e-6 && !q.box ? ' SLIP' : ''}`, cx, cy + rp, COL.dim, -10);
      });
      G.hud([`t=${rw[0].toFixed(2)} s  ${N} object${N > 1 ? 's' : ''} · ${ramps.length} ramp${ramps.length === 1 ? '' : 's'}`, `energy ${rw[cols.indexOf('energy (J)')].toFixed(3)} J · lost ${rw[cols.indexOf('friction & impacts (J)')].toFixed(3)} J`]);
    },
  };
}

export const rotationScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'balls, cylinders, hoops and boxes rolling and slipping down ramps, along the floor and into each other',
  settings: { dt: 0.001, steps: 6000, method: 'rk4' }, timeBased: true,
  envDefs: [{ k: 'g', l: 'gravity', u: 'm/s2', v: 9.80665, s: 0.1, d: 'Acceleration of free fall.' }],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.1, min: 1e-4, s: 0.02, d: 'Size of one editor grid cell: sets ramp heights and distances.' }],
  where: 'a ramp\'s top corner is where you put it (higher = taller ramp) · rolling objects drop onto the surface below them · drag an object sideways to give it a push',
  kinds: [
    { kind: 'ramp', name: 'ramp', sprite: 'ramp', desc: 'a wedge from this corner down to the floor', custom: [
      { k: 'th', l: 'slope angle', u: 'deg', v: 20, min: 1, max: 89, s: 1, d: 'Steepness: with the height this sets the ramp length.' },
      { k: 'face', l: 'slopes', v: 'down to the right', o: ['down to the right', 'down to the left'], d: 'Which way the slope runs from the top corner.' },
    ] },
    { kind: 'roller', name: 'rolling object', sprite: 'bowling', desc: 'a ball, cylinder, hoop or box on the surface', aim: { kind: 'len', field: 'v0', per: 0.2 }, custom: [
      { k: 'shape', l: 'shape', v: 'solid sphere', o: Object.keys(BETA), d: 'Sets I = β m r²: sphere 2/5, hollow sphere 2/3, cylinder 1/2, hoop 1. A box slides without turning.' },
      { k: 'm', l: 'mass', u: 'kg', v: 1, min: 1e-6, s: 0.5, d: 'Mass.' },
      { k: 'r', l: 'radius', u: 'm', v: 0.1, min: 1e-4, s: 0.01, d: 'Radius (half the size for a box).' },
      { k: 'mus', l: 'grip μs', v: 0.5, min: 0, s: 0.05, d: 'Static friction: it rolls without slipping while tanθ·β/(1+β) ≤ μs.' },
      { k: 'muk', l: 'sliding μk', v: 0.4, min: 0, s: 0.05, d: 'Kinetic friction while it slips.' },
      { k: 'eb', l: 'bounciness', v: 0.5, min: 0, max: 1, s: 0.05, d: 'Restitution when it hits another object or a wall.' },
      { k: 'v0', l: 'start push', u: 'm/s', v: 0, s: 0.1, d: 'Speed along the surface at the start (+ = right), rolling. Drag sideways in EDIT.' },
    ] },
  ],
  presets: [
    { name: 'bowling ball', kind: 'roller', sprite: 'bowling', desc: 'solid sphere 7 kg', v: { shape: 'solid sphere', m: 7, r: 0.109, mus: 0.3, muk: 0.2 } },
    { name: 'car tyre', kind: 'roller', sprite: 'tyre', desc: 'roughly a hoop', v: { shape: 'hoop', m: 10, r: 0.33, mus: 0.8, muk: 0.6 } },
    { name: 'tin can', kind: 'roller', sprite: 'flywheel', desc: 'solid cylinder', v: { shape: 'solid cylinder', m: 0.4, r: 0.04, mus: 0.4, muk: 0.3 } },
    { name: 'football', kind: 'roller', sprite: 'football', desc: 'hollow sphere 0.43 kg', v: { shape: 'hollow sphere', m: 0.43, r: 0.11, mus: 0.6, muk: 0.5, eb: 0.7 } },
    { name: 'ice block', kind: 'roller', sprite: 'icecube', desc: 'a box on slippery ice', v: { shape: 'sliding box', m: 2, r: 0.1, mus: 0.05, muk: 0.03 } },
  ],
  start: [['ramp', 4, 14, { th: 25 }], ['bowling ball', 6, 10], ['car tyre', 8, 10], ['ramp', 60, 24, { face: 'down to the left', th: 15 }], ['tin can', 40, 30]],
  tests: [
    { name: 'lone ball rolls down', list: [['ramp', 4, 14, { th: 25 }], ['bowling ball', 6, 10]] },
    { name: 'steep icy slope (slips)', list: [['ramp', 4, 4, { th: 60 }], ['roller', 6, 2, { mus: 0.2, muk: 0.1, shape: 'hoop' }]] },
    { name: 'box slides down', list: [['ramp', 4, 14, { th: 30 }], ['ice block', 6, 10]] },
  ],
  guide(g, X, Y, cp, p, ents) {
    g.fillStyle = '#8b5a2b'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2);
    g.strokeStyle = '#c9d1d9';
    for (const e of ents.filter((q) => q.k === 'ramp')) {
      const th = Math.max(1, Math.min(89, n(p[`e${e.id}_th`], 20))) * DEG, dir = str(p[`e${e.id}_face`], 'down to the right') === 'down to the right' ? 1 : -1;
      g.beginPath(); g.moveTo(X(e.x), Y(GROUND)); g.lineTo(X(e.x), Y(e.y)); g.lineTo(X(e.x + (dir * (GROUND - e.y)) / Math.tan(th)), Y(GROUND)); g.stroke();
    }
  },
};
