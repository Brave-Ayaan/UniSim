import type { SimModule, Check } from '../core/types';
import { step, rng, G0, maxOf } from '../core/num';
import { num, str } from '../core/build';
import { COL, heat } from '../core/gfx';

/** soft-sphere DEM (linear spring-dashpot normal, capped viscous Coulomb tangential) in a 2D box */
export const granular: SimModule = {
  id: 'granular',
  name: 'Granular / particles',
  desc: 'discrete-element sand pile (friction, restitution) and hard-disk gas (Maxwell-Boltzmann check)',
  timeBased: true,
  settings: { dt: 5e-5, steps: 20000, method: 'semi' },
  modeSettings: { 'sand pile': { dt: 5e-5, steps: 20000, method: 'semi' }, 'particle gas': { dt: 5e-5, steps: 20000, method: 'rk4' } },
  params: [
    { k: 'mode', l: 'mode', v: 'sand pile', o: ['sand pile', 'particle gas'] },
    { k: 'N', l: 'particles', v: 150, min: 2, max: 600, s: 10 },
    { k: 'r', l: 'radius', u: 'm', v: 0.01, min: 1e-6, s: 0.001 },
    { k: 'rho', l: 'density', u: 'kg/m3', v: 2500, min: 1e-6, s: 100 },
    { k: 'kn', l: 'contact stiffness', u: 'N/m', v: 2e4, min: 1e-6, s: 1000 },
    { k: 'e', l: 'restitution', v: 0.5, min: 0, max: 1, s: 0.05, when: (p) => p.mode === 'sand pile' },
    { k: 'mu', l: 'friction', v: 0.5, min: 0, s: 0.05, when: (p) => p.mode === 'sand pile' },
    { k: 'g', l: 'gravity', u: 'm/s2', v: G0, s: 0.1, when: (p) => p.mode === 'sand pile' },
    { k: 'v0', l: 'initial speed', u: 'm/s', v: 1, min: 0, s: 0.1, when: (p) => p.mode === 'particle gas' },
    { k: 'W', l: 'box width', u: 'm', v: 0.6, min: 1e-6, s: 0.05 },
    { k: 'H', l: 'box height', u: 'm', v: 0.6, min: 1e-6, s: 0.05 },
  ],
  run(p, s) {
    const gas = str(p, 'mode') === 'particle gas';
    const N = Math.max(2, Math.round(num(p, 'N'))), r = num(p, 'r'), kn = num(p, 'kn'), W = num(p, 'W'), H = num(p, 'H');
    const e = gas ? 1 : num(p, 'e'), mu = gas ? 0 : num(p, 'mu'), g = gas ? 0 : num(p, 'g');
    const m = num(p, 'rho') * (4 / 3) * Math.PI * r ** 3;
    const zeta = e >= 1 ? 0 : e <= 0 ? 1 : -Math.log(e) / Math.sqrt(Math.PI ** 2 + Math.log(e) ** 2);
    const gPair = 2 * zeta * Math.sqrt((m / 2) * kn), gWall = 2 * zeta * Math.sqrt(m * kn);
    const tc = Math.PI / Math.sqrt((2 * kn) / m);
    const rand = rng(7);
    const x0: number[] = [], v0: number[] = [];
    if (gas) {
      const cols = Math.ceil(Math.sqrt((N * W) / H));
      const dx = W / cols, rowsN = Math.ceil(N / cols), dy = H / rowsN;
      for (let i = 0; i < N; i++) {
        x0.push(dx * ((i % cols) + 0.5), dy * (Math.floor(i / cols) + 0.5));
        const a = rand() * 2 * Math.PI;
        v0.push(num(p, 'v0') * Math.cos(a), num(p, 'v0') * Math.sin(a));
      }
    } else {
      const cols = Math.max(1, Math.floor((0.35 * W) / (2.2 * r)));
      for (let i = 0; i < N; i++) {
        const cx = W / 2 + (((i % cols) - (cols - 1) / 2) * 2.2 + (rand() - 0.5) * 0.2) * r;
        x0.push(cx, 0.1 * H + r + Math.floor(i / cols) * 2.2 * r);
        v0.push(0, 0);
      }
    }
    // spatial hash grid
    const cell = 2 * r;
    const nx = Math.max(1, Math.ceil(W / cell)), ny = Math.max(1, Math.ceil((H * 3) / cell));
    const head = new Int32Array(nx * ny), next = new Int32Array(N);
    let contacts = 0, maxOv = 0, elastic = 0;
    // force accumulator reused across evaluations (RK4 calls f 4x per step); only the returned
    // derivative array must be fresh because the integrator keeps k1..k4 alive simultaneously
    const F = new Float64Array(2 * N);
    const r2x4 = 4 * r * r;
    // contact law hoisted out of f (no closure allocation per evaluation); Y = state being evaluated
    let Y: number[] = [];
    const pair = (i: number, j: number, wall: boolean, nxv: number, nyv: number, d: number, vjx: number, vjy: number) => {
      const ov = (wall ? r : 2 * r) - d;
      if (ov <= 0) return;
      contacts++;
      maxOv = Math.max(maxOv, ov / r);
      elastic += 0.5 * kn * ov * ov;
      const vix = Y[2 * N + 2 * i], viy = Y[2 * N + 2 * i + 1];
      const rvx = vix - vjx, rvy = viy - vjy;
      const vn = rvx * nxv + rvy * nyv; // > 0 approaching (n points from i to j)
      const Fn = Math.max(0, kn * ov + (wall ? gWall : gPair) * vn);
      let fx = -Fn * nxv, fy = -Fn * nyv;
      if (mu > 0) {
        const tx = rvx - vn * nxv, ty = rvy - vn * nyv, vt = Math.sqrt(tx * tx + ty * ty);
        if (vt > 1e-12) {
          const Ft = Math.min(mu * Fn, (wall ? gWall : gPair) * vt + kn * 1e-4 * vt);
          fx -= (Ft * tx) / vt; fy -= (Ft * ty) / vt;
        }
      }
      F[2 * i] += fx; F[2 * i + 1] += fy;
      if (!wall) { F[2 * j] -= fx; F[2 * j + 1] -= fy; }
    };
    const f = (_t: number, y: number[]) => {
      const a = new Array(4 * N);
      for (let i = 0; i < 2 * N; i++) a[i] = y[2 * N + i];
      F.fill(0);
      head.fill(-1);
      for (let i = 0; i < N; i++) {
        const cx = Math.min(nx - 1, Math.max(0, Math.floor(y[2 * i] / cell))), cy = Math.min(ny - 1, Math.max(0, Math.floor(y[2 * i + 1] / cell)));
        const c = cy * nx + cx;
        next[i] = head[c]; head[c] = i;
      }
      contacts = 0; maxOv = 0; elastic = 0;
      Y = y;
      for (let i = 0; i < N; i++) {
        const xi = y[2 * i], yi = y[2 * i + 1];
        const cx = Math.floor(xi / cell), cy = Math.floor(yi / cell);
        for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++) {
          const qx = cx + ddx, qy = cy + ddy;
          if (qx < 0 || qy < 0 || qx >= nx || qy >= ny) continue;
          for (let j = head[qy * nx + qx]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            const dx = y[2 * j] - xi, dy = y[2 * j + 1] - yi, d2 = dx * dx + dy * dy;
            if (d2 >= r2x4 || d2 === 0) continue;
            const d = Math.sqrt(d2);
            pair(i, j, false, dx / d, dy / d, d, y[2 * N + 2 * j], y[2 * N + 2 * j + 1]);
          }
        }
        if (xi < r) pair(i, -1, true, -1, 0, xi, 0, 0);
        if (xi > W - r) pair(i, -1, true, 1, 0, W - xi, 0, 0);
        if (yi < r) pair(i, -1, true, 0, -1, yi, 0, 0);
        if (gas && yi > H - r) pair(i, -1, true, 0, 1, H - yi, 0, 0);
      }
      for (let i = 0; i < N; i++) { a[2 * N + 2 * i] = F[2 * i] / m; a[2 * N + 2 * i + 1] = F[2 * i + 1] / m - g; }
      return a;
    };
    let y = [...x0, ...v0];
    const every = Math.max(1, Math.ceil(s.steps / 600));
    const frames: Float32Array[] = [], speeds: Float32Array[] = [];
    const cols = ['t', 'KE', 'PE_grav', 'E_elastic', 'E_total', 'contacts', 'max overlap/r', 'px', 'py'];
    const rows: number[][] = [];
    const record = (t: number) => {
      f(t, y);
      let KE = 0, PE = 0, px = 0, py = 0;
      const sp = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const vx = y[2 * N + 2 * i], vy = y[2 * N + 2 * i + 1];
        KE += 0.5 * m * (vx * vx + vy * vy); PE += m * g * y[2 * i + 1]; px += m * vx; py += m * vy;
        sp[i] = Math.hypot(vx, vy);
      }
      rows.push([t, KE, PE, elastic, KE + PE + elastic, contacts, maxOv, px, py]);
      frames.push(Float32Array.from(y.slice(0, 2 * N)));
      speeds.push(sp);
    };
    record(0);
    for (let i = 1; i <= s.steps; i++) {
      y = step(f, (i - 1) * s.dt, y, s.dt, s.method, 2 * N);
      if (i % every === 0 || i === s.steps) record(i * s.dt);
      if (!y.every(Number.isFinite)) break;
    }
    const last = rows[rows.length - 1];
    const checks: Check[] = [];
    const notes = [...(gas && s.method !== 'rk4' ? ['energy check: semi-implicit Euler drifts ~0.1% through elastic contacts in this chaotic gas; RK4 (default) stays ≤0.02%'] : []), `contact time t_c = ${tc.toExponential(3)} s, dt/t_c = ${(s.dt / tc).toFixed(3)}${s.dt > tc / 20 ? '  (> 1/20: contacts under-resolved)' : ''}`, `recorded every ${every} steps`];
    const scalars = [{ l: 'particle mass', v: m, u: 'kg' }, { l: 'contact time', v: tc, u: 's' }, { l: 'final contacts', v: last[5] }, { l: 'peak overlap / r', v: maxOf(rows.map((q) => q[6])) }];
    let hist: { x: number[]; y: number[]; mb: number[] } | null = null;
    if (gas) {
      checks.push({ l: 'energy conserved (elastic)', exp: rows[0][4], act: last[4], u: 'J', tol: 1e-3 });
      const tail = speeds.slice(Math.floor(speeds.length * 0.6));
      const all: number[] = [];
      tail.forEach((sp) => sp.forEach((v) => all.push(v)));
      const kT = all.reduce((a, v) => a + 0.5 * m * v * v, 0) / all.length;
      const mean = all.reduce((a, v) => a + v, 0) / all.length;
      checks.push({ l: '2D Maxwell-Boltzmann mean speed √(πkT/2m)', exp: Math.sqrt((Math.PI * kT) / (2 * m)), act: mean, u: 'm/s', tol: 0.03 });
      const vmax = maxOf(all) * 1.05, nb = 30;
      const hx = [...Array(nb).keys()].map((k) => ((k + 0.5) * vmax) / nb), hy = new Array(nb).fill(0);
      all.forEach((v) => (hy[Math.min(nb - 1, Math.floor((v / vmax) * nb))] += 1));
      hist = { x: hx, y: hy.map((c) => c / (all.length * (vmax / nb))), mb: hx.map((v) => ((m * v) / kT) * Math.exp((-m * v * v) / (2 * kT))) };
      scalars.push({ l: 'kT (equipartition, 2D)', v: kT, u: 'J' }, { l: 'mean speed', v: mean, u: 'm/s' });
    } else {
      checks.push({ l: 'energy dissipated (ref)', exp: rows[0][4], act: last[4], u: 'J', ref: true });
      // angle of repose from the settled free surface
      const P = frames[frames.length - 1];
      const bw = 4 * r, nb = Math.ceil(W / bw), top = new Array(nb).fill(-1);
      for (let i = 0; i < N; i++) { const b = Math.min(nb - 1, Math.floor(P[2 * i] / bw)); top[b] = Math.max(top[b], P[2 * i + 1] + r); }
      const occ = top.map((h, i) => [i, h]).filter((q) => q[1] > 0);
      if (occ.length > 2) {
        const pk = occ.reduce((a, q) => (q[1] > a[1] ? q : a));
        const L = occ[0], R = occ[occ.length - 1];
        const aL = Math.atan2(pk[1] - L[1], (pk[0] - L[0]) * bw), aR = Math.atan2(pk[1] - R[1], (R[0] - pk[0]) * bw);
        scalars.push({ l: 'angle of repose (mean flank)', v: ((aL + aR) / 2) * (180 / Math.PI), u: 'deg' }, { l: 'pile height', v: pk[1], u: 'm' });
      }
      scalars.push({ l: 'final KE (settled → 0)', v: last[1], u: 'J' });
    }
    const T = rows.map((q) => q[0]);
    return {
      cols, rows, checks, notes, scalars,
      charts: [
        { id: 'e', title: 'energy', xl: 't', yl: 'J', tAxis: true, series: [1, 2, 3, 4].map((j) => ({ name: cols[j], x: T, y: rows.map((q) => q[j]) })) },
        { id: 'c', title: 'contacts', xl: 't', yl: '', tAxis: true, series: [{ name: 'contacts', x: T, y: rows.map((q) => q[5]) }] },
        ...(hist ? [{ id: 'mb', title: 'speed distribution vs Maxwell-Boltzmann', xl: 'speed (m/s)', yl: 'pdf', series: [{ name: 'simulated', x: hist.x, y: hist.y }, { name: 'MB 2D', x: hist.x, y: hist.mb, dash: true }] }] : []),
      ],
      draw(G, i) {
        const P = frames[i], sp = speeds[i];
        G.view(0, W, 0, H);
        G.rect(0, 0, W, H, COL.dim);
        const vm = Math.max(1e-9, maxOf(speeds[0]), maxOf(sp));
        for (let k = 0; k < N; k++) G.circle(P[2 * k], P[2 * k + 1], r, heat(sp[k] / vm), true);
        G.hud([`t=${rows[i][0].toFixed(4)} s  contacts=${rows[i][5]}  KE=${rows[i][1].toExponential(3)} J`]);
      },
    };
  },
};
