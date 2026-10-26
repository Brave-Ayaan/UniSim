// Coupled scene engines for objects added in EDIT: they interact with each other and with the
// module's global environment (gravity, damping, …).
import type { Params, Result, Settings, Check, Chart } from '../core/types';
import { step, GCONST, agm, crossings, meanPeriod, DEG, maxOf, minOf } from '../core/num';
import { COL, type Gfx } from '../core/gfx';
import { SPRITES, SPRITE_COLORS, drawSprite } from './sprites';

export interface Ent { id: number; kind: string; name: string; x: number; y: number; sprite: string; v: Params }
export const SCENE_W = 64, SCENE_H = 36;
export const GROUND = 34; // scene row of the ground line
const N_CONTACT = 40; // a contact is resolved over ≈40 integration steps
const n = (v: unknown, d = 0) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const zetaOf = (e: number) => (e >= 1 ? 0 : e <= 0 ? 1 : -Math.log(e) / Math.sqrt(Math.PI ** 2 + Math.log(e) ** 2));
/** most common non-outline colour of a sprite: used to paint the object in the simulation view */
export function spriteColor(name: string) {
  const cnt: Record<string, number> = {};
  for (const r of SPRITES[name] ?? []) for (const ch of r) if (ch !== '.' && ch !== 'k') cnt[ch] = (cnt[ch] ?? 0) + 1;
  const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0];
  return SPRITE_COLORS[best ?? 's'] ?? '#b0b8c4';
}
function every(steps: number) { return Math.max(1, Math.ceil(steps / 800)); }
function auditCheck(E0: number, Eend: number, diss: number, scale: number, method: string): Check {
  return { l: `energy audit: E_end + dissipated = E_0${method === 'rk4' ? '' : ' (first-order method)'}`, exp: E0, act: Eend + diss, u: 'J', abs: 2e-3 * Math.max(scale, 1e-12), ref: method !== 'rk4' };
}

