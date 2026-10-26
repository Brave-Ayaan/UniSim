// Aerodynamics, one sky: spheres fall or are thrown from where you put them, gliders are launched from their
// spot and fly on their wing, and fans blow columns of rising air that lift everything passing over them.
// The wind blows on all of it. Drag comes from the real drag curve Cd(Re); lift from the wing's polar.
import type { Catalog } from '../catalog';
import { DEG } from '../../core/num';
import { n, emptyScene, tchart, simulate, energyCheck, sprite, label, COL, GROUND, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

/** sphere drag coefficient over the whole subcritical range (Schiller–Naumann + Newton-regime term) */
export const cdSphere = (Re: number) => (Re < 1e-9 ? 0 : (24 / Re) * (1 + 0.15 * Re ** 0.687) + 0.42 / (1 + 42500 * Re ** -1.16));

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 2), g = n(p.g, 9.80665), rho = n(p.rho, 1.225), mu = n(p.mu, 1.81e-5), wind = n(p.wind, 0);
  const objs = ents.filter((e) => e.kind === 'ball' || e.kind === 'glider');
  if (!objs.length) return emptyScene('nothing in the air: press E and add a falling ball or a glider');
  const fans = ents.filter((e) => e.kind === 'fan').map((e) => ({ e, x: e.x * scale, y: Math.max(0, (GROUND - e.y) * scale), w: n(e.v.w, 5), b: Math.max(1e-3, n(e.v.b, 2) / 2), H: n(e.v.H, 20) }));
  const air = (x: number, y: number) => { let up = 0; for (const f of fans) up += f.w * Math.exp(-(((x - f.x) / f.b) ** 2)) * 0.25 * (1 + Math.tanh((y - f.y) / f.b)) * (1 - Math.tanh((y - f.y - f.H) / f.b)); return [wind, up]; };
  const O = objs.map((e) => {
    const ball = e.kind === 'ball', d = Math.max(1e-6, n(e.v.d, 0.002)), rhos = n(e.v.rhos, 1000);
    const m = ball ? rhos * (Math.PI / 6) * d ** 3 : Math.max(1e-6, n(e.v.m, 0.5)), V = ball ? (Math.PI / 6) * d ** 3 : 0;
    const S = n(e.v.S, 1), AR = Math.max(0.1, n(e.v.AR, 8)), al = n(e.v.alpha, 5) * DEG, CL = (2 * Math.PI * al) / (1 + 2 / AR), CD = n(e.v.CD0, 0.02) + (CL * CL) / (Math.PI * n(e.v.e, 0.85) * AR);
    const v0 = n(e.v.v0, 0), ang = n(e.v.ang, 0) * DEG;
    return { e, ball, d, rhos, m, V, A: (Math.PI / 4) * d * d, S, CL, CD, x: e.x * scale, y: Math.max(0, (GROUND - e.y) * scale), vx: v0 * Math.cos(ang), vy: v0 * Math.sin(ang), landed: false, landX: NaN, landT: NaN, vLand: NaN };
  });
  const N = O.length;
  const aero = (q: (typeof O)[number], x: number, y: number, vx: number, vy: number) => {
    const [ax, ay] = air(x, y), ux = vx - ax, uy = vy - ay, U = Math.hypot(ux, uy);
    if (U < 1e-15) return [0, q.ball ? rho * q.V * g : 0];
    if (q.ball) { const D = 0.5 * rho * U * U * q.A * cdSphere((rho * U * q.d) / mu); return [(-D * ux) / U, (-D * uy) / U + rho * q.V * g]; }
    const qS = 0.5 * rho * U * U * q.S, L = qS * q.CL, D = qS * q.CD, sg = ux >= 0 ? 1 : -1;
    return [(-D * ux) / U + (L * sg * -uy) / U, (-D * uy) / U + (L * sg * ux) / U];
  };
  // state: per object x, y, vx, vy; then the work done on them by the air
  const f = (_t: number, y: number[]) => {
    const d = new Array(4 * N + 1).fill(0);
    O.forEach((q, i) => {
      if (q.landed) return;
      const [x, h, vx, vy] = y.slice(4 * i, 4 * i + 4), [Fx, Fy] = aero(q, x, h, vx, vy);
      d[4 * i] = vx; d[4 * i + 1] = vy; d[4 * i + 2] = Fx / q.m; d[4 * i + 3] = Fy / q.m - g;
      d[4 * N] += Fx * vx + Fy * vy;
    });
    return d;
  };
  let lost = 0;
  const E = (y: number[]) => O.reduce((a, q, i) => a + 0.5 * q.m * (y[4 * i + 2] ** 2 + y[4 * i + 3] ** 2) + q.m * g * y[4 * i + 1], 0);
  const y0 = [...O.flatMap((q) => [q.x, q.y, q.vx, q.vy]), 0];
  const cols = ['t', ...O.flatMap((q) => [`${q.e.name} x (m)`, `${q.e.name} height (m)`, `${q.e.name} speed (m/s)`]), 'energy (J)', 'work by the air (J)'];
  const rows: number[][] = [];
  const yE = simulate(f, y0, s, (t, y) => rows.push([t, ...O.flatMap((q, i) => [y[4 * i], y[4 * i + 1], Math.hypot(y[4 * i + 2], y[4 * i + 3])]), E(y), y[4 * N]]), undefined, (t, y) => {
    O.forEach((q, i) => {
      if (q.landed || y[4 * i + 1] > 0) return;
      // touchdown: interpolate back to the ground and stop there (its kinetic energy goes into the landing)
      const vy = y[4 * i + 3], back = vy < 0 ? y[4 * i + 1] / vy : 0;
      q.landed = true; q.landT = t - back; q.landX = y[4 * i] - y[4 * i + 2] * back; q.vLand = Math.hypot(y[4 * i + 2], vy);
      lost += 0.5 * q.m * (y[4 * i + 2] ** 2 + vy ** 2) + q.m * g * y[4 * i + 1];
      y[4 * i] = q.landX; y[4 * i + 1] = 0; y[4 * i + 2] = 0; y[4 * i + 3] = 0;
    });
    return y;
  });
  const E0 = E(y0);
  const checks: Check[] = [energyCheck('energy: kinetic + height − work by the air + landings = start', E0, E(yE) - yE[4 * N] + lost, Math.max(Math.abs(E0), ...O.map((q) => q.m * g * Math.max(q.y, 1))), s.method, 1e-6)];
  const still = wind === 0 && !fans.length;
  O.forEach((q, i) => {
    if (!q.ball || !still) return;
    // terminal speed: weight − buoyancy = ½ρ Cd(Re) A v²
    const Wn = (q.m - rho * q.V) * g;
    if (Wn <= 0) return;
    let lo = 0, hi = 1e4;
    for (let k = 0; k < 200; k++) { const v = (lo + hi) / 2; if (0.5 * rho * v * v * q.A * cdSphere((rho * v * q.d) / mu) > Wn) hi = v; else lo = v; }
    const vt = (lo + hi) / 2, vmax = Math.max(...rows.map((r) => r[3 + 3 * i]), q.vLand || 0);
    const vy0 = n(q.e.v.v0, 0);
    if (vy0 === 0) checks.push({ l: `${q.e.name}: terminal speed (weight − buoyancy = drag)`, exp: vt, act: vmax, u: 'm/s', tol: 2e-3, ref: vmax < 0.995 * vt });
  });
  O.forEach((q, i) => {
    if (q.ball || !still || !q.landed) return;
    // steady glide: distance / height lost = L/D (reference: the launch transient is included)
    checks.push({ l: `${q.e.name}: glide ratio ≈ CL/CD`, exp: q.CL / q.CD, act: Math.abs(q.landX - q.x) / Math.max(1e-9, q.y), tol: 0.05, ref: true });
    void i;
  });
  const xsAll = rows.flatMap((r) => O.map((_, i) => r[1 + 3 * i])), hsAll = rows.flatMap((r) => O.map((_, i) => r[2 + 3 * i]));
  const x0 = Math.min(0, ...xsAll), x1 = Math.max(SCENE_W * scale, ...xsAll), y1 = Math.max(GROUND * scale, ...hsAll) * 1.05;
  return {
    cols, rows, checks,
    notes: ['every object starts where you put it; fans blow a column of rising air straight up from their spot', ...(O.some((q) => !q.landed) ? ['some objects are still in the air at the end: raise the step count'] : [])],
    scalars: O.flatMap((q) => [{ l: `${q.e.name}: landed after`, v: q.landT, u: 's' }, { l: `${q.e.name}: landed at x`, v: q.landX, u: 'm' }, { l: `${q.e.name}: landing speed`, v: q.vLand, u: 'm/s' }, ...(q.ball ? [{ l: `${q.e.name}: mass`, v: q.m * 1000, u: 'g' }] : [{ l: `${q.e.name}: lift / drag`, v: q.CL / q.CD }])]),
    charts: [
      { id: 'path', title: 'flight paths', xl: 'x (m)', yl: 'height (m)', equal: true, series: O.map((q, i) => ({ name: q.e.name, x: rows.map((r) => r[1 + 3 * i]), y: rows.map((r) => r[2 + 3 * i]) })) },
      tchart(cols, rows, 'v', 'speed', O.map((q) => `${q.e.name} speed (m/s)`), 'm/s'),
      tchart(cols, rows, 'E', 'energy', ['energy (J)', 'work by the air (J)'], 'J'),
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(x0, x1, -0.03 * y1, y1, 14);
      G.ground(x0, x1, 0);
      for (const fa of fans) {
        for (let h = 0; h < fa.H; h += Math.max(fa.H / 8, 1e-3)) G.arrow(fa.x, fa.y + h, 0, Math.min(fa.H / 10, fa.w * 0.3), COL.c);
        sprite(G, fa.e.sprite, fa.x, fa.y, 2);
      }
      if (wind) G.arrow(x0 + 0.05 * (x1 - x0), 0.92 * y1, Math.sign(wind) * 0.06 * (x1 - x0), 0, COL.c, `wind ${wind} m/s`);
      O.forEach((q, i) => {
        G.path(rows.slice(0, k + 1).map((r) => r[1 + 3 * i]), rows.slice(0, k + 1).map((r) => r[2 + 3 * i]), COL.grid);
        sprite(G, q.e.sprite, rw[1 + 3 * i], rw[2 + 3 * i], 2);
        label(G, `${q.e.name} ${rw[3 + 3 * i].toFixed(1)} m/s`, rw[1 + 3 * i], rw[2 + 3 * i], COL.dim, -14);
      });
      G.hud([`t=${rw[0].toFixed(2)} s  ${N} in the air · ${fans.length} fan${fans.length === 1 ? '' : 's'} · wind ${wind} m/s`, `ρ=${rho} kg/m³  μ=${mu} Pa·s`]);
    },
  };
}

