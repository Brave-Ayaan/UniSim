import type { SimModule, Check } from '../core/types';
import { solve, maxOf, minOf } from '../core/num';
import { num, str } from '../core/build';
import { COL } from '../core/gfx';

/** 2D pin-jointed truss solved with the direct stiffness method; verified by statics. */
export const truss: SimModule = {
  id: 'truss',
  name: 'Bridge / truss',
  desc: 'Pratt / Warren / Howe truss, direct stiffness solve, member stress, Euler buckling',
  timeBased: false,
  stepsLabel: 'unused',
  settings: { dt: 1, steps: 1, method: 'rk4' },
  params: [
    { k: 'type', l: 'truss type', v: 'pratt', o: ['pratt', 'warren', 'howe'] },
    { k: 'n', l: 'panels (even)', v: 6, min: 2, max: 40, s: 2 },
    { k: 'span', l: 'span', u: 'm', v: 24, min: 0.1, s: 1 },
    { k: 'h', l: 'height', u: 'm', v: 4, min: 0.01, s: 0.5 },
    { k: 'load', l: 'load case', v: 'uniform', o: ['uniform', 'center'] },
    { k: 'P', l: 'load per node', u: 'kN', v: 100, s: 10 },
    { k: 'E', l: 'Young modulus', u: 'GPa', v: 200, min: 1e-6, s: 10 },
    { k: 'A', l: 'member area', u: 'cm2', v: 100, min: 1e-6, s: 5 },
    { k: 'fy', l: 'yield strength', u: 'MPa', v: 250, min: 1e-6, s: 10 },
  ],
  run(p) {
    const type = str(p, 'type');
    const n = Math.max(2, Math.round(num(p, 'n') / 2) * 2);
    const L = num(p, 'span'), h = num(p, 'h'), P = num(p, 'P') * 1e3, E = num(p, 'E') * 1e9, A = num(p, 'A') * 1e-4, fy = num(p, 'fy') * 1e6;
    const dx = L / n;
    const X: number[] = [], Y: number[] = [];
    const bot = (i: number) => i;
    for (let i = 0; i <= n; i++) { X.push(i * dx); Y.push(0); }
    const top: number[] = [];
    const mem: [number, number][] = [];
    for (let i = 0; i < n; i++) mem.push([bot(i), bot(i + 1)]);
    if (type === 'warren') {
      for (let i = 0; i < n; i++) { top.push(X.length); X.push((i + 0.5) * dx); Y.push(h); }
      for (let i = 0; i < n - 1; i++) mem.push([top[i], top[i + 1]]);
      for (let i = 0; i < n; i++) { mem.push([bot(i), top[i]]); mem.push([top[i], bot(i + 1)]); }
    } else {
      top[0] = -1;
      for (let i = 1; i < n; i++) { top[i] = X.length; X.push(i * dx); Y.push(h); }
      for (let i = 1; i < n - 1; i++) mem.push([top[i], top[i + 1]]);
      for (let i = 1; i < n; i++) mem.push([bot(i), top[i]]);
      mem.push([bot(0), top[1]]);
      mem.push([bot(n), top[n - 1]]);
      for (let i = 1; i < n - 1; i++) {
        const left = i + 1 <= n / 2;
        if (type === 'pratt') mem.push(left ? [top[i], bot(i + 1)] : [bot(i), top[i + 1]]);
        else mem.push(left ? [bot(i), top[i + 1]] : [top[i], bot(i + 1)]);
      }
    }
    const N = X.length;
    const F = new Array(2 * N).fill(0);
    const loads: [number, number][] = [];
    if (str(p, 'load') === 'center') loads.push([n / 2, P]);
    else for (let i = 1; i < n; i++) loads.push([i, P]);
    for (const [i, q] of loads) F[2 * bot(i) + 1] -= q;
    // stiffness assembly
    const K = Array.from({ length: 2 * N }, () => new Array(2 * N).fill(0));
    const geo = mem.map(([a, b]) => {
      const lx = X[b] - X[a], ly = Y[b] - Y[a], l = Math.hypot(lx, ly);
      return { c: lx / l, s: ly / l, l };
    });
    mem.forEach(([a, b], k) => {
      const { c, s, l } = geo[k];
      const kk = (E * A) / l;
      const m = [[c * c, c * s], [c * s, s * s]];
      const d = [2 * a, 2 * b];
      for (let I = 0; I < 2; I++) for (let J = 0; J < 2; J++) for (let r = 0; r < 2; r++) for (let q = 0; q < 2; q++)
        K[d[I] + r][d[J] + q] += (I === J ? 1 : -1) * kk * m[r][q];
    });
    const fixed = new Set([0, 1, 2 * bot(n) + 1]);
    const free = [...Array(2 * N).keys()].filter((i) => !fixed.has(i));
    const u = new Array(2 * N).fill(0);
    const sol = solve(free.map((i) => free.map((j) => K[i][j])), free.map((i) => F[i]));
    free.forEach((i, k) => (u[i] = sol[k]));
    const reac = [...fixed].map((i) => K[i].reduce((s2, kij, j) => s2 + kij * u[j], 0) - F[i]);
    const I2 = (A * A) / 12; // solid square section
    const cols = ['member', 'node i', 'node j', 'length', 'force N', 'stress', 'strain', 'T(+1)/C(-1)', 'utilization', 'Pcr Euler', 'buckling FS'];
    const rows = mem.map(([a, b], k) => {
      const { c, s, l } = geo[k];
      const Nf = ((E * A) / l) * ((u[2 * b] - u[2 * a]) * c + (u[2 * b + 1] - u[2 * a + 1]) * s);
      const sig = Nf / A;
      const Pcr = (Math.PI ** 2 * E * I2) / (l * l);
      return [k, a, b, l, Nf / 1e3, sig / 1e6, (sig / E) * 1e6, Math.abs(Nf) < 1e-6 ? 0 : Math.sign(Nf), Math.abs(sig) / fy, Pcr / 1e3, Nf < 0 ? Pcr / -Nf : Infinity];
    });
    // statics: reactions and method of sections for the bottom chord just left of midspan
    const RA = loads.reduce((s2, [i, q]) => s2 + (q * (L - X[i])) / L, 0);
    const RB = loads.reduce((s2, [, q]) => s2 + q, 0) - RA;
    const M = (x: number) => RA * x - loads.reduce((s2, [i, q]) => s2 + (X[i] < x ? q * (x - X[i]) : 0), 0);
    const k0 = n / 2 - 1;
    // moment centre = joint where the other two cut members meet
    const xs = type === 'warren' ? (k0 + 0.5) * dx : type === 'pratt' && k0 > 0 ? k0 * dx : (k0 + 1) * dx;
    const chordF = M(xs) / h;
    // equilibrium residual at free dofs
    let resid = 0;
    free.forEach((i) => (resid = Math.max(resid, Math.abs(K[i].reduce((s2, kij, j) => s2 + kij * u[j], 0) - F[i]))));
    const checks: Check[] = [
      { l: 'reaction A (statics)', exp: RA / 1e3, act: reac[1] / 1e3, u: 'kN' },
      { l: 'reaction B (statics)', exp: RB / 1e3, act: reac[2] / 1e3, u: 'kN' },
      { l: 'horizontal reaction', exp: 0, act: reac[0] / 1e3, u: 'kN', abs: 1e-6 },
      { l: 'mid bottom chord (sections)', exp: chordF / 1e3, act: rows[k0][4], u: 'kN' },
      { l: 'max nodal residual', exp: 0, act: resid, u: 'N', abs: 1e-3 },
    ];
    const midNode = bot(n / 2);
    const util = maxOf(rows.map((r) => r[8]));
    const crit = rows.reduce((a, r) => (r[8] > a[8] ? r : a), rows[0]);
    const minFS = minOf(rows.map((r) => r[10]));
    const ds = maxOf(u.map(Math.abs));
    const scale = ds > 0 ? (0.05 * L) / ds : 1;
    return {
      cols, rows, checks,
      notes: [`${N} nodes, ${mem.length} members (m = 2j-3 = ${2 * N - 3}: ${mem.length === 2 * N - 3 ? 'statically determinate' : 'indeterminate'})`, 'members: solid square section for buckling (I = A²/12), pinned ends K=1'],
      targets: [
        { l: 'yield (utilization < 1)', hit: util < 1, err: util, u: '' },
        { l: 'buckling (FS > 1)', hit: minFS > 1, err: minFS, u: '' },
      ],
      scalars: [
        { l: 'reaction A', v: reac[1] / 1e3, u: 'kN' },
        { l: 'reaction B', v: reac[2] / 1e3, u: 'kN' },
        { l: 'max tension', v: maxOf(rows.map((r) => r[4])), u: 'kN' },
        { l: 'max compression', v: minOf(rows.map((r) => r[4])), u: 'kN' },
        { l: 'max utilization σ/fy', v: util },
        { l: 'critical member', v: crit[0] },
        { l: 'min buckling FS', v: minFS },
        { l: 'midspan deflection', v: -u[2 * midNode + 1] * 1e3, u: 'mm' },
        { l: 'span/deflection', v: L / Math.max(1e-12, -u[2 * midNode + 1]) },
      ],
      charts: [
        { id: 'mf', title: 'member forces (+T / -C)', xl: 'member', yl: 'kN', bars: true, series: [{ name: 'N', x: rows.map((r) => r[0]), y: rows.map((r) => r[4]) }] },
        { id: 'defl', title: 'bottom chord deflection', xl: 'x (m)', yl: 'mm', series: [{ name: 'uy', x: X.slice(0, n + 1), y: [...Array(n + 1).keys()].map((i) => u[2 * i + 1] * 1e3) }] },
      ],
      draw(G, sel) {
        G.view(-0.05 * L, 1.05 * L, -0.35 * h - 0.05 * L, 1.3 * h);
        const mx = Math.max(maxOf(rows.map((r) => Math.abs(r[4]))), 1e-9);
        mem.forEach(([a, b]) => G.line(X[a], Y[a], X[b], Y[b], COL.grid));
        mem.forEach(([a, b], k) => {
          const f = rows[k][4];
          const col = f > 0 ? COL.b : f < 0 ? COL.a : COL.dim;
          G.line(X[a] + u[2 * a] * scale, Y[a] + u[2 * a + 1] * scale, X[b] + u[2 * b] * scale, Y[b] + u[2 * b + 1] * scale, k === sel ? '#ffffff' : col, k === sel ? 3 : 1 + 2 * (Math.abs(f) / mx));
        });
        for (const [i, q] of loads) G.arrow(X[i], Y[i] + u[2 * i + 1] * scale, 0, -Math.max(8, 25 * (q / P)), COL.d);
        const tri = (x: number) => G.fillPoly([x, x - 0.02 * L, x + 0.02 * L], [0, -0.05 * L, -0.05 * L], COL.dim);
        tri(0); tri(L);
        G.hud([`orange = tension, cyan = compression, deflection x${scale.toFixed(0)}`, `sel member ${sel}: N=${rows[sel]?.[4].toFixed(3)} kN σ=${rows[sel]?.[5].toFixed(3)} MPa`]);
      },
    };
  },
};
