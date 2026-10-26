import type { SimModule, Check } from '../core/types';
import { integrate, DEG, G0, fbdAscii, bisect, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

export const projectile: SimModule = {
  id: 'projectile',
  name: 'Projectile motion',
  desc: 'launch with quadratic / linear (analytic) drag, wind, target hit prediction',
  timeBased: true,
  settings: { dt: 0.001, steps: 200000, method: 'rk4' },
  params: [
    { k: 'v0', l: 'launch speed', u: 'm/s', v: 50, min: 0, s: 1 },
    { k: 'ang', l: 'launch angle', u: 'deg', v: 45, s: 1 },
    { k: 'h0', l: 'launch height', u: 'm', v: 0, min: 0, s: 1 },
    { k: 'g', l: 'gravity', u: 'm/s2', v: G0, s: 0.1 },
    { k: 'm', l: 'mass', u: 'kg', v: 1, min: 1e-9, s: 0.1 },
    { k: 'drag', l: 'drag model', v: 'quadratic', o: ['quadratic', 'linear', 'none'] },
    { k: 'Cd', l: 'drag coeff Cd', v: 0.47, min: 0, s: 0.01, when: (p) => p.drag === 'quadratic' },
    { k: 'd', l: 'diameter', u: 'm', v: 0.1, min: 0, s: 0.01, when: (p) => p.drag === 'quadratic' },
    { k: 'rho', l: 'air density', u: 'kg/m3', v: 1.225, min: 0, s: 0.01, when: (p) => p.drag === 'quadratic' },
    { k: 'kl', l: 'linear drag b', u: 'kg/s', v: 0.05, min: 0, s: 0.01, when: (p) => p.drag === 'linear' },
    { k: 'wind', l: 'wind (+x)', u: 'm/s', v: 0, s: 1 },
    { k: 'tx', l: 'target x', u: 'm', v: 200, s: 5 },
    { k: 'ty', l: 'target y', u: 'm', v: 0, s: 1 },
    { k: 'tol', l: 'target tolerance', u: 'm', v: 1, min: 0, s: 0.5 },
  ],
  run(p, s) {
    const v0 = num(p, 'v0'), th = num(p, 'ang') * DEG, h0 = num(p, 'h0'), g = num(p, 'g'), m = num(p, 'm');
    const model = str(p, 'drag');
    const A = (Math.PI * num(p, 'd') ** 2) / 4;
    const kq = model === 'quadratic' ? 0.5 * num(p, 'rho') * num(p, 'Cd') * A : 0;
    const kl = model === 'linear' ? num(p, 'kl') : 0;
    const wind = num(p, 'wind');
    const force = (vx: number, vy: number): [number, number] => {
      const rx = vx - wind, ry = vy;
      const sp = Math.hypot(rx, ry);
      return [-(kq * sp + kl) * rx, -(kq * sp + kl) * ry];
    };
    // state [x, y, vx, vy, Wdrag]
    const f = (_t: number, y: number[]) => {
      const [Fx, Fy] = force(y[2], y[3]);
      return [y[2], y[3], Fx / m, Fy / m - g, -(Fx * y[2] + Fy * y[3])];
    };
    const vx0 = v0 * Math.cos(th), vy0 = v0 * Math.sin(th);
    const tr = integrate(f, [0, h0, vx0, vy0, 0], s, { nq: 2, stop: (t, y) => t > 0 && y[1] < 0 && g > 0 });
    // semi-implicit: q = [x,y]; the drag-work accumulator rides along with the velocity block
    const cols = ['t', 'x', 'y', 'vx', 'vy', 'ax', 'ay', 'speed', 'KE', 'PE', 'W_drag', 'E_total'];
    const rows = tr.t.map((t, i) => {
      const [x, y, vx, vy, W] = tr.y[i];
      const [Fx, Fy] = force(vx, vy);
      const KE = 0.5 * m * (vx * vx + vy * vy), PE = m * g * y;
      return [t, x, y, vx, vy, Fx / m, Fy / m - g, Math.hypot(vx, vy), KE, PE, W, KE + PE + W];
    });
    // interpolate the ground crossing
    let land = rows[rows.length - 1].slice();
    if (tr.stopped && rows.length > 1) {
      const a = rows[rows.length - 2], b = rows[rows.length - 1];
      const fr = a[2] / (a[2] - b[2]);
      land = a.map((v, j) => v + fr * (b[j] - v));
      land[2] = 0;
      rows[rows.length - 1] = land;
    }
    const R = land[1], T = land[0];
    const apex = maxOf(rows.map((r) => r[2]));
    const checks: Check[] = [];
    const notes: string[] = [];
    if (!tr.stopped) notes.push('projectile did not land within steps*dt; increase steps');
    const vacR = (vx0 * (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h0))) / g;
    const vacT = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h0)) / g;
    const vacH = h0 + (vy0 > 0 ? (vy0 * vy0) / (2 * g) : 0);
    if (model === 'none' && wind === 0) {
      checks.push({ l: 'range (vacuum analytic)', exp: vacR, act: R, u: 'm' });
      checks.push({ l: 'flight time', exp: vacT, act: T, u: 's' });
      checks.push({ l: 'apex height', exp: vacH, act: apex, u: 'm', tol: 1e-4 });
    } else if (model === 'linear' && wind === 0 && kl > 0) {
      // exact solution with linear drag F = -b v
      const tau = m / kl, vt = g * tau;
      const xA = (t: number) => vx0 * tau * (1 - Math.exp(-t / tau));
      const yA = (t: number) => h0 + tau * (vy0 + vt) * (1 - Math.exp(-t / tau)) - vt * t;
      const tl = bisect(yA, 1e-9, 10 * (vacT + tau + 1));
      const ta = tau * Math.log(1 + vy0 / vt);
      checks.push({ l: 'flight time (linear drag exact)', exp: tl, act: T, u: 's' });
      checks.push({ l: 'range (linear drag exact)', exp: xA(tl), act: R, u: 'm' });
      checks.push({ l: 'apex height (exact)', exp: vy0 > 0 ? yA(ta) : h0, act: apex, u: 'm', tol: 1e-4 });
    } else {
      checks.push({ l: 'range vs vacuum', exp: vacR, act: R, u: 'm', ref: true });
      checks.push({ l: 'apex vs vacuum', exp: vacH, act: apex, u: 'm', ref: true });
    }
    checks.push({ l: 'energy: KE+PE+W_drag', exp: rows[0][11], act: land[11], u: 'J', abs: 1e-6 * Math.max(1, rows[0][11]) });
    // target: closest approach of the trajectory to the target point
    const tx = num(p, 'tx'), ty = num(p, 'ty'), tol = num(p, 'tol');
    let best = Infinity, bi = 0;
    for (let i = 1; i < rows.length; i++) {
      const [ax, ay] = [rows[i - 1][1], rows[i - 1][2]], [bx, by] = [rows[i][1], rows[i][2]];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      const u = L2 > 0 ? Math.max(0, Math.min(1, ((tx - ax) * dx + (ty - ay) * dy) / L2)) : 0;
      const dd = Math.hypot(ax + u * dx - tx, ay + u * dy - ty);
      if (dd < best) [best, bi] = [dd, i];
    }
    // vacuum firing solutions to hit (tx, ty - h0)
    const X = tx, Y = ty - h0, disc = v0 ** 4 - g * (g * X * X + 2 * Y * v0 * v0);
    const lo = disc >= 0 ? Math.atan2(v0 * v0 - Math.sqrt(disc), g * X) / DEG : NaN;
    const hi = disc >= 0 ? Math.atan2(v0 * v0 + Math.sqrt(disc), g * X) / DEG : NaN;
    const cv = (fl: number[]) => [fl[1], fl[2]];
    return {
      cols, rows, checks, notes,
      targets: [{ l: `target (${tx}, ${ty})`, hit: best <= tol, err: best, u: 'm' }],
      charts: [
        chart(cols, rows, 'traj', 'trajectory', 'x', ['y'], { equal: true, tAxis: false }),
        chart(cols, rows, 'vel', 'velocity', 't', ['vx', 'vy', 'speed'], { yl: 'm/s' }),
        chart(cols, rows, 'en', 'energy', 't', ['KE', 'PE', 'W_drag', 'E_total'], { yl: 'J' }),
      ],
      scalars: [
        { l: 'range', v: R, u: 'm' },
        { l: 'flight time', v: T, u: 's' },
        { l: 'max height', v: apex, u: 'm' },
        { l: 'impact speed', v: land[7], u: 'm/s' },
        { l: 'impact angle', v: (Math.atan2(-land[4], land[3]) / DEG), u: 'deg' },
        { l: 'vacuum range', v: vacR, u: 'm' },
        { l: 'drag loss of range', v: vacR - R, u: 'm' },
        { l: 'target miss distance', v: best, u: 'm' },
        { l: 'vacuum angle to hit (low)', v: lo, u: 'deg' },
        { l: 'vacuum angle to hit (high)', v: hi, u: 'deg' },
        { l: 'terminal velocity', v: kq > 0 ? Math.sqrt((m * g) / kq) : kl > 0 ? (m * g) / kl : Infinity, u: 'm/s' },
      ],
      draw(G, i) {
        const xmax = Math.max(R, tx, 1) * 1.05, ymax = Math.max(apex, ty, h0, 1) * 1.15;
        G.view(-0.03 * xmax, xmax, -0.05 * ymax, ymax, 22, false);
        G.ground(-0.03 * xmax, xmax, 0);
        G.path(rows.map((r) => r[1]), rows.map((r) => r[2]), COL.dim);
        G.path(rows.slice(0, i + 1).map((r) => r[1]), rows.slice(0, i + 1).map((r) => r[2]), COL.a);
        G.circle(tx, ty, Math.max(4, tol * G.sx), best <= tol ? COL.c : COL.d, false, true);
        G.line(tx - 0, ty, tx, ty, COL.d);
        const r = rows[i];
        G.circle(r[1], r[2], 3, COL.fg, true, true);
        G.arrow(r[1], r[2], r[3] * 0.6, r[4] * 0.6, COL.a, 'v');
        const [Fx, Fy] = force(r[3], r[4]);
        G.arrow(r[1], r[2], (Fx / (m * g)) * 20, (Fy / (m * g)) * 20, COL.b, 'D');
        G.arrow(r[1], r[2], 0, -20, COL.d, 'mg');
        const [lx, ly] = cv(rows[bi]);
        G.line(lx, ly, tx, ty, COL.f, 1, [2, 3]);
        G.hud([`t=${r[0].toFixed(3)}s x=${r[1].toFixed(3)} y=${r[2].toFixed(3)}`, best <= tol ? 'TARGET: HIT' : `TARGET: MISS by ${best.toFixed(3)} m`]);
      },
      fbd(i) {
        const r = rows[i];
        const [Fx, Fy] = force(r[3], r[4]);
        return fbdAscii('FBD projectile', [['weight', 0, -m * g], ['drag', Fx, Fy]]);
      },
    };
  },
};
