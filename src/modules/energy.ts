import type { SimModule, Check } from '../core/types';
import { integrate, DEG, G0, fbdAscii } from '../core/num';
import { chart, num } from '../core/build';
import { COL, PALETTE } from '../core/gfx';

/** block on an incline -> spring bumper, with kinetic friction and an eddy-current generator */
export const energy: SimModule = {
  id: 'energy',
  name: 'Energy transfer',
  desc: 'kinetic ↔ gravitational ↔ elastic ↔ thermal ↔ electrical bookkeeping with conservation audit',
  timeBased: true,
  settings: { dt: 0.0005, steps: 20000, method: 'rk4' },
  params: [
    { k: 'm', l: 'block mass', u: 'kg', v: 2, min: 1e-9, s: 0.1 },
    { k: 'th', l: 'incline angle', u: 'deg', v: 30, min: 0, max: 89, s: 1 },
    { k: 'd', l: 'distance to spring', u: 'm', v: 5, min: 0, s: 0.5 },
    { k: 'mu', l: 'kinetic friction μk', v: 0.1, min: 0, s: 0.01 },
    { k: 'k', l: 'spring constant', u: 'N/m', v: 500, min: 1e-9, s: 50 },
    { k: 'cg', l: 'generator coeff (F=-c v)', u: 'N s/m', v: 0, min: 0, s: 0.1 },
    { k: 'g', l: 'gravity', u: 'm/s2', v: G0, s: 0.1 },
  ],
  run(p, s) {
    const m = num(p, 'm'), th = num(p, 'th') * DEG, d = num(p, 'd'), mu = num(p, 'mu'), k = num(p, 'k'), cg = num(p, 'cg'), g = num(p, 'g');
    const N = m * g * Math.cos(th), Fg = m * g * Math.sin(th);
    const Fnet = Fg - mu * N;
    const v1 = Fnet > 0 ? Math.sqrt((2 * d * Fnet) / m) : 0;
    const xmax = Fnet > 0 ? (Fnet + Math.sqrt(Fnet * Fnet + k * m * v1 * v1)) / k : 0;
    const Sref = d + Math.max(xmax, 0); // zero of gravitational PE at the analytic max-compression point
    let resting = false;
    // s measured down the slope from release, spring contact at s = d
    const forces = (sp: number, v: number) => {
      const spring = sp > d ? -k * (sp - d) : 0;
      const drive = Fg + spring - cg * v;
      let fr = 0;
      if (Math.abs(v) > 1e-9) fr = -mu * N * Math.sign(v);
      else fr = Math.abs(drive) <= mu * N ? -drive : -mu * N * Math.sign(drive);
      return { spring, fr, gen: -cg * v, total: Fg + spring - cg * v + fr };
    };
    // state [s, v, Q_thermal, E_electrical]
    const f = (_t: number, y: number[]) => {
      if (resting) return [0, 0, 0, 0];
      const F = forces(y[0], y[1]);
      return [y[1], F.total / m, Math.abs(F.fr * y[1]), cg * y[1] * y[1]];
    };
    const tr = integrate(f, [0, 0, 0, 0], s, {
      nq: 1,
      stop: (_t, y) => {
        // static friction latch: velocity reversal while net drive is within the friction cone
        const F = forces(y[0], 0);
        if (Math.abs(y[1]) < 1e-4 && Math.abs(Fg + F.spring) <= mu * N) { resting = true; y[1] = 0; }
        return false;
      },
    });
    const cols = ['t', 's', 'v', 'a', 'KE', 'PE_grav', 'PE_spring', 'thermal', 'electrical', 'E_total'];
    const rows = tr.t.map((t, i) => {
      const [sp, v, Q, El] = tr.y[i];
      const F = forces(sp, v);
      const KE = 0.5 * m * v * v, PEg = m * g * (Sref - sp) * Math.sin(th), PEs = sp > d ? 0.5 * k * (sp - d) ** 2 : 0;
      return [t, sp, v, F.total / m, KE, PEg, PEs, Q, El, KE + PEg + PEs + Q + El];
    });
    const E0 = rows[0][9], last = rows[rows.length - 1];
    const checks: Check[] = [{ l: 'total energy conserved', exp: E0, act: last[9], u: 'J', abs: 1e-6 * Math.max(1, E0) }];
    if (cg === 0 && Fnet > 0) {
      const iC = rows.findIndex((r) => r[1] >= d);
      if (iC > 0) {
        const a = rows[iC - 1], b = rows[iC], fr = (d - a[1]) / (b[1] - a[1]);
        checks.push({ l: 'speed at spring contact', exp: v1, act: a[2] + fr * (b[2] - a[2]), u: 'm/s', tol: 1e-4 });
        let mx = 0;
        for (const r of rows) { if (r[2] < 0) break; mx = Math.max(mx, r[1] - d); }
        checks.push({ l: 'max compression', exp: xmax, act: mx, u: 'm', tol: 1e-3 });
      }
    }
    const notes = Fnet <= 0 ? ['μk ≥ tanθ: block cannot start sliding (static friction latch)'] : [];
    return {
      cols, rows, checks, notes,
      scalars: [
        { l: 'initial energy', v: E0, u: 'J' }, { l: 'speed at spring (analytic)', v: v1, u: 'm/s' }, { l: 'max compression (analytic)', v: xmax, u: 'm' },
        { l: 'final thermal', v: last[7], u: 'J' }, { l: 'final electrical', v: last[8], u: 'J' }, { l: 'final KE', v: last[4], u: 'J' },
      ],
      charts: [
        chart(cols, rows, 'en', 'energy forms', 't', ['KE', 'PE_grav', 'PE_spring', 'thermal', 'electrical', 'E_total'], { yl: 'J' }),
        chart(cols, rows, 'x', 'position & velocity', 't', ['s', 'v']),
      ],
      draw(G, i) {
        const r = rows[i];
        const Ltot = d + Math.max(xmax, 0.5) + 0.5;
        const c = Math.cos(th), sn = Math.sin(th);
        G.insetR = 210; // energy bars live in this column, clear of the incline
        G.view(-0.5, Ltot * c + 0.5, -0.5 - Ltot * 0.1, Ltot * sn + 0.5);
        const P = (u: number, h = 0): [number, number] => [u * c - h * sn, (Ltot - u) * sn + h * c];
        G.line(...P(0), ...P(Ltot), COL.dim);
        const sb = P(Ltot);
        G.line(sb[0], sb[1], sb[0], sb[1] + 0.3, COL.fg, 2);
        const free = Ltot - d;
        const comp = Math.max(0, r[1] - d);
        const sp1 = P(d + comp, 0.1), sp2 = P(Ltot, 0.1);
        G.spring(sp1[0], sp1[1], sp2[0], sp2[1], COL.c, 8);
        void free;
        const q = [P(r[1] - 0.25, 0), P(r[1], 0), P(r[1], 0.25), P(r[1] - 0.25, 0.25)];
        G.fillPoly(q.map((z) => z[0]), q.map((z) => z[1]), COL.a);
        // energy bars
        const names = ['KE', 'PEg', 'PEs', 'heat', 'elec'];
        const vals = [r[4], r[5], r[6], r[7], r[8]];
        const W = 140;
        names.forEach((n, j) => {
          const w = (vals[j] / Math.max(E0, 1e-12)) * W;
          G.ctx.fillStyle = PALETTE[j];
          G.ctx.fillRect(G.W - W - 50, G.top + 10 + j * 16, Math.max(0, Math.min(W, w)), 9);
          G.textPx(n, G.W - 46, G.top + 18 + j * 16, PALETTE[j]);
        });
        G.hud([`t=${r[0].toFixed(3)} s  E=${r[9].toFixed(4)} J`]);
      },
      fbd(i) {
        const r = rows[i];
        const F = forces(r[1], r[2]);
        // axes: x along slope (down), y normal
        const ex = [Math.cos(-th), Math.sin(-th)], ey = [Math.sin(th), Math.cos(th)];
        const along = (f: number): [number, number] => [f * ex[0], f * ex[1]];
        return fbdAscii('FBD block (slope frame rotated)', [
          ['weight', 0, -m * g],
          ['normal', N * ey[0], N * ey[1]],
          ['friction', ...along(F.fr)],
          ['spring', ...along(F.spring)],
          ['generator', ...along(F.gen)],
        ]);
      },
    };
  },
};