// ---------------------------------------------------------------- pendulums
export function pendulumScene(p: Params, s: Settings, ents: Ent[]): Result {
  const N = ents.length;
  const g = n(p.g, 9.80665), c = n(p.c, 0);
  const balls = p.ws_balls !== 'off', rope = p.ws_rope !== 'off', scale = n(p.ws_scale, 0.1);
  const L = ents.map((q) => Math.max(1e-3, n(q.v.L, 1))), m = ents.map((q) => Math.max(1e-9, n(q.v.m, 1))), r = ents.map((q) => Math.max(1e-4, n(q.v.r, 0.1)));
  const px = ents.map((q) => (q.x - SCENE_W / 2) * scale);
  const dt = s.dt, om2 = (Math.PI / (N_CONTACT * dt)) ** 2;
  const eb = ents.map((q) => Math.min(1, Math.max(0, n(q.v.e, 0.98)))), zeta = (i: number, j: number) => zetaOf(Math.min(eb[i], eb[j]));
  let pdSum = 0, contacts = 0, elastic = 0;
  const touched = new Uint8Array(N);
  const bob = (th: number, i: number): [number, number] => [px[i] + L[i] * Math.sin(th), -L[i] * Math.cos(th)];
  const forces = (y: number[], stats: boolean) => {
    const tq = new Array(N).fill(0);
    pdSum = 0;
    if (stats) { contacts = 0; elastic = 0; }
    const B = ents.map((_, i) => bob(y[i], i));
    const V = ents.map((_, i) => [L[i] * y[N + i] * Math.cos(y[i]), L[i] * y[N + i] * Math.sin(y[i])]);
    const contact = (ov: number, nx: number, ny: number, vn: number, Meff: number, z: number) => {
      const kn = Meff * om2, gam = 2 * z * Math.sqrt(Meff * kn);
      const fe = kn * ov, Fn = Math.max(0, fe + gam * vn);
      pdSum += (Fn - fe) * vn;
      if (stats) { contacts++; elastic += 0.5 * kn * ov * ov; }
      return [Fn * nx, Fn * ny];
    };
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (i === j) continue;
      if (balls && j > i) {
        const dx = B[j][0] - B[i][0], dy = B[j][1] - B[i][1], d = Math.hypot(dx, dy), R = r[i] + r[j];
        if (d < R && d > 0) {
          const nx = dx / d, ny = dy / d, vn = (V[i][0] - V[j][0]) * nx + (V[i][1] - V[j][1]) * ny;
          const [fx, fy] = contact(R - d, nx, ny, vn, (m[i] * m[j]) / (m[i] + m[j]), zeta(i, j));
          // force −F on i, +F on j → torques about each pivot
          tq[i] += (B[i][0] - px[i]) * -fy - B[i][1] * -fx;
          tq[j] += (B[j][0] - px[j]) * fy - B[j][1] * fx;
          if (stats) touched[i] = touched[j] = 1;
        }
      }
      if (rope) {
        // ball j against the rope of pendulum i (pivot → bob)
        const ax = px[i], ay = 0, bx = B[i][0], by = B[i][1];
        const sx = bx - ax, sy = by - ay, l2 = sx * sx + sy * sy;
        const u = Math.max(0, Math.min(1, ((B[j][0] - ax) * sx + (B[j][1] - ay) * sy) / l2));
        if (u > 1 - (r[i] + r[j]) / L[i]) continue; // near the bob: that is a ball-ball contact
        const qx = ax + u * sx, qy = ay + u * sy;
        const dx = B[j][0] - qx, dy = B[j][1] - qy, d = Math.hypot(dx, dy);
        if (d < r[j] && d > 0) {
          const nx = dx / d, ny = dy / d; // from rope to ball
          const sDist = u * L[i];
          const vq = [sDist * y[N + i] * Math.cos(y[i]), sDist * y[N + i] * Math.sin(y[i])];
          const vn = (vq[0] - V[j][0]) * nx + (vq[1] - V[j][1]) * ny;
          const Meff = 1 / (1 / m[j] + (sDist * sDist) / (m[i] * L[i] * L[i] + 1e-30));
          const [fx, fy] = contact(r[j] - d, nx, ny, vn, Meff, zeta(i, j));
          tq[j] += (B[j][0] - px[j]) * fy - B[j][1] * fx;
          tq[i] += (qx - px[i]) * -fy - qy * -fx;
          if (stats) touched[i] = touched[j] = 1;
        }
      }
    }
    return tq;
  };
  const f = (_t: number, y: number[]) => {
    const tq = forces(y, false);
    const d = new Array(2 * N + 1);
    let damp = 0;
    for (let i = 0; i < N; i++) {
      d[i] = y[N + i];
      d[N + i] = -(g / L[i]) * Math.sin(y[i]) - c * y[N + i] + tq[i] / (m[i] * L[i] * L[i]);
      damp += m[i] * L[i] * L[i] * c * y[N + i] * y[N + i];
    }
    d[2 * N] = pdSum + damp;
    return d;
  };
  const energy = (y: number[]) => {
    let KE = 0, PE = 0;
    for (let i = 0; i < N; i++) { KE += 0.5 * m[i] * L[i] * L[i] * y[N + i] ** 2; PE += m[i] * g * L[i] * (1 - Math.cos(y[i])); }
    forces(y, true);
    return { KE, PE, E: KE + PE + elastic };
  };
  let y = [...ents.map((q) => n(q.v.th) * DEG), ...ents.map((q) => n(q.v.w)), 0];
  const e0 = energy(y);
  const cols = ['t', ...ents.flatMap((q) => [`${q.name} θ (deg)`, `${q.name} ω`, `${q.name} x`, `${q.name} y`]), 'contacts', 'KE', 'PE', 'E', 'dissipated'];
  const rows: number[][] = [];
  const rec = (t: number) => {
    const en = energy(y);
    rows.push([t, ...ents.flatMap((_, i) => { const b = bob(y[i], i); return [y[i] / DEG, y[N + i], b[0], b[1]]; }), contacts, en.KE, en.PE, en.E, y[2 * N]]);
  };
  rec(0);
  const ev = every(s.steps);
  for (let k = 1; k <= s.steps; k++) {
    y = step(f, (k - 1) * dt, y, dt, s.method, N);
    forces(y, true);
    if (k % ev === 0 || k === s.steps) rec(k * dt);
  }
  const last = rows[rows.length - 1];
  const checks: Check[] = [auditCheck(e0.E, last[last.length - 2], last[last.length - 1], Math.max(e0.E, maxOf(rows.map((q) => q[q.length - 4]))), s.method)];
  // pendulums that never touched anything follow the exact large-angle period
  ents.forEach((q, i) => {
    if (touched[i] || c > 0 || checks.length > 4) return;
    const E = 0.5 * L[i] * L[i] * n(q.v.w) ** 2 + g * L[i] * (1 - Math.cos(n(q.v.th) * DEG));
    const cmax = 1 - E / (g * L[i]);
    if (cmax <= -1 || E <= 0) return;
    const T = (2 * Math.PI * Math.sqrt(L[i] / g)) / agm(1, Math.cos(Math.acos(cmax) / 2));
    const Tm = meanPeriod(crossings(rows.map((rw) => rw[0]), rows.map((rw) => rw[1 + 4 * i]), 0, -1));
    if (Number.isFinite(Tm)) checks.push({ l: `${q.name} period (exact elliptic)`, exp: T, act: Tm, u: 's', tol: 2e-3 });
  });
  // Newton's cradle: the far ball should swing out about as far as the first one was lifted
  const order = ents.map((_, i) => i).sort((a, b) => px[a] - px[b]);
  const lifted = order.find((i) => Math.abs(n(ents[i].v.th)) > 1);
  if (N >= 3 && balls && lifted === order[0] && order.every((i, k) => k === 0 || Math.abs(px[i] - px[order[k - 1]] - r[i] - r[order[k - 1]]) < 0.2 * r[i])) {
    const lastI = order[N - 1];
    checks.push({ l: 'cradle: far ball swings out as high as the first was lifted', exp: Math.abs(n(ents[lifted].v.th)), act: maxOf(rows.map((rw) => Math.abs(rw[1 + 4 * lastI]))), u: 'deg', tol: 0.1, ref: true });
  }
  const charts: Chart[] = [
    { id: 'th', title: 'pendulum angles', xl: 't', yl: 'deg', tAxis: true, series: ents.map((q, i) => ({ name: q.name, x: rows.map((rw) => rw[0]), y: rows.map((rw) => rw[1 + 4 * i]) })) },
    { id: 'en', title: 'scene energy', xl: 't', yl: 'J', tAxis: true, series: ['KE', 'PE', 'E', 'dissipated'].map((nm) => ({ name: nm, x: rows.map((rw) => rw[0]), y: rows.map((rw) => rw[cols.indexOf(nm)]) })) },
  ];
  const extent = Math.max(...L.map((l, i) => l + r[i])) * 1.1;
  const xs = [minOf(px) - extent, maxOf(px) + extent];
  return {
    cols, rows, checks, charts,
    scalars: [{ l: 'pendulums', v: N }, { l: 'energy dissipated in impacts & damping', v: last[last.length - 1], u: 'J' }],
    notes: [`${N} pendulums from the ceiling bar · ball-ball ${balls ? 'on' : 'off'} · ball-rope ${rope ? 'on' : 'off'} · gravity & damping from the global settings`],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(xs[0], xs[1], -extent, extent * 0.15);
      G.line(xs[0], 0, xs[1], 0, COL.fg, 3);
      ents.forEach((q, i) => {
        const bx = rw[3 + 4 * i], by = rw[4 + 4 * i];
        G.line(px[i], 0, bx, by, COL.dim, 1);
        G.circle(bx, by, r[i], spriteColor(q.sprite), true);
        G.circle(bx, by, r[i], COL.bg);
      });
      G.hud([`t=${rw[0].toFixed(3)} s  ${N} pendulums  contacts ${rw[cols.indexOf('contacts')]}`, `E=${rw[cols.indexOf('E')].toFixed(4)} J  dissipated ${rw[cols.indexOf('dissipated')].toFixed(4)} J`]);
    },
  };
}

