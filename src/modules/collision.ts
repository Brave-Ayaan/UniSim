import type { SimModule, Check } from '../core/types';
import { fbdAscii } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

export const collision: SimModule = {
  id: 'collision',
  name: 'Collisions (rigid bodies)',
  desc: '1D/2D two-ball impact with restitution; exact time-of-impact, momentum & energy audit',
  timeBased: true,
  settings: { dt: 0.002, steps: 2000, method: 'rk4' },
  params: [
    { k: 'dim', l: 'dimension', v: '2D', o: ['1D', '2D'] },
    { k: 'm1', l: 'mass 1', u: 'kg', v: 2, min: 1e-9, s: 0.1 },
    { k: 'm2', l: 'mass 2', u: 'kg', v: 1, min: 1e-9, s: 0.1 },
    { k: 'v1', l: 'velocity 1 (x)', u: 'm/s', v: 3, s: 0.5 },
    { k: 'v2', l: 'velocity 2 (x)', u: 'm/s', v: -1, s: 0.5 },
    { k: 'e', l: 'restitution e', v: 1, min: 0, max: 1, s: 0.05 },
    { k: 'r1', l: 'radius 1', u: 'm', v: 0.5, min: 1e-6, s: 0.05 },
    { k: 'r2', l: 'radius 2', u: 'm', v: 0.4, min: 1e-6, s: 0.05 },
    { k: 'b', l: 'impact offset b', u: 'm', v: 0.4, s: 0.05, when: (p) => p.dim === '2D' },
  ],
  run(p, s) {
    const m1 = num(p, 'm1'), m2 = num(p, 'm2'), e = num(p, 'e'), r1 = num(p, 'r1'), r2 = num(p, 'r2');
    const b = str(p, 'dim') === '2D' ? num(p, 'b') : 0;
    const D = r1 + r2;
    // state: x1,y1,x2,y2,vx1,vy1,vx2,vy2 ; ballistic motion is exact, impacts resolved at exact TOI
    let st = [-2, 0, 2, b, num(p, 'v1'), 0, num(p, 'v2'), 0];
    const u0 = [st[4], st[5], st[6], st[7]];
    let hits = 0, tHit = NaN;
    const impulse = (y: number[]) => {
      const nx0 = y[2] - y[0], ny0 = y[3] - y[1], L = Math.hypot(nx0, ny0);
      const nx = nx0 / L, ny = ny0 / L;
      const un = (y[6] - y[4]) * nx + (y[7] - y[5]) * ny;
      if (un >= 0) return;
      const J = (-(1 + e) * un) / (1 / m1 + 1 / m2);
      y[4] -= (J * nx) / m1; y[5] -= (J * ny) / m1;
      y[6] += (J * nx) / m2; y[7] += (J * ny) / m2;
      hits++;
    };
    const cols = ['t', 'x1', 'y1', 'x2', 'y2', 'vx1', 'vy1', 'vx2', 'vy2', 'px', 'py', 'KE'];
    const rowOf = (t: number, y: number[]) => [t, ...y, m1 * y[4] + m2 * y[6], m1 * y[5] + m2 * y[7], 0.5 * m1 * (y[4] ** 2 + y[5] ** 2) + 0.5 * m2 * (y[6] ** 2 + y[7] ** 2)];
    const rows = [rowOf(0, st)];
    for (let i = 1; i <= s.steps; i++) {
      let rem = s.dt;
      // relative motion p + u*tau ; solve |p + u tau| = D
      const px = st[2] - st[0], py = st[3] - st[1], ux = st[6] - st[4], uy = st[7] - st[5];
      const A = ux * ux + uy * uy, B = 2 * (px * ux + py * uy), Cc = px * px + py * py - D * D;
      const disc = B * B - 4 * A * Cc;
      if (A > 0 && disc >= 0 && B < 0) {
        const tau = (-B - Math.sqrt(disc)) / (2 * A);
        if (tau >= 0 && tau <= rem) {
          for (let k = 0; k < 4; k++) st[k] += st[4 + k] * tau;
          impulse(st);
          if (Number.isNaN(tHit)) tHit = (i - 1) * s.dt + tau;
          rem -= tau;
        }
      }
      for (let k = 0; k < 4; k++) st[k] += st[4 + k] * rem;
      rows.push(rowOf(i * s.dt, st));
    }
    // analytic: contact normal fixed by geometry (both move along x, lateral offset b)
    const checks: Check[] = [];
    const scalars = [] as { l: string; v: number; u?: string }[];
    if (Math.abs(b) < D && u0[2] - u0[0] < 0) {
      const nx = Math.sqrt(D * D - b * b) / D, ny = b / D;
      const un = (u0[2] - u0[0]) * nx;
      const J = (-(1 + e) * un) / (1 / m1 + 1 / m2);
      const ex = [u0[0] - (J * nx) / m1, u0[1] - (J * ny) / m1, u0[2] + (J * nx) / m2, u0[3] + (J * ny) / m2];
      const last = rows[rows.length - 1];
      ['vx1', 'vy1', 'vx2', 'vy2'].forEach((n, k) => checks.push({ l: `final ${n}`, exp: ex[k], act: last[5 + k], u: 'm/s', abs: 1e-9 }));
      const mu = (m1 * m2) / (m1 + m2);
      const dKE = 0.5 * mu * (1 - e * e) * un * un;
      checks.push({ l: 'KE lost ½μ(1-e²)u_n²', exp: dKE, act: rows[0][11] - last[11], u: 'J', abs: 1e-9 });
      checks.push({ l: 'momentum x conserved', exp: rows[0][9], act: last[9], u: 'kg m/s', abs: 1e-9 });
      checks.push({ l: 'momentum y conserved', exp: rows[0][10], act: last[10], u: 'kg m/s', abs: 1e-9 });
      if (b === 0) {
        const v1f = (m1 * u0[0] + m2 * u0[2] + m2 * e * (u0[2] - u0[0])) / (m1 + m2);
        scalars.push({ l: '1D textbook v1\'', v: v1f, u: 'm/s' });
      }
      scalars.push({ l: 'impulse J', v: J, u: 'N s' }, { l: 'contact angle', v: (Math.atan2(ny, nx) * 180) / Math.PI, u: 'deg' });
    }
    scalars.push({ l: 'impact time', v: tHit, u: 's' }, { l: 'impacts', v: hits }, { l: 'KE initial', v: rows[0][11], u: 'J' }, { l: 'KE final', v: rows[rows.length - 1][11], u: 'J' });
    return {
      cols, rows, checks, scalars,
      notes: ['free flight is integrated exactly; impacts resolved at the analytic time of impact (integrator choice has no effect)'],
      charts: [
        chart(cols, rows, 'v', 'velocities', 't', ['vx1', 'vy1', 'vx2', 'vy2'], { yl: 'm/s' }),
        chart(cols, rows, 'pk', 'momentum & KE', 't', ['px', 'py', 'KE']),
        { id: 'traj', title: 'trajectories', xl: 'x', yl: 'y', equal: true, series: [
          { name: 'ball 1', x: rows.map((r) => r[1]), y: rows.map((r) => r[2]) },
          { name: 'ball 2', x: rows.map((r) => r[3]), y: rows.map((r) => r[4]) },
        ] },
      ],
      draw(G, i) {
        const r = rows[i];
        G.view(-4, 4, -2.5, 2.5);
        G.path(rows.slice(0, i + 1).map((q) => q[1]), rows.slice(0, i + 1).map((q) => q[2]), COL.dim);
        G.path(rows.slice(0, i + 1).map((q) => q[3]), rows.slice(0, i + 1).map((q) => q[4]), COL.dim);
        G.circle(r[1], r[2], r1, COL.a);
        G.circle(r[3], r[4], r2, COL.b);
        G.arrow(r[1], r[2], r[5] * 15, r[6] * 15, COL.a, 'v1');
        G.arrow(r[3], r[4], r[7] * 15, r[8] * 15, COL.b, 'v2');
        G.hud([`t=${r[0].toFixed(3)}  p=(${r[9].toFixed(3)}, ${r[10].toFixed(3)})  KE=${r[11].toFixed(3)} J`]);
      },
      fbd(i) {
        const r = rows[i];
        return fbdAscii('momentum vectors', [['p1', m1 * r[5], m1 * r[6], 'kg m/s'], ['p2', m2 * r[7], m2 * r[8], 'kg m/s']]);
      },
    };
  },
};
