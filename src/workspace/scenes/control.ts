// Control, one airspace: every controlled object (a drone, a lift, a sprung platform) starts at the height you
// put it and its PID controller drives it to the height of the nearest target marker. Objects in the same column
// can bump into each other; a gust pushes on all of them, and the sensors can lag. Moving a target retunes the
// whole scene.
import type { Catalog } from '../catalog';
import { n, str, emptyScene, tchart, sprite, label, every, COL, GROUND, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.5), g = n(p.g, 9.80665), dist = n(p.dist, 0), tg = n(p.tg, 5), td = Math.max(0, n(p.td, 0));
  const objE = ents.filter((e) => e.kind === 'ctl').sort((a, b) => a.x - b.x), tgts = ents.filter((e) => e.kind === 'target');
  if (!objE.length) return emptyScene('nothing to control: press E and add a drone, lift or platform');
  const O = objE.map((e) => {
    const t = tgts.slice().sort((a, b) => Math.abs(a.x - e.x) - Math.abs(b.x - e.x))[0];
    const y0 = Math.max(0, (GROUND - e.y) * scale), m = Math.max(1e-6, n(e.v.m, 1.2)), k = n(e.v.k, 0);
    return { e, t, m, c: n(e.v.c, 0.5), k, yRest: y0, r: t ? Math.max(0, (GROUND - t.y) * scale) : y0, r2: t ? n(t.v.h2, NaN) : NaN, t2: t ? n(t.v.t2, Infinity) : Infinity, Kp: n(e.v.Kp, 40), Ki: n(e.v.Ki, 10), Kd: n(e.v.Kd, 12), umax: n(e.v.umax, 50), y: y0, v: 0, I: 0, ePrev: NaN, u: 0, sat: 0, h: Math.max(0.05, n(e.v.size, 0.4)) };
  });
  const N = O.length, dt = s.dt, steps = s.steps, ev = every(steps);
  // stacks: objects in the same column can land on each other (stiff contact)
  const stacks: number[][] = [];
  O.forEach((q, i) => { const st = stacks.find((S) => Math.abs(O[S[0]].e.x - q.e.x) <= 2); if (st) st.push(i); else stacks.push([i]); });
  const hist: number[][] = [];
  const meas = (i: number, t: number) => {
    if (td <= 0) return O[i].y;
    const tt = t - td; if (tt <= 0) return hist[0][i];
    const j = tt / dt, j0 = Math.floor(j), f = j - j0;
    return hist[Math.min(j0, hist.length - 1)][i] * (1 - f) + hist[Math.min(j0 + 1, hist.length - 1)][i] * f;
  };
  const setp = (q: (typeof O)[number], t: number) => (t >= q.t2 && Number.isFinite(q.r2) ? q.r2 : q.r);
  let Wu = 0, Wd = 0, Wc = 0, Wcon = 0;
  const kc = (q: (typeof O)[number]) => q.m * (2 * Math.PI / (30 * dt)) ** 2;
  const forces = (y: number[], v: number[], t: number) => {
    const F = O.map((q, i) => q.u - q.m * g - q.c * v[i] - q.k * (y[i] - q.yRest) + (t >= tg ? dist : 0));
    const Fc = new Array(N).fill(0);
    for (const S of stacks) {
      const ord = S.slice().sort((a, b) => y[a] - y[b]);
      // ground
      const b0 = ord[0]; if (y[b0] < 0) Fc[b0] += kc(O[b0]) * -y[b0] - 2 * Math.sqrt(kc(O[b0]) * O[b0].m) * Math.min(0, v[b0]);
      for (let j = 0; j < ord.length - 1; j++) {
        const lo = ord[j], hi = ord[j + 1], ov = y[lo] + O[lo].h - y[hi];
        if (ov > 0) { const mm = (O[lo].m * O[hi].m) / (O[lo].m + O[hi].m), K = mm * (2 * Math.PI / (30 * dt)) ** 2, f = Math.max(0, K * ov + 2 * Math.sqrt(K * mm) * (v[lo] - v[hi])); Fc[hi] += f; Fc[lo] -= f; }
      }
    }
    return [F, Fc];
  };
  const cols = ['t', ...O.flatMap((q) => [`${q.e.name} height (m)`, `${q.e.name} setpoint (m)`, `${q.e.name} thrust (N)`]), 'thrust work (J)', 'energy (J)'];
  const rows: number[][] = [];
  const E = () => O.reduce((a, q) => a + 0.5 * q.m * q.v * q.v + q.m * g * q.y + 0.5 * q.k * (q.y - q.yRest) ** 2, 0);
  const E0 = E();
  const rec = (t: number) => rows.push([t, ...O.flatMap((q) => [q.y, setp(q, t), q.u]), Wu, E()]);
  hist.push(O.map((q) => q.y));
  for (let k = 0; k < steps; k++) {
    const t = k * dt;
    // discrete PID (zero-order hold), derivative on the measurement, integrator frozen while saturated
    O.forEach((q, i) => {
      const ym = meas(i, t), e = setp(q, t) - ym, dmeas = Number.isNaN(q.ePrev) ? 0 : -(ym - q.ePrev) / dt;
      const uRaw = q.Kp * e + q.Ki * q.I + q.Kd * dmeas, u = Math.max(0, Math.min(q.umax, uRaw));
      if (u === uRaw || Math.sign(e) !== Math.sign(uRaw - u)) q.I += e * dt;
      q.sat += u !== uRaw ? dt : 0; q.u = u; q.ePrev = ym;
    });
    if (k === 0) rec(0);
    // plant: rk4 over the step with the held thrust
    const y = O.map((q) => q.y), v = O.map((q) => q.v);
    const acc = (yy: number[], vv: number[], tt: number) => { const [F, Fc] = forces(yy, vv, tt); return O.map((q, i) => (F[i] + Fc[i]) / q.m); };
    const a1 = acc(y, v, t), y2 = y.map((x, i) => x + (dt / 2) * v[i]), v2 = v.map((x, i) => x + (dt / 2) * a1[i]);
    const a2 = acc(y2, v2, t + dt / 2), y3 = y.map((x, i) => x + (dt / 2) * v2[i]), v3 = v.map((x, i) => x + (dt / 2) * a2[i]);
    const a3 = acc(y3, v3, t + dt / 2), y4 = y.map((x, i) => x + dt * v3[i]), v4 = v.map((x, i) => x + dt * a3[i]);
    const a4 = acc(y4, v4, t + dt);
    O.forEach((q, i) => {
      const dy = (dt / 6) * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]), vn = v[i] + (dt / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]);
      // work by thrust and gust (constant over the step) — damping and contacts take the rest
      Wu += q.u * dy; Wd += (t >= tg ? dist : 0) * dy; Wc += q.c * ((v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]) / 6) ** 2 * dt;
      q.y += dy; q.v = vn;
    });
    void Wcon;
    hist.push(O.map((q) => q.y));
    if ((k + 1) % ev === 0 || k + 1 === steps) rec((k + 1) * dt);
  }
  const checks: Check[] = [];
  const contacts = stacks.some((S) => S.length > 1) || O.some((q) => Math.min(...rows.map((r) => r[1 + 3 * O.indexOf(q)])) < 0);
  checks.push({ l: 'energy: kinetic + height + spring = start + thrust & gust work − damping', exp: E0 + Wu + Wd - Wc, act: E(), u: 'J', tol: 2e-3, ref: contacts || O.some((q) => q.c > 0) });
  const last = rows[rows.length - 1], tEnd = last[0];
  O.forEach((q, i) => {
    const settled = rows.filter((r) => r[0] >= 0.8 * tEnd).every((r) => Math.abs(r[1 + 3 * i] - last[1 + 3 * i]) < 1e-4 * Math.max(1, Math.abs(last[1 + 3 * i])));
    if (!settled || contacts) return;
    const r = setp(q, tEnd), Fext = dist * (tEnd >= tg ? 1 : 0);
    // steady state: with integral action the error goes to zero; with PD alone Kp·e balances the load
    const exp = q.Ki > 0 ? r : (q.Kp * r + Fext - q.m * g + q.k * q.yRest) / (q.Kp + q.k);
    const unsat = last[3 + 3 * i] > 0 && last[3 + 3 * i] < q.umax;
    checks.push({ l: q.Ki > 0 ? `${q.e.name}: no steady-state error (integral action)` : `${q.e.name}: steady-state droop (Kp·r − mg + kx₀)/(Kp + k)`, exp, act: last[1 + 3 * i], u: 'm', tol: 1e-5, ref: !unsat });
    if (q.Ki === 0 && q.k === 0 && td === 0 && q.sat === 0 && Math.min(...rows.map((rw) => rw[3 + 3 * i])) > 0) {
      const wn = Math.sqrt(q.Kp / q.m), z = (q.c + q.Kd) / (2 * Math.sqrt(q.Kp * q.m));
      if (z < 1 && z > 0) {
        const step0 = rows[0][1 + 3 * i], fin = last[1 + 3 * i], pk = Math.max(...rows.map((rw) => (rw[1 + 3 * i] - step0) * Math.sign(fin - step0)));
        checks.push({ l: `${q.e.name}: overshoot e^(−πζ/√(1−ζ²)) (continuous-time theory)`, exp: 100 * Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z)), act: (100 * (pk - Math.abs(fin - step0))) / Math.abs(fin - step0), u: '%', tol: 0.05, ref: true });
        void wn;
      }
    }
  });
  const hmax = Math.max(GROUND * scale, ...rows.flatMap((r) => O.map((_, i) => r[1 + 3 * i]))) * 1.05;
  return {
    cols, rows, checks,
    notes: ['each object holds the height of the target nearest to it sideways · objects in the same column can bump into each other and land on the ground', ...O.filter((q) => q.sat > 0).map((q) => `${q.e.name}: thrust hit its limit for ${q.sat.toFixed(2)} s (integrator frozen meanwhile)`)],
    scalars: O.flatMap((q, i) => {
      const r = rows.map((rw) => rw[1 + 3 * i]), fin = r[r.length - 1], st = rows.findIndex((_, k) => rows.slice(k).every((rw) => Math.abs(rw[1 + 3 * i] - rw[2 + 3 * i]) <= 0.02 * Math.max(1e-9, Math.abs(rw[2 + 3 * i] - rows[0][1 + 3 * i]))));
      return [{ l: `${q.e.name}: final height`, v: fin, u: 'm' }, { l: `${q.e.name}: settles (±2%) after`, v: st >= 0 ? rows[st][0] : NaN, u: 's' }, { l: `${q.e.name}: peak thrust`, v: Math.max(...rows.map((rw) => rw[3 + 3 * i])), u: 'N' }];
    }),
    charts: [
      tchart(cols, rows, 'y', 'heights and setpoints', O.flatMap((q) => [`${q.e.name} height (m)`, `${q.e.name} setpoint (m)`]), 'm'),
      tchart(cols, rows, 'u', 'thrust', O.map((q) => `${q.e.name} thrust (N)`), 'N'),
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)], W = SCENE_W * scale;
      G.view(0, W, -0.03 * hmax, hmax, 14);
      G.ground(0, W, 0);
      for (const t of tgts) { const ty = Math.max(0, (GROUND - t.y) * scale); G.line(t.x * scale - 1.5, ty, t.x * scale + 1.5, ty, COL.d, 1, [3, 3]); sprite(G, t.sprite, t.x * scale, ty, 2); }
      O.forEach((q, i) => {
        const x = q.e.x * scale, y = rw[1 + 3 * i], r = rw[2 + 3 * i];
        G.line(x, r, x + 1.5 * scale, r, COL.d, 2);
        if (q.k > 0) G.spring(x, 0, x, y, COL.dim, 8, 4);
        sprite(G, q.e.sprite, x, y, 2);
        if (rw[3 + 3 * i] > 0) G.arrow(x, y, 0, (rw[3 + 3 * i] / Math.max(q.umax, 1e-9)) * 0.1 * hmax, COL.f);
        label(G, `${q.e.name} ${y.toFixed(2)} m → ${r.toFixed(2)} m`, x, y, COL.dim, -16);
      });
      G.hud([`t=${rw[0].toFixed(2)} s  ${N} controlled · ${tgts.length} target${tgts.length === 1 ? '' : 's'}${dist ? ` · gust ${dist} N from ${tg} s` : ''}${td ? ` · sensor lag ${td} s` : ''}`, 'red line = setpoint · yellow arrow = thrust']);
    },
  };
}