// ---------------------------------------------------------------- ball table
export function ballScene(p: Params, s: Settings, ents: Ent[]): Result {
  const N = ents.length;
  const scale = n(p.ws_scale, 0.05), walls = p.ws_walls !== 'off', T = Math.max(0.01, n(p.ws_T, 6));
  const W = SCENE_W * scale, H = SCENE_H * scale;
  const m = ents.map((q) => Math.max(1e-9, n(q.v.m, 0.17))), r = ents.map((q) => Math.max(1e-5, n(q.v.r, 0.028)));
  const vmax = Math.max(0.5, ...ents.map((q) => Math.hypot(n(q.v.vx), n(q.v.vy))));
  // contact stiffness from the smallest ball and fastest speed: overlap stays a few % of a radius
  const tc = (0.15 * minOf(r)) / vmax;
  const dt = tc / N_CONTACT, steps = Math.min(150000, Math.ceil(T / dt));
  const om2 = (Math.PI / tc) ** 2;
  const eb = ents.map((q) => Math.min(1, Math.max(0, n(q.v.e, 0.95)))), zeta = (i: number, j: number) => zetaOf(j >= 0 ? Math.min(eb[i], eb[j]) : eb[i]);
  let pd = 0, elastic = 0, contacts = 0;
  const f = (_t: number, y: number[], stats = false) => {
    const d = new Array(4 * N + 1).fill(0);
    pd = 0;
    if (stats) { elastic = 0; contacts = 0; }
    const hit = (i: number, j: number, ov: number, nx: number, ny: number) => {
      const Mi = m[i], Mj = j >= 0 ? m[j] : Infinity, Meff = j >= 0 ? (Mi * Mj) / (Mi + Mj) : Mi;
      const kn = Meff * om2, gam = 2 * zeta(i, j) * Math.sqrt(Meff * kn);
      const vn = (y[2 * N + 2 * i] - (j >= 0 ? y[2 * N + 2 * j] : 0)) * nx + (y[2 * N + 2 * i + 1] - (j >= 0 ? y[2 * N + 2 * j + 1] : 0)) * ny;
      const fe = kn * ov, Fn = Math.max(0, fe + gam * vn);
      pd += (Fn - fe) * vn;
      if (stats) { elastic += 0.5 * kn * ov * ov; contacts++; }
      d[2 * N + 2 * i] -= (Fn * nx) / Mi; d[2 * N + 2 * i + 1] -= (Fn * ny) / Mi;
      if (j >= 0) { d[2 * N + 2 * j] += (Fn * nx) / Mj; d[2 * N + 2 * j + 1] += (Fn * ny) / Mj; }
    };
    for (let i = 0; i < N; i++) {
      d[2 * i] = y[2 * N + 2 * i]; d[2 * i + 1] = y[2 * N + 2 * i + 1];
      for (let j = i + 1; j < N; j++) {
        const dx = y[2 * j] - y[2 * i], dy = y[2 * j + 1] - y[2 * i + 1], dd = Math.hypot(dx, dy), R = r[i] + r[j];
        if (dd < R && dd > 0) hit(i, j, R - dd, dx / dd, dy / dd);
      }
      if (walls) {
        const x = y[2 * i], yy = y[2 * i + 1];
        if (x < r[i]) hit(i, -1, r[i] - x, -1, 0);
        if (x > W - r[i]) hit(i, -1, x - (W - r[i]), 1, 0);
        if (yy < r[i]) hit(i, -1, r[i] - yy, 0, -1);
        if (yy > H - r[i]) hit(i, -1, yy - (H - r[i]), 0, 1);
      }
    }
    d[4 * N] = pd;
    return d;
  };
  let y = [...ents.flatMap((q) => [q.x * scale, (SCENE_H - q.y) * scale]), ...ents.flatMap((q) => [n(q.v.vx), n(q.v.vy)]), 0];
  const KE = (yy: number[]) => ents.reduce((a, _, i) => a + 0.5 * m[i] * (yy[2 * N + 2 * i] ** 2 + yy[2 * N + 2 * i + 1] ** 2), 0);
  const mom = (yy: number[]) => [ents.reduce((a, _, i) => a + m[i] * yy[2 * N + 2 * i], 0), ents.reduce((a, _, i) => a + m[i] * yy[2 * N + 2 * i + 1], 0)];
  f(0, y, true);
  const E0 = KE(y) + elastic;
  const p0 = mom(y);
  const cols = ['t', ...ents.flatMap((q) => [`${q.name} x`, `${q.name} y`, `${q.name} vx`, `${q.name} vy`]), 'px total', 'py total', 'KE', 'dissipated', 'contacts'];
  const rows: number[][] = [];
  const rec = (t: number) => { f(t, y, true); const pm = mom(y); rows.push([t, ...ents.flatMap((_, i) => [y[2 * i], y[2 * i + 1], y[2 * N + 2 * i], y[2 * N + 2 * i + 1]]), pm[0], pm[1], KE(y), y[4 * N], contacts]); };
  rec(0);
  const ev = every(steps);
  for (let k = 1; k <= steps; k++) {
    y = step((t, yy) => f(t, yy), (k - 1) * dt, y, dt, s.method, 2 * N);
    if (k % ev === 0 || k === steps) rec(k * dt);
  }
  f(0, y, true);
  const pE = mom(y);
  const pScale = Math.max(1e-12, ...ents.map((_, i) => m[i] * vmax));
  const checks: Check[] = [auditCheck(E0, KE(y) + elastic, y[4 * N], E0, s.method)];
  if (!walls) {
    checks.push({ l: 'momentum conserved x (no cushions)', exp: p0[0], act: pE[0], u: 'kg m/s', abs: 1e-9 * pScale });
    checks.push({ l: 'momentum conserved y', exp: p0[1], act: pE[1], u: 'kg m/s', abs: 1e-9 * pScale });
  }
  return {
    cols, rows, checks,
    scalars: [{ l: 'balls', v: N }, { l: 'scene timestep (auto)', v: dt, u: 's' }, { l: 'scene steps', v: steps }, { l: 'KE lost to impacts', v: y[4 * N], u: 'J' }],
    notes: [`table ${W.toFixed(2)} × ${H.toFixed(2)} m · timestep chosen from the smallest ball and fastest speed so each impact is resolved over ${N_CONTACT} steps`],
    charts: [
      { id: 'traj', title: 'ball paths', xl: 'x (m)', yl: 'y (m)', equal: true, series: ents.map((q, i) => ({ name: q.name, x: rows.map((rw) => rw[1 + 4 * i]), y: rows.map((rw) => rw[2 + 4 * i]) })) },
      { id: 'ke', title: 'kinetic energy & dissipation', xl: 't', yl: 'J', tAxis: true, series: ['KE', 'dissipated'].map((nm) => ({ name: nm, x: rows.map((rw) => rw[0]), y: rows.map((rw) => rw[cols.indexOf(nm)]) })) },
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(0, W, 0, H, 14);
      G.rect(0, 0, W, H, '#123322', true);
      if (walls) G.rect(0, 0, W, H, '#8b5a2b');
      ents.forEach((q, i) => {
        const tr: number[][] = [];
        for (let j = Math.max(0, k - 200); j <= k; j += 4) tr.push([rows[j][1 + 4 * i], rows[j][2 + 4 * i]]);
        G.path(tr.map((t) => t[0]), tr.map((t) => t[1]), COL.dim);
        G.circle(rw[1 + 4 * i], rw[2 + 4 * i], r[i], spriteColor(q.sprite), true);
      });
      G.hud([`t=${rw[0].toFixed(3)} s  ${N} balls  KE=${rw[cols.indexOf('KE')].toFixed(4)} J`, `momentum (${rw[cols.indexOf('px total')].toFixed(4)}, ${rw[cols.indexOf('py total')].toFixed(4)})`]);
    },
  };
}