export const aeroScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'falling spheres, gliders and rising air from fans in one sky, with wind: drag from Cd(Re), lift from the wing',
  settings: { dt: 0.002, steps: 10000, method: 'rk4' }, timeBased: true,
  envDefs: [
    { k: 'rho', l: 'air density', u: 'kg/m3', v: 1.225, min: 0, s: 0.05, d: 'Sea level ≈ 1.225; at 3000 m ≈ 0.91.' },
    { k: 'mu', l: 'air viscosity', u: 'Pa s', v: 1.81e-5, min: 1e-9, s: 1e-6, d: 'Dynamic viscosity (sets the Reynolds number).' },
    { k: 'g', l: 'gravity', u: 'm/s2', v: 9.80665, s: 0.1, d: 'Acceleration of free fall.' },
    { k: 'wind', l: 'wind (→ +)', u: 'm/s', v: 0, s: 1, d: 'Horizontal wind blowing on everything.' },
  ],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 2, min: 1e-3, s: 0.5, d: 'Size of one editor grid cell: sets drop heights.' }],
  where: 'objects start where you put them (height above the ground = drop height) · drag from a ball or glider to throw or launch it · fans blow air up from their spot',
  kinds: [
    { kind: 'ball', name: 'falling ball', sprite: 'raindrop', desc: 'a sphere dropped or thrown from here', aim: { kind: 'polar', speed: 'v0', angle: 'ang', per: 1 }, custom: [
      { k: 'd', l: 'diameter', u: 'm', v: 0.002, min: 1e-6, s: 0.001, d: 'Sphere diameter.' },
      { k: 'rhos', l: 'density', u: 'kg/m3', v: 1000, min: 0, s: 50, d: 'Material density (water 1000, ice 917, steel 7850). Lighter than air floats up.' },
      { k: 'v0', l: 'throw speed', u: 'm/s', v: 0, min: 0, s: 1, d: 'Launch speed (drag from it in EDIT).' },
      { k: 'ang', l: 'throw angle', u: 'deg', v: 0, s: 5, d: 'Launch angle above horizontal.' },
    ] },
    { kind: 'glider', name: 'glider', sprite: 'glider', desc: 'a wing launched from here', aim: { kind: 'polar', speed: 'v0', angle: 'ang', per: 1 }, custom: [
      { k: 'm', l: 'mass', u: 'kg', v: 0.01, min: 1e-6, s: 0.01, d: 'All-up mass.' },
      { k: 'S', l: 'wing area', u: 'm2', v: 0.02, min: 1e-6, s: 0.01, d: 'Wing planform area.' },
      { k: 'AR', l: 'aspect ratio', v: 6, min: 0.1, s: 1, d: 'span² / area: long thin wings have less induced drag.' },
      { k: 'alpha', l: 'trim angle of attack', u: 'deg', v: 5, s: 0.5, d: 'Angle the wing meets the air at (CL = 2πα/(1+2/AR)).' },
      { k: 'CD0', l: 'parasite drag CD0', v: 0.03, min: 0, s: 0.005, d: 'Drag at zero lift.' },
      { k: 'e', l: 'span efficiency', v: 0.85, min: 0.1, max: 1, s: 0.05, d: 'Oswald factor for induced drag.' },
      { k: 'v0', l: 'launch speed', u: 'm/s', v: 6, min: 0, s: 1, d: 'Launch speed (drag from it in EDIT).' },
      { k: 'ang', l: 'launch angle', u: 'deg', v: 0, s: 5, d: 'Launch angle above horizontal.' },
    ] },
    { kind: 'fan', name: 'fan / thermal', sprite: 'fan', desc: 'blows a column of air straight up', custom: [
      { k: 'w', l: 'updraft speed', u: 'm/s', v: 5, s: 0.5, d: 'Upward air speed at the centre of the column.' },
      { k: 'b', l: 'column width', u: 'm', v: 4, min: 1e-3, s: 0.5, d: 'Width of the rising column.' },
      { k: 'H', l: 'column height', u: 'm', v: 30, min: 0, s: 2, d: 'How high the air keeps rising.' },
    ] },
  ],
  presets: [
    { name: 'raindrop', kind: 'ball', sprite: 'raindrop', desc: '2 mm water drop', v: { d: 0.002, rhos: 1000 } },
    { name: 'hailstone', kind: 'ball', sprite: 'hailstone', desc: '2 cm ice ball', v: { d: 0.02, rhos: 917 } },
    { name: 'skydiver (ball model)', kind: 'ball', sprite: 'skydiver', desc: '80 kg as a 0.6 m sphere', v: { d: 0.6, rhos: 707 } },
    { name: 'ping-pong ball', kind: 'ball', sprite: 'golfball', desc: '40 mm, 2.7 g', v: { d: 0.04, rhos: 80.6 } },
    { name: 'paper plane', kind: 'glider', sprite: 'glider', desc: '5 g dart', v: { m: 0.005, S: 0.015, AR: 3, alpha: 6, CD0: 0.05, v0: 6 } },
    { name: 'sailplane', kind: 'glider', sprite: 'glider', desc: '400 kg, 15 m span', v: { m: 400, S: 10.5, AR: 21, alpha: 4, CD0: 0.01, e: 0.9, v0: 39 } },
    { name: 'Cessna 172 (engine off)', kind: 'glider', sprite: 'cessna', desc: '1000 kg, 16 m² wing', v: { m: 1000, S: 16.2, AR: 7.3, alpha: 5, CD0: 0.027, e: 0.75, v0: 40 } },
    { name: 'thermal', kind: 'fan', sprite: 'fan', desc: 'rising warm air, 3 m/s', v: { w: 3, b: 40, H: 60 } },
  ],
  start: [['raindrop', 8, 4], ['hailstone', 14, 4], ['paper plane', 22, 20], ['fan', 40, GROUND, { w: 6, b: 6, H: 40 }]],
  tests: [
    { name: 'raindrop falls (terminal speed)', list: [['raindrop', 30, 2]] },
    { name: 'hailstone falls (terminal speed)', list: [['hailstone', 30, 2]], p: { ws_scale: 10 }, s: { steps: 20000 } },
    { name: 'sailplane glides', list: [['sailplane', 2, 24]], p: { ws_scale: 10 }, s: { dt: 0.01, steps: 20000 } },
    { name: 'windy fan', list: [['ping-pong ball', 20, 10], ['fan', 24, GROUND]], p: { wind: 2 } },
  ],
  guide(g, X, Y, cp) { g.fillStyle = '#8b5a2b'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2); },
};