export const controlScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'drones, lifts and platforms each holding the height of a target with their own PID, sharing gusts, lag and airspace',
  settings: { dt: 0.002, steps: 7500, method: 'rk4' }, timeBased: true,
  envDefs: [
    { k: 'g', l: 'gravity', u: 'm/s2', v: 9.80665, s: 0.1, d: 'Acceleration of free fall (the load every controller fights).' },
    { k: 'dist', l: 'gust force (up +)', u: 'N', v: 0, s: 1, d: 'A steady push on every object once the gust starts.' },
    { k: 'tg', l: 'gust starts at', u: 's', v: 5, min: 0, s: 0.5, d: 'Time the gust arrives.' },
    { k: 'td', l: 'sensor lag', u: 's', v: 0, min: 0, s: 0.01, d: 'Delay before each controller sees its height: too much makes loops oscillate.' },
  ],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.5, min: 1e-3, s: 0.1, d: 'Size of one editor grid cell: sets start heights and target heights.' }],
  where: 'each object starts at the height you put it and climbs to the height of the nearest target (sideways) · objects in one column can land on each other',
  kinds: [
    { kind: 'ctl', name: 'controlled object', sprite: 'drone', desc: 'a mass with a PID-driven thrust', custom: [
      { k: 'm', l: 'mass', u: 'kg', v: 1.2, min: 1e-6, s: 0.1, d: 'Mass to lift.' },
      { k: 'c', l: 'air damping', u: 'N s/m', v: 0.5, min: 0, s: 0.1, d: 'Natural damping.' },
      { k: 'k', l: 'spring to its start height', u: 'N/m', v: 0, min: 0, s: 5, d: 'For a sprung platform: pulls back to where it started.' },
      { k: 'Kp', l: 'Kp (proportional)', u: 'N/m', v: 40, min: 0, s: 5, d: 'Push per metre of error.' },
      { k: 'Ki', l: 'Ki (integral)', u: 'N/(m s)', v: 10, min: 0, s: 1, d: 'Removes steady error (carries the weight).' },
      { k: 'Kd', l: 'Kd (derivative)', u: 'N s/m', v: 12, min: 0, s: 1, d: 'Damps the motion.' },
      { k: 'umax', l: 'max thrust', u: 'N', v: 50, min: 0, s: 5, d: 'Motors saturate here (thrust can\'t pull down).' },
      { k: 'size', l: 'height of the object', u: 'm', v: 0.4, min: 0.05, s: 0.1, d: 'For stacking contact.' },
    ] },
    { kind: 'target', name: 'target height', sprite: 'target', desc: 'the setpoint: its height is where the nearest object should hold', custom: [
      { k: 'h2', l: 'later moves to (blank = stays)', u: 'm', v: '', s: 0.5, d: 'Optional second setpoint height.' },
      { k: 't2', l: 'moves at', u: 's', v: 8, min: 0, s: 0.5, d: 'Time of the setpoint change.' },
    ] },
  ],
  presets: [
    { name: 'drone altitude hold', kind: 'ctl', sprite: 'drone', desc: '1.2 kg quadcopter', v: { m: 1.2, c: 0.5, k: 0, Kp: 40, Ki: 10, Kd: 12, umax: 30 } },
    { name: 'goods lift', kind: 'ctl', sprite: 'crate', desc: '200 kg, slow and strong', v: { m: 200, c: 50, k: 0, Kp: 4000, Ki: 800, Kd: 2500, umax: 4000, size: 1 } },
    { name: 'sprung platform', kind: 'ctl', sprite: 'carspring', desc: '20 kg on a 2 kN/m spring, PD', v: { m: 20, c: 5, k: 2000, Kp: 3000, Ki: 0, Kd: 150, umax: 3000 } },
    { name: 'P-only drone', kind: 'ctl', sprite: 'drone', desc: 'no I or D: droops and wobbles', v: { m: 1.2, c: 0.5, k: 0, Kp: 40, Ki: 0, Kd: 0, umax: 100 } },
  ],
  start: [['drone altitude hold', 14, GROUND], ['target', 18, 14], ['drone altitude hold', 30, 26, { Kd: 2 }], ['target', 34, 10], ['goods lift', 50, GROUND], ['target', 54, 20, { h2: 2, t2: 8 }]],
  tests: [
    { name: 'drone climbs (PID)', list: [['drone altitude hold', 32, GROUND], ['target', 34, 14]], p: { dist: 0 }, s: { steps: 15000 } },
    { name: 'PD droop', list: [['ctl', 32, 22, { Ki: 0, Kd: 8, umax: 1e6 }], ['target', 34, 20]] },
    { name: 'stacked drones + gust', list: [['drone altitude hold', 32, GROUND], ['drone altitude hold', 32, 30], ['target', 30, 20], ['target', 34, 22]], p: { dist: -3 } },
  ],
  guide(g, X, Y, cp) { g.fillStyle = '#8b5a2b'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2); },
};
