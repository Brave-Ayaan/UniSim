// Vehicles, one road: cars drive right at their own speed. The first driver sees the nearest obstacle ahead
// at t = 0 and brakes after their reaction time; every driver behind brakes their reaction time after the
// brake lights ahead come on. Gaps that close become crashes (momentum exchange); speed bumps shake each
// vehicle's suspension as it rolls over them.
import type { Catalog } from '../catalog';
import { G0 } from '../../core/num';
import { n, str, emptyScene, tchart, sprite, label, every, COL, GROUND, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

interface Veh { e: Ent; obstacle: boolean; m: number; L: number; x: number; v: number; brakeAt: number; tr: number; abs: boolean; CdA: number; zs: number; vs: number; zu: number; vu: number; ks: number; cs: number; kt: number; mu4: number; ms4: number; hit: number; stopX: number; stopT: number; crash: string[] }

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 2), mu = n(p.mu, 0.9), muk = n(p.muk, 0.7), th = Math.atan(n(p.grade, 0) / 100), rho = n(p.rho, 1.225);
  const vs0 = ents.filter((e) => e.kind === 'veh' || e.kind === 'obst').sort((a, b) => a.x - b.x);
  if (!vs0.some((e) => e.kind === 'veh')) return emptyScene('no vehicles: press E and add one');
  const bumps = ents.filter((e) => e.kind === 'bump').map((e) => ({ x: e.x * scale, h: n(e.v.h, 8) / 100, w: n(e.v.w, 0.5) }));
  const road = (x: number) => bumps.reduce((a, b) => (Math.abs(x - b.x) < b.w / 2 ? a + b.h * Math.cos((Math.PI * (x - b.x)) / b.w) ** 2 : a), 0);
  const V: Veh[] = vs0.map((e) => {
    const ob = e.kind === 'obst', m = Math.max(1, n(e.v.m, 1500)), ms4 = (0.85 * m) / 4, mu4 = (0.15 * m) / 4;
    const ks = ms4 * (2 * Math.PI * 1.2) ** 2, cs = 2 * 0.3 * Math.sqrt(ks * ms4), kt = 10 * ks;
    return { e, obstacle: ob, m, L: n(e.v.len, ob ? 1 : 4.5), x: e.x * scale, v: ob ? 0 : n(e.v.v0, 50) / 3.6, brakeAt: Infinity, tr: ob ? 0 : n(e.v.tr, 1), abs: str(e.v.abs, 'on') === 'on', CdA: ob ? 0 : n(e.v.CdA, 0.7), zs: 0, vs: 0, zu: 0, vu: 0, ks, cs, kt, mu4, ms4, hit: 0, stopX: NaN, stopT: NaN, crash: [] };
  });
  // front of the queue first. The leader sees whatever stands ahead at t = 0; each driver behind starts
  // braking their own reaction time after the brake lights ahead come on. Obstacles skid when pushed.
  const order = V.slice().sort((a, b) => b.x - a.x);
  order.forEach((q, i) => {
    if (q.obstacle) { q.brakeAt = 0; return; }
    const ahead = order[i - 1];
    q.brakeAt = !ahead ? Infinity : ahead.obstacle ? q.tr : ahead.brakeAt + q.tr;
  });
  const leaderReacts = (q: Veh) => { const i = order.indexOf(q); return i > 0 && order[i - 1].obstacle; };
  const dt = s.dt, steps = s.steps, ev = every(steps), sn = Math.sin(th), cs0 = Math.cos(th);
  const cols = ['t', ...V.flatMap((q) => [`${q.e.name} x (m)`, `${q.e.name} speed (km/h)`, `${q.e.name} body bounce (cm)`]), 'kinetic + height (J)', 'brakes & drag (J)', 'crashes (J)'];
  const rows: number[][] = [];
  let Wb = 0, Wc = 0, pCrash = 0;
  const E = () => V.reduce((a, q) => a + 0.5 * q.m * q.v * q.v + q.m * G0 * sn * q.x, 0);
  const E0 = E(), p0 = V.reduce((a, q) => a + q.m * Math.abs(q.v), 0);
  const rec = (t: number) => rows.push([t, ...V.flatMap((q) => [q.x, q.v * 3.6, q.zs * 100]), E(), Wb, Wc]);
  rec(0);
  for (let k = 1; k <= steps; k++) {
    const ts = (k - 1) * dt, t = k * dt;
    for (const q of V) {
      // along the road: dv/dt = −(a₀ + κv²) with a₀ = brake/m + g sinθ, κ = ½ρCdA/m — solved exactly over the step
      const braking = ts >= q.brakeAt - 1e-9, Fb = braking ? q.m * G0 * cs0 * (q.obstacle ? 0.8 : q.abs ? mu : muk) : 0, kap = (0.5 * rho * q.CdA) / q.m;
      const a0 = Fb / q.m + G0 * sn, v0 = q.v;
      let v1: number, dx: number;
      if (v0 <= 0 && Fb / q.m >= Math.abs(G0 * sn)) { v1 = 0; dx = 0; }
      else if (a0 > 0) {
        if (kap > 0) { const vt = Math.sqrt(a0 / kap), w = Math.atan(v0 / vt) - a0 / vt * dt; v1 = w > 0 ? vt * Math.tan(w) : 0; dx = Math.log((a0 + kap * v0 * v0) / (a0 + kap * v1 * v1)) / (2 * kap); }
        else { v1 = Math.max(0, v0 - a0 * dt); dx = (v0 * v0 - v1 * v1) / (2 * a0); }
      } else if (a0 === 0) { v1 = kap > 0 ? v0 / (1 + kap * v0 * dt) : v0; dx = kap > 0 ? Math.log(1 + kap * v0 * dt) / kap : v0 * dt; }
      else { // rolling downhill, gaining speed: rk4 sub-steps
        let v = v0; dx = 0; const h = dt / 8, fv = (u: number) => -(a0 + kap * u * u);
        for (let j = 0; j < 8; j++) { const k1 = fv(v), k2 = fv(v + h / 2 * k1), k3 = fv(v + h / 2 * k2), k4 = fv(v + h * k3); dx += h * (v + h / 6 * (k1 + k2 + k3)); v += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4); }
        v1 = v;
      }
      Wb += 0.5 * q.m * (v0 * v0 - v1 * v1) - q.m * G0 * sn * dx;
      q.x += dx; q.v = v1;
      if (!q.obstacle && braking && v1 === 0 && Number.isNaN(q.stopT)) { q.stopT = t; q.stopX = q.x; }
      // quarter-car suspension: the front wheel follows the road profile
      const zr = road(q.x), fsus = -q.ks * (q.zs - q.zu) - q.cs * (q.vs - q.vu), ftyre = -q.kt * (q.zu - zr);
      q.vs += (fsus / q.ms4) * dt; q.zs += q.vs * dt;
      q.vu += ((-fsus + ftyre) / q.mu4) * dt; q.zu += q.vu * dt;
    }
    // crashes: bumpers touch while closing → crumpling impact (restitution 0.1), momentum conserved
    for (let i = 0; i < order.length - 1; i++) {
      const front = order[i], back = order[i + 1];
      if (back.x + back.L / 2 < front.x - front.L / 2 || back.v <= front.v) continue;
      const e = 0.1, M = back.m + front.m, vc = (back.m * back.v + front.m * front.v) / M, dv = back.v - front.v;
      const pBefore = back.m * back.v + front.m * front.v, before = 0.5 * back.m * back.v ** 2 + 0.5 * front.m * front.v ** 2;
      back.v = vc - (e * front.m * dv) / M; front.v = vc + (e * back.m * dv) / M;
      pCrash = Math.max(pCrash, Math.abs(back.m * back.v + front.m * front.v - pBefore));
      Wc += before - 0.5 * back.m * back.v ** 2 - 0.5 * front.m * front.v ** 2;
      back.hit = Math.max(back.hit, dv); front.hit = Math.max(front.hit, dv);
      back.crash.push(`${front.e.name} at ${(dv * 3.6).toFixed(1)} km/h`);
      if (front.brakeAt > t) front.brakeAt = t; // a shunted driver stamps on the brake
    }
    if (k % ev === 0 || k === steps) rec(t);
  }
  const checks: Check[] = [];
  checks.push({ l: 'energy: kinetic + height + brakes & drag + crashes = start', exp: E0, act: E() + Wb + Wc, u: 'J', abs: 1e-9 * Math.max(1, Math.abs(E0)) });
  checks.push({ l: 'momentum conserved in every crash', exp: 0, act: pCrash, u: 'kg m/s', abs: 1e-9 * Math.max(1, p0) });
  V.forEach((q) => {
    if (q.obstacle || q.hit > 0 || !Number.isFinite(q.stopT) || !leaderReacts(q) || th !== 0) return;
    // exact stopping distance on a level road: reaction phase slowed only by drag, then braking with drag
    const c = 0.5 * rho * q.CdA, v0 = n(q.e.v.v0, 50) / 3.6, F = q.m * G0 * (q.abs ? mu : muk);
    const tr = Math.ceil(q.tr / dt - 1e-9) * dt, vr = c > 0 ? v0 / (1 + (c * v0 * tr) / q.m) : v0, dr = c > 0 ? (q.m / c) * Math.log(1 + (c * v0 * tr) / q.m) : v0 * tr;
    const db = c > 0 ? (q.m / (2 * c)) * Math.log(1 + (c * vr * vr) / F) : (q.m * vr * vr) / (2 * F);
    checks.push({ l: `${q.e.name}: stopping distance (m/c)ln(1+cv₀t_r/m) + (m/2c)ln(1+cv²/F)`, exp: dr + db, act: q.stopX - q.e.x * scale, u: 'm', tol: 1e-6 });
  });
  const notes = ['side view of one lane · the first driver sees the obstacle at t = 0; each driver behind reacts to the brake lights ahead', ...V.flatMap((q) => q.crash.map((c) => `CRASH: ${q.e.name} hit ${c}`))];
  return {
    cols, rows, checks, notes,
    scalars: V.filter((q) => !q.obstacle).flatMap((q) => [
      { l: `${q.e.name}: stopping distance`, v: Number.isFinite(q.stopX) ? q.stopX - q.e.x * scale : NaN, u: 'm' }, { l: `${q.e.name}: stopped after`, v: q.stopT, u: 's' },
      { l: `${q.e.name}: worst impact speed`, v: q.hit * 3.6, u: 'km/h' }, { l: `${q.e.name}: max body bounce`, v: Math.max(...rows.map((r) => Math.abs(r[3 + 3 * V.indexOf(q)]))), u: 'cm' },
    ]),
    charts: [
      tchart(cols, rows, 'v', 'speeds', V.filter((q) => !q.obstacle).map((q) => `${q.e.name} speed (km/h)`), 'km/h'),
      tchart(cols, rows, 'x', 'positions', V.map((q) => `${q.e.name} x (m)`), 'm'),
      tchart(cols, rows, 'ride', 'body bounce over bumps', V.filter((q) => !q.obstacle).map((q) => `${q.e.name} body bounce (cm)`), 'cm'),
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      const W = SCENE_W * scale, xs = V.map((_, i) => rw[1 + 3 * i]), lo = Math.min(0, ...xs) - 5, hi = Math.max(W, ...xs) + 5;
      G.view(lo, hi, -0.05 * (hi - lo), 0.25 * (hi - lo), 14);
      G.ground(lo, hi, 0);
      for (const b of bumps) G.path([b.x - b.w / 2, b.x, b.x + b.w / 2], [0, b.h * 10, 0], COL.b, 2);
      V.forEach((q, i) => {
        const x = rw[1 + 3 * i];
        sprite(G, q.e.sprite, x, Math.max(0, rw[3 + 3 * i] / 100 * 10), 2);
        if (!q.obstacle) label(G, `${q.e.name} ${rw[2 + 3 * i].toFixed(0)} km/h`, x, 0, rw[2 + 3 * i] > 0 && rw[0] >= q.brakeAt ? COL.d : COL.dim, -22);
      });
      G.hud([`t=${rw[0].toFixed(2)} s  ${V.filter((q) => !q.obstacle).length} vehicles · ${V.filter((q) => q.obstacle).length} obstacles · ${bumps.length} bumps`, 'red label = braking (bump heights drawn ×10)']);
    },
  };
}

