import type { SimModule, Check } from '../core/types';
import { integrate, GCONST, bisect, DEG, fbdAscii, minOf, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL, PALETTE } from '../core/gfx';

export const orbital: SimModule = {
  id: 'orbital',
  name: 'Orbital mechanics',
  desc: 'two-body Kepler orbits, figure-8 three-body, restricted 3-body Lagrange points',
  timeBased: true,
  settings: { dt: 10, steps: 2000, method: 'rk4' },
  modeSettings: { 'two-body': { dt: 10, steps: 2000 }, 'figure-8 3-body': { dt: 0.001, steps: 6326 }, 'lagrange (CR3BP)': { dt: 0.005, steps: 8000 } },
  params: [
    { k: 'mode', l: 'mode', v: 'two-body', o: ['two-body', 'figure-8 3-body', 'lagrange (CR3BP)'] },
    { k: 'M', l: 'central mass', u: 'kg', v: 5.972e24, min: 1, s: 1e23, when: (p) => p.mode === 'two-body' },
    { k: 'Rb', l: 'body radius', u: 'km', v: 6371, min: 0, s: 100, when: (p) => p.mode === 'two-body' },
    { k: 'r0', l: 'initial radius', u: 'km', v: 7000, min: 1e-3, s: 100, when: (p) => p.mode === 'two-body' },
    { k: 'v0', l: 'initial speed', u: 'm/s', v: 8500, min: 0, s: 100, when: (p) => p.mode === 'two-body' },
    { k: 'gam', l: 'flight path angle', u: 'deg', v: 0, s: 1, when: (p) => p.mode === 'two-body' },
    { k: 'pert', l: 'perturbation', v: 0, s: 0.001, when: (p) => p.mode === 'figure-8 3-body' },
    { k: 'mu', l: 'mass ratio μ', v: 0.01215, min: 1e-9, max: 0.5, s: 0.001, when: (p) => p.mode === 'lagrange (CR3BP)' },
    { k: 'Lp', l: 'start at', v: 'L4', o: ['L1', 'L2', 'L3', 'L4', 'L5'], when: (p) => p.mode === 'lagrange (CR3BP)' },
    { k: 'dx', l: 'offset (nondim)', v: 0.001, s: 0.001, when: (p) => p.mode === 'lagrange (CR3BP)' },
  ],
  run(p, s) {
    const mode = str(p, 'mode');
    if (mode === 'two-body') {
      const M = num(p, 'M'), mu = GCONST * M, R = num(p, 'Rb') * 1e3, r0 = num(p, 'r0') * 1e3, v0 = num(p, 'v0'), gm = num(p, 'gam') * DEG;
      const f = (_t: number, y: number[]) => {
        const r3 = Math.hypot(y[0], y[1]) ** 3;
        return [y[2], y[3], (-mu * y[0]) / r3, (-mu * y[1]) / r3];
      };
      const y0 = [r0, 0, v0 * Math.sin(gm), v0 * Math.cos(gm)];
      const tr = integrate(f, y0, s, { nq: 2, stop: (_t, y) => Math.hypot(y[0], y[1]) < R });
      const cols = ['t', 'x', 'y', 'vx', 'vy', 'r', 'speed', 'eps_kin', 'eps_pot', 'eps', 'h'];
      let wrap = 0, prevA = 0, tPeriod = NaN;
      const rows = tr.t.map((t, i) => {
        const [x, y, vx, vy] = tr.y[i];
        const r = Math.hypot(x, y), v = Math.hypot(vx, vy);
        const a = Math.atan2(y, x);
        if (i > 0 && prevA > 2 && a < -2) wrap++;
        if (i > 0 && wrap === 1 && Number.isNaN(tPeriod) && prevA < 0 && a >= 0) {
          const t0 = tr.t[i - 1];
          tPeriod = t0 + (t - t0) * (-prevA / (a - prevA));
        }
        prevA = a;
        return [t, x, y, vx, vy, r, v, 0.5 * v * v, -mu / r, 0.5 * v * v - mu / r, x * vy - y * vx];
      });
      const eps = rows[0][9], h = rows[0][10];
      const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (mu * mu)));
      const a = -mu / (2 * eps);
      const rp = (h * h) / mu / (1 + e), ra = e < 1 ? (h * h) / mu / (1 - e) : Infinity;
      const T = e < 1 ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : Infinity;
      const last = rows[rows.length - 1];
      const rs = rows.map((r) => r[5]);
      const checks: Check[] = [
        { l: 'specific energy conserved', exp: eps, act: last[9], u: 'J/kg', abs: 1e-9 * Math.abs(eps) + 1e-9 },
        { l: 'angular momentum conserved', exp: h, act: last[10], u: 'm2/s', abs: 1e-9 * Math.abs(h) },
      ];
      const tEnd = last[0];
      if (e < 1 && tEnd > T) {
        checks.push({ l: 'orbital period (Kepler III)', exp: T, act: tPeriod, u: 's' });
        checks.push({ l: 'periapsis radius', exp: rp / 1e3, act: minOf(rs) / 1e3, u: 'km', tol: 1e-4 });
        checks.push({ l: 'apoapsis radius', exp: ra / 1e3, act: maxOf(rs) / 1e3, u: 'km', tol: 1e-4 });
      }
      const notes = tr.stopped ? ['trajectory intersects the central body (impact)'] : [];
      if (e < 1 && tEnd < T) notes.push(`simulated ${tEnd.toFixed(0)} s < period ${T.toFixed(0)} s: increase steps for period checks`);
      return {
        cols, rows, checks, notes,
        scalars: [
          { l: 'circular velocity @r0', v: Math.sqrt(mu / r0), u: 'm/s' },
          { l: 'escape velocity @r0', v: Math.sqrt((2 * mu) / r0), u: 'm/s' },
          { l: 'eccentricity', v: e },
          { l: 'semi-major axis', v: a / 1e3, u: 'km' },
          { l: 'periapsis alt.', v: (rp - R) / 1e3, u: 'km' },
          { l: 'apoapsis alt.', v: (ra - R) / 1e3, u: 'km' },
          { l: 'period', v: T, u: 's' },
          { l: 'measured period', v: tPeriod, u: 's' },
          { l: 'orbit type (0 circ 1 ell 2 par 3 hyp)', v: e < 1e-9 ? 0 : e < 1 ? 1 : e === 1 ? 2 : 3 },
          { l: 'GM', v: mu, u: 'm3/s2' },
        ],
        charts: [
          chart(cols, rows, 'orb', 'orbit', 'x', ['y'], { equal: true, tAxis: false }),
          chart(cols, rows, 'r', 'radius', 't', ['r'], { yl: 'm' }),
          chart(cols, rows, 'en', 'specific energy', 't', ['eps_kin', 'eps_pot', 'eps'], { yl: 'J/kg' }),
        ],
        draw(G, i) {
          const ext = Math.max(maxOf(rs), R) * 1.1;
          G.view(-ext, ext, -ext, ext);
          G.circle(0, 0, R, COL.dim);
          G.path(rows.map((r) => r[1]), rows.map((r) => r[2]), COL.grid);
          G.path(rows.slice(0, i + 1).map((r) => r[1]), rows.slice(0, i + 1).map((r) => r[2]), COL.a);
          const r = rows[i];
          G.circle(r[1], r[2], 3, COL.fg, true, true);
          G.arrow(r[1], r[2], (r[3] / r[6]) * 25, (r[4] / r[6]) * 25, COL.a, 'v');
          G.arrow(r[1], r[2], (-r[1] / r[5]) * 18, (-r[2] / r[5]) * 18, COL.d, 'g');
          G.hud([`t=${r[0].toFixed(1)} s  alt=${((r[5] - R) / 1e3).toFixed(3)} km  v=${r[6].toFixed(3)} m/s`]);
        },
        fbd(i) {
          const r = rows[i];
          const g = mu / (r[5] * r[5]);
          return fbdAscii('FBD satellite (per kg)', [['gravity', (-g * r[1]) / r[5], (-g * r[2]) / r[5], 'N/kg']]);
        },
      };
    }
    if (mode === 'figure-8 3-body') {
      // Chenciner & Montgomery (2000), G = m = 1
      const pe = num(p, 'pert');
      const x1 = [0.97000436 + pe, -0.24308753], v3 = [-0.93240737, -0.86473146];
      const y0 = [x1[0], x1[1], -x1[0], -x1[1], 0, 0, -v3[0] / 2, -v3[1] / 2, -v3[0] / 2, -v3[1] / 2, v3[0], v3[1]];
      const f = (_t: number, y: number[]) => {
        const a = new Array(6).fill(0);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
          if (i === j) continue;
          const dx = y[2 * j] - y[2 * i], dy = y[2 * j + 1] - y[2 * i + 1];
          const r3 = Math.hypot(dx, dy) ** 3;
          a[2 * i] += dx / r3; a[2 * i + 1] += dy / r3;
        }
        return [...y.slice(6), ...a];
      };
      const fixDt = s.dt > 0.01;
      const tr = integrate(f, y0, fixDt ? { ...s, dt: 0.001, steps: 6326 } : s, { nq: 6 });
      const energy = (y: number[]) => {
        let K = 0, U = 0;
        for (let i = 0; i < 3; i++) K += 0.5 * (y[6 + 2 * i] ** 2 + y[7 + 2 * i] ** 2);
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) U -= 1 / Math.hypot(y[2 * i] - y[2 * j], y[2 * i + 1] - y[2 * j + 1]);
        return [K, U, K + U];
      };
      const cols = ['t', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'KE', 'PE', 'E', 'px', 'py'];
      const rows = tr.t.map((t, i) => {
        const y = tr.y[i];
        return [t, ...y.slice(0, 6), ...energy(y), y[6] + y[8] + y[10], y[7] + y[9] + y[11]];
      });
      const T8 = 6.32591398;
      const last = rows[rows.length - 1];
      const checks: Check[] = [
        { l: 'energy conserved', exp: rows[0][9], act: last[9], abs: 1e-8 },
        { l: 'momentum x conserved', exp: 0, act: last[10], abs: 1e-9 },
      ];
      const dtUsed = fixDt ? 0.001 : s.dt;
      if (pe === 0 && Math.abs(last[0] - T8) < dtUsed * 1.01) checks.push({ l: 'x1 after one period', exp: y0[0], act: last[1], tol: 1e-3, abs: 1e-4 });
      return {
        cols, rows, checks,
        notes: ['G = m = 1 units; period T = 6.32591398. Set steps*dt = T to close the orbit.', ...(fixDt ? ['dt > 0.01 is unstable here: used dt=0.001, steps=6326 (one period)'] : [])],
        scalars: [{ l: 'energy', v: rows[0][9] }, { l: 'period (lit.)', v: T8 }],
        charts: [
          { id: 'orb', title: 'trajectories', xl: 'x', yl: 'y', equal: true, series: [1, 3, 5].map((j, k) => ({ name: `body ${k + 1}`, x: rows.map((r) => r[j]), y: rows.map((r) => r[j + 1]) })) },
          chart(cols, rows, 'en', 'energy', 't', ['KE', 'PE', 'E']),
        ],
        draw(G, i) {
          G.view(-1.3, 1.3, -0.6, 0.6);
          [1, 3, 5].forEach((j, k) => {
            G.path(rows.slice(Math.max(0, i - 2000), i + 1).map((r) => r[j]), rows.slice(Math.max(0, i - 2000), i + 1).map((r) => r[j + 1]), COL.grid);
            G.circle(rows[i][j], rows[i][j + 1], 4, PALETTE[k], true, true);
          });
          G.hud([`t=${rows[i][0].toFixed(3)}`]);
        },
      };
    }
    // circular restricted three-body problem, rotating frame, nondimensional
    const mu = num(p, 'mu');
    const dU = (x: number) => x - ((1 - mu) * (x + mu)) / Math.abs(x + mu) ** 3 - (mu * (x - 1 + mu)) / Math.abs(x - 1 + mu) ** 3;
    const e = 1e-9;
    const L1 = bisect(dU, -mu + e, 1 - mu - e), L2 = bisect(dU, 1 - mu + e, 2), L3 = bisect(dU, -2, -mu - e);
    const pts: Record<string, [number, number]> = { L1: [L1, 0], L2: [L2, 0], L3: [L3, 0], L4: [0.5 - mu, Math.sqrt(3) / 2], L5: [0.5 - mu, -Math.sqrt(3) / 2] };
    const [lx, ly] = pts[str(p, 'Lp')];
    const f = (_t: number, y: number[]) => {
      const [x, yy, vx, vy] = y;
      const r1 = Math.hypot(x + mu, yy) ** 3, r2 = Math.hypot(x - 1 + mu, yy) ** 3;
      return [vx, vy, 2 * vy + x - ((1 - mu) * (x + mu)) / r1 - (mu * (x - 1 + mu)) / r2, -2 * vx + yy - ((1 - mu) * yy) / r1 - (mu * yy) / r2];
    };
    const ss = { ...s, dt: Math.min(s.dt, 0.01) };
    const tr = integrate(f, [lx + num(p, 'dx'), ly, 0, 0], ss, { nq: 2 });
    const jac = (y: number[]) => y[0] ** 2 + y[1] ** 2 + (2 * (1 - mu)) / Math.hypot(y[0] + mu, y[1]) + (2 * mu) / Math.hypot(y[0] - 1 + mu, y[1]) - (y[2] ** 2 + y[3] ** 2);
    const cols = ['t', 'x', 'y', 'vx', 'vy', 'dist from L', 'Jacobi C'];
    const rows = tr.t.map((t, i) => {
      const y = tr.y[i];
      return [t, y[0], y[1], y[2], y[3], Math.hypot(y[0] - lx, y[1] - ly), jac(y)];
    });
    const last = rows[rows.length - 1];
    const notes = s.dt > 0.01 ? ['dt clamped to 0.01 (nondimensional time; 2π = one primary orbit)'] : [];
    return {
      cols, rows, notes,
      checks: [
        { l: 'Jacobi constant conserved', exp: rows[0][6], act: last[6], abs: 1e-8 },
        { l: 'L1 residual dU/dx', exp: 0, act: dU(L1), abs: 1e-10 },
      ],
      scalars: [
        { l: 'L1 x', v: L1 }, { l: 'L2 x', v: L2 }, { l: 'L3 x', v: L3 }, { l: 'L4/L5 x', v: 0.5 - mu }, { l: 'L4/L5 |y|', v: Math.sqrt(3) / 2 },
        { l: 'Routh stability μ<0.03852', v: mu < 0.0385208965 ? 1 : 0, u: '1=L4/5 stable' },
        { l: 'max drift from L', v: maxOf(rows.map((r) => r[5])) },
      ],
      charts: [
        chart(cols, rows, 'orb', 'rotating-frame path', 'x', ['y'], { equal: true, tAxis: false }),
        chart(cols, rows, 'd', 'distance from Lagrange point', 't', ['dist from L']),
        chart(cols, rows, 'j', 'Jacobi constant', 't', ['Jacobi C']),
      ],
      draw(G, i) {
        G.view(-1.5, 1.5, -1.1, 1.1);
        G.circle(-mu, 0, 7, COL.b, true, true);
        G.circle(1 - mu, 0, 4, COL.a, true, true);
        Object.entries(pts).forEach(([k, [x, y]]) => { G.circle(x, y, 2, COL.dim, true, true); G.text(k, x + 0.03, y + 0.03, COL.dim); });
        G.path(rows.slice(0, i + 1).map((r) => r[1]), rows.slice(0, i + 1).map((r) => r[2]), COL.c);
        G.circle(rows[i][1], rows[i][2], 3, COL.fg, true, true);
        G.hud([`t=${rows[i][0].toFixed(3)} (rotating frame)`]);
      },
    };
  },
};