// ---------------------------------------------------------------- N-body
export function nbodyScene(p: Params, _s: Settings, ents: Ent[]): Result {
  const N = ents.length;
  const scale = n(p.ws_scale, 20000) * 1e3, dt = n(p.ws_dt, 600), steps = Math.min(200000, Math.round(n(p.ws_steps, 4000)));
  const M = ents.map((q) => Math.max(1, n(q.v.M, 7.342e22))), R = ents.map((q) => Math.max(1, n(q.v.R, 1737) * 1e3));
  const pos = ents.map((q) => [(q.x - SCENE_W / 2) * scale, (SCENE_H / 2 - q.y) * scale]);
  const vel = ents.map(() => [0, 0]);
  // starting velocities: heaviest first, so circular orbits ride along with whatever they orbit
  const byMass = ents.map((_, i) => i).sort((a, b) => M[b] - M[a]);
  for (const i of byMass) {
    const q = ents[i], mode = String(q.v.orbit ?? 'circular');
    if (mode === 'as set') vel[i] = [n(q.v.vx) * 1e3, n(q.v.vy) * 1e3];
    else if (mode === 'circular') {
      const h = byMass.find((j) => j !== i && M[j] > M[i]);
      if (h === undefined) continue;
      const dx = pos[i][0] - pos[h][0], dy = pos[i][1] - pos[h][1], d = Math.hypot(dx, dy) || 1;
      const v = Math.sqrt((GCONST * (M[h] + M[i])) / d);
      vel[i] = [vel[h][0] - (v * dy) / d, vel[h][1] + (v * dx) / d];
    }
  }
  const eps2 = (i: number, j: number) => (0.05 * (R[i] + R[j])) ** 2;
  const f = (_t: number, y: number[]) => {
    const d = new Array(4 * N).fill(0);
    for (let i = 0; i < N; i++) {
      d[2 * i] = y[2 * N + 2 * i]; d[2 * i + 1] = y[2 * N + 2 * i + 1];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const dx = y[2 * j] - y[2 * i], dy = y[2 * j + 1] - y[2 * i + 1], r2 = dx * dx + dy * dy + eps2(i, j), k = (GCONST * M[j]) / (r2 * Math.sqrt(r2));
        d[2 * N + 2 * i] += k * dx; d[2 * N + 2 * i + 1] += k * dy;
      }
    }
    return d;
  };
  const inv = (y: number[]) => {
    let K = 0, U = 0, px = 0, py = 0, Lz = 0;
    for (let i = 0; i < N; i++) {
      const vx = y[2 * N + 2 * i], vy = y[2 * N + 2 * i + 1];
      K += 0.5 * M[i] * (vx * vx + vy * vy); px += M[i] * vx; py += M[i] * vy; Lz += M[i] * (y[2 * i] * vy - y[2 * i + 1] * vx);
      for (let j = i + 1; j < N; j++) U -= (GCONST * M[i] * M[j]) / Math.sqrt((y[2 * j] - y[2 * i]) ** 2 + (y[2 * j + 1] - y[2 * i + 1]) ** 2 + eps2(i, j));
    }
    return { K, U, E: K + U, px, py, Lz };
  };
  let y = [...pos.flat(), ...vel.flat()];
  const i0 = inv(y);
  const cols = ['t (days)', ...ents.flatMap((q) => [`${q.name} x (km)`, `${q.name} y (km)`, `${q.name} speed (km/s)`]), 'E total', 'Lz total'];
  const rows: number[][] = [];
  const rec = (t: number) => { const iv = inv(y); rows.push([t / 86400, ...ents.flatMap((_, i) => [y[2 * i] / 1e3, y[2 * i + 1] / 1e3, Math.hypot(y[2 * N + 2 * i], y[2 * N + 2 * i + 1]) / 1e3]), iv.E, iv.Lz]); };
  rec(0);
  const ev = every(steps);
  let collided = false;
  for (let k = 1; k <= steps; k++) {
    y = step(f, (k - 1) * dt, y, dt, 'rk4', 2 * N);
    if (!collided) for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (Math.hypot(y[2 * j] - y[2 * i], y[2 * j + 1] - y[2 * i + 1]) < R[i] + R[j]) collided = true;
    if (k % ev === 0 || k === steps) rec(k * dt);
  }
  const iE = inv(y);
  const pS = Math.max(1e-30, ...M.map((mm, i) => mm * Math.hypot(vel[i][0], vel[i][1])));
  const checks: Check[] = [
    { l: 'energy conserved (scene)', exp: i0.E, act: iE.E, u: 'J', abs: 1e-6 * Math.max(Math.abs(i0.K), Math.abs(i0.U)) },
    { l: 'momentum conserved x', exp: i0.px, act: iE.px, u: 'kg m/s', abs: 1e-9 * pS },
    { l: 'angular momentum conserved', exp: i0.Lz, act: iE.Lz, u: 'kg m²/s', abs: 1e-6 * Math.max(1e-30, Math.abs(i0.Lz), pS * scale) },
  ];
  let ext = 0;
  for (const rw of rows) for (let i = 0; i < N; i++) ext = Math.max(ext, Math.abs(rw[1 + 3 * i]), Math.abs(rw[2 + 3 * i]));
  ext = Math.max(ext * 1.1, 1);
  return {
    cols, rows, checks,
    scalars: [{ l: 'bodies', v: N }, { l: 'scene duration', v: (steps * dt) / 86400, u: 'days' }, ...ents.map((q, i) => ({ l: `${q.name} start speed`, v: Math.hypot(vel[i][0], vel[i][1]) / 1e3, u: 'km/s' }))],
    notes: [`N-body gravity with real G (RK4, dt ${dt} s)`, ...(collided ? ['two bodies overlapped (no merging: they pass through each other)'] : [])],
    charts: [{ id: 'orb', title: 'orbits', xl: 'x (km)', yl: 'y (km)', equal: true, series: ents.map((q, i) => ({ name: q.name, x: rows.map((rw) => rw[1 + 3 * i]), y: rows.map((rw) => rw[2 + 3 * i]) })) }],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(-ext, ext, -ext * 0.6, ext * 0.6);
      ents.forEach((q, i) => {
        const tr = rows.slice(Math.max(0, k - 400), k + 1);
        G.path(tr.map((t) => t[1 + 3 * i]), tr.map((t) => t[2 + 3 * i]), COL.dim);
        const X = G.X(rw[1 + 3 * i]), Y = G.Y(rw[2 + 3 * i]);
        const rad = Math.max(R[i] / 1e3 * G.sx, 0);
        if (rad > 6) G.circle(rw[1 + 3 * i], rw[2 + 3 * i], R[i] / 1e3, spriteColor(q.sprite), true);
        else drawSprite(G.ctx, SPRITES[q.sprite] ?? ['s'], X, Y + 4, 2);
        G.textPx(q.name, X + 6, Y - 6, COL.dim);
      });
      G.hud([`t=${rw[0].toFixed(2)} days  ${N} bodies`, `E=${rw[cols.indexOf('E total')].toExponential(6)} J`]);
    },
  };
}