export const vehicleScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'vehicles on one road: reaction times, chain braking, crashes into each other and obstacles, suspension over bumps',
  settings: { dt: 0.005, steps: 2400, method: 'rk4' }, timeBased: true,
  envDefs: [
    { k: 'mu', l: 'road grip μ (peak)', v: 0.9, min: 0, s: 0.05, d: 'Tyre-road friction with ABS: dry asphalt ≈ 0.9, wet ≈ 0.5, snow ≈ 0.2, ice ≈ 0.1.' },
    { k: 'muk', l: 'locked-wheel μ (skidding)', v: 0.7, min: 0, s: 0.05, d: 'Friction when the wheels lock (no ABS).' },
    { k: 'grade', l: 'road grade (uphill +)', u: '%', v: 0, s: 1, d: 'Slope of the road: uphill helps braking.' },
    { k: 'rho', l: 'air density', u: 'kg/m3', v: 1.225, min: 0, s: 0.01, d: 'Sets aerodynamic drag.' },
  ],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 2, min: 0.01, s: 0.5, d: 'Size of one editor grid cell along the road.' }],
  where: 'everything drives right along one lane, starting where you put it · drag a vehicle sideways to set its speed · place an obstacle ahead to make the first driver brake',
  kinds: [
    { kind: 'veh', name: 'vehicle', sprite: 'car', desc: 'a vehicle driving right', aim: { kind: 'len', field: 'v0', per: 5 }, custom: [
      { k: 'm', l: 'mass', u: 'kg', v: 1500, min: 1, s: 100, d: 'Vehicle mass.' },
      { k: 'v0', l: 'speed', u: 'km/h', v: 50, min: 0, s: 5, d: 'Driving speed at the start.' },
      { k: 'tr', l: 'driver reaction time', u: 's', v: 1, min: 0, s: 0.1, d: 'Time from seeing danger (or brake lights) to braking.' },
      { k: 'abs', l: 'ABS', v: 'on', o: ['on', 'off'], d: 'ABS keeps the tyres at peak grip; without it the wheels lock and skid.' },
      { k: 'CdA', l: 'drag area CdA', u: 'm2', v: 0.7, min: 0, s: 0.05, d: 'Aerodynamic drag area.' },
      { k: 'len', l: 'length', u: 'm', v: 4.5, min: 0.5, s: 0.5, d: 'Bumper-to-bumper length.' },
    ] },
    { kind: 'obst', name: 'obstacle', sprite: 'deer', desc: 'something standing in the road', custom: [
      { k: 'm', l: 'mass', u: 'kg', v: 80, min: 1, s: 10, d: 'Mass (a deer ≈ 80 kg, a stalled car ≈ 1500 kg).' },
      { k: 'len', l: 'length', u: 'm', v: 1, min: 0.1, s: 0.5, d: 'Its size along the road.' },
    ] },
    { kind: 'bump', name: 'speed bump', sprite: 'bump', desc: 'a bump in the road', custom: [
      { k: 'h', l: 'height', u: 'cm', v: 8, min: 0, s: 1, d: 'Bump height.' },
      { k: 'w', l: 'length', u: 'm', v: 0.5, min: 0.05, s: 0.1, d: 'Bump length along the road (short = harsh).' },
    ] },
  ],
  presets: [
    { name: 'family car', kind: 'veh', sprite: 'car', desc: '1.5 t, ABS', v: { m: 1500, v0: 100, abs: 'on', tr: 1, CdA: 0.7, len: 4.5 } },
    { name: 'lorry', kind: 'veh', sprite: 'truck', desc: '12 t', v: { m: 12000, v0: 80, abs: 'on', tr: 1.2, CdA: 6, len: 10 } },
    { name: 'sports car', kind: 'veh', sprite: 'sportscar', desc: 'low and light', v: { m: 1300, v0: 100, abs: 'on', tr: 0.8, CdA: 0.6, len: 4.3 } },
    { name: 'bus', kind: 'veh', sprite: 'bus', desc: '18 t', v: { m: 18000, v0: 70, abs: 'on', tr: 1.2, CdA: 7, len: 12 } },
    { name: 'motorbike', kind: 'veh', sprite: 'motorbike', desc: '250 kg, no ABS', v: { m: 250, v0: 100, abs: 'off', tr: 0.8, CdA: 0.5, len: 2.2 } },
    { name: 'stalled car', kind: 'obst', sprite: 'car', desc: '1.5 t standing still', v: { m: 1500, len: 4.5 } },
    { name: 'concrete barrier', kind: 'obst', sprite: 'barrier', desc: '20 t', v: { m: 20000, len: 1 } },
  ],
  start: [['family car', 4, GROUND, { v0: 80 }], ['lorry', 14, GROUND, { v0: 80 }], ['stalled car', 60, GROUND], ['bump', 28, GROUND]],
  tests: [
    { name: 'lone car braking (exact distance)', list: [['family car', 4, GROUND], ['stalled car', 63, GROUND]] },
    { name: 'no ABS on ice, rear-end crash', list: [['motorbike', 10, GROUND, { v0: 60 }], ['sports car', 20, GROUND, { v0: 60 }], ['stalled car', 40, GROUND]], p: { mu: 0.15, muk: 0.1 } },
  ],
  guide(g, X, Y, cp) { g.fillStyle = '#8b5a2b'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2); },
};
