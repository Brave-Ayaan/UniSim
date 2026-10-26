import type { SimModule, Check } from '../core/types';
import { integrate, RGAS, crossings, argmax, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL, PALETTE } from '../core/gfx';

export const kinetics: SimModule = {
  id: 'kinetics',
  name: 'Chemical kinetics',
  desc: 'nth-order rate laws, reversible equilibrium, consecutive A→B→C; Arrhenius temperature dependence',
  timeBased: true,
  settings: { dt: 5, steps: 1000, method: 'rk4' },
  params: [
    { k: 'mode', l: 'mechanism', v: 'nth order A→P', o: ['nth order A→P', 'reversible A⇌B', 'consecutive A→B→C'] },
    { k: 'order', l: 'reaction order', v: '1', o: ['0', '1', '2'], when: (p) => p.mode === 'nth order A→P' },
    { k: 'A0', l: '[A]0', u: 'mol/L', v: 1, min: 0, s: 0.1 },
    { k: 'Af', l: 'pre-exponential A1', u: '(units of k)', v: 1e10, min: 0, s: 1e9 },
    { k: 'Ea', l: 'activation energy Ea1', u: 'kJ/mol', v: 75, min: 0, s: 5 },
    { k: 'Ar', l: 'pre-exponential A2', u: '(units of k)', v: 1e10, min: 0, s: 1e9, when: (p) => p.mode !== 'nth order A→P' },
    { k: 'Ear', l: 'activation energy Ea2', u: 'kJ/mol', v: 78, min: 0, s: 5, when: (p) => p.mode !== 'nth order A→P' },
    { k: 'T', l: 'temperature', u: 'K', v: 298.15, min: 1e-6, s: 5 },
  ],
  run(p, s) {
    const mode = str(p, 'mode'), A0 = num(p, 'A0'), T = num(p, 'T');
    const arr = (A: number, Ea: number, TT = T) => A * Math.exp((-Ea * 1e3) / (RGAS * TT));
    const k1 = arr(num(p, 'Af'), num(p, 'Ea'));
    const k2 = mode !== 'nth order A→P' ? arr(num(p, 'Ar'), num(p, 'Ear')) : 0;
    const Ts = [...Array(60).keys()].map((i) => T - 40 + (80 * i) / 59);
    const arrChart = { id: 'arr', title: 'Arrhenius plot', xl: '1000/T (1/K)', yl: 'ln k', series: [{ name: 'ln k1', x: Ts.map((t) => 1000 / t), y: Ts.map((t) => Math.log(arr(num(p, 'Af'), num(p, 'Ea'), t))) }] };
    const checks: Check[] = [];
    const notes: string[] = [];
    if (mode === 'nth order A→P') {
      const n = Number(str(p, 'order'));
      const tr = integrate((_t, y) => [y[0] > 0 ? -k1 * y[0] ** n : 0], [A0], s);
      const exact = (t: number) => (n === 0 ? Math.max(0, A0 - k1 * t) : n === 1 ? A0 * Math.exp(-k1 * t) : A0 / (1 + A0 * k1 * t));
      const half = n === 0 ? A0 / (2 * k1) : n === 1 ? Math.LN2 / k1 : 1 / (k1 * A0);
      const cols = ['t', '[A]', '[P]', 'rate', '[A] exact', 'err', 'ln[A]', '1/[A]'];
      const rows = tr.t.map((t, i) => {
        const a = Math.max(0, tr.y[i][0]);
        return [t, a, A0 - a, a > 0 ? k1 * a ** n : 0, exact(t), a - exact(t), Math.log(a), 1 / a];
      });
      const th = crossings(rows.map((r) => r[0]), rows.map((r) => r[1]), A0 / 2, -1)[0];
      checks.push({ l: 'half-life', exp: half, act: th ?? NaN, u: 's' });
      checks.push({ l: 'max |[A] - exact|', exp: 0, act: maxOf(rows.map((r) => Math.abs(r[5]))), u: 'mol/L', abs: 1e-6 * A0 });
      if (th === undefined) notes.push('half-life beyond simulated time: increase steps or dt');
      return {
        cols, rows, checks, notes,
        scalars: [{ l: 'k (Arrhenius)', v: k1, u: n === 0 ? 'mol/L/s' : n === 1 ? '1/s' : 'L/mol/s' }, { l: 'half-life', v: half, u: 's' }, { l: 'initial rate', v: k1 * A0 ** n, u: 'mol/L/s' }, { l: 'k at T+10 K / k', v: arr(1, num(p, 'Ea'), T + 10) / arr(1, num(p, 'Ea')) }],
        charts: [chart(cols, rows, 'c', 'concentrations', 't', ['[A]', '[P]', '[A] exact']), chart(cols, rows, 'lin', n === 1 ? 'ln[A] (linear for 1st order)' : n === 2 ? '1/[A] (linear for 2nd order)' : '[A] (linear for 0th order)', 't', [n === 1 ? 'ln[A]' : n === 2 ? '1/[A]' : '[A]']), arrChart],
        draw: (G, i) => bars(G, [['A', rows[i][1]], ['P', rows[i][2]]], A0, rows[i][0]),
      };
    }
    if (mode === 'reversible A⇌B') {
      const tr = integrate((_t, y) => [-k1 * y[0] + k2 * y[1], k1 * y[0] - k2 * y[1]], [A0, 0], s);
      const K = k1 / k2, Aeq = (A0 * k2) / (k1 + k2);
      const exact = (t: number) => Aeq + (A0 - Aeq) * Math.exp(-(k1 + k2) * t);
      const cols = ['t', '[A]', '[B]', 'Q = [B]/[A]', '[A] exact', 'err', 'net rate'];
      const rows = tr.t.map((t, i) => {
        const [a, b] = tr.y[i];
        return [t, a, b, b / a, exact(t), a - exact(t), k1 * a - k2 * b];
      });
      const last = rows[rows.length - 1];
      const done = last[0] * (k1 + k2) > 15;
      checks.push({ l: 'max |[A] - exact|', exp: 0, act: maxOf(rows.map((r) => Math.abs(r[5]))), u: 'mol/L', abs: 1e-6 * A0 });
      checks.push({ l: 'equilibrium Q → K = k1/k2', exp: K, act: last[3], tol: 1e-4, ref: !done });
      checks.push({ l: 'mass conserved', exp: A0, act: last[1] + last[2], u: 'mol/L', abs: 1e-12 });
      return {
        cols, rows, checks,
        scalars: [{ l: 'k forward', v: k1, u: '1/s' }, { l: 'k reverse', v: k2, u: '1/s' }, { l: 'K = kf/kr', v: K }, { l: 'ΔG° = -RT ln K', v: (-RGAS * T * Math.log(K)) / 1e3, u: 'kJ/mol' }, { l: 'ΔH ≈ Ea1 - Ea2', v: num(p, 'Ea') - num(p, 'Ear'), u: 'kJ/mol' }, { l: 'relaxation time 1/(kf+kr)', v: 1 / (k1 + k2), u: 's' }],
        charts: [chart(cols, rows, 'c', 'concentrations', 't', ['[A]', '[B]', '[A] exact']), chart(cols, rows, 'q', 'reaction quotient', 't', ['Q = [B]/[A]']), arrChart],
        draw: (G, i) => bars(G, [['A', rows[i][1]], ['B', rows[i][2]]], A0, rows[i][0]),
      };
    }
    const tr = integrate((_t, y) => [-k1 * y[0], k1 * y[0] - k2 * y[1], k2 * y[1]], [A0, 0, 0], s);
    const same = Math.abs(k1 - k2) < 1e-12 * k1;
    const Bx = (t: number) => (same ? A0 * k1 * t * Math.exp(-k1 * t) : ((A0 * k1) / (k2 - k1)) * (Math.exp(-k1 * t) - Math.exp(-k2 * t)));
    const tmax = same ? 1 / k1 : Math.log(k2 / k1) / (k2 - k1);
    const cols = ['t', '[A]', '[B]', '[C]', '[B] exact', 'err'];
    const rows = tr.t.map((t, i) => {
      const [a, b, c] = tr.y[i];
      return [t, a, b, c, Bx(t), b - Bx(t)];
    });
    const ib = argmax(rows.map((r) => r[2]));
    let tm = rows[ib][0];
    if (ib > 0 && ib < rows.length - 1) {
      const y0 = rows[ib - 1][2], y1 = rows[ib][2], y2 = rows[ib + 1][2];
      tm += ((0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2)) * s.dt;
    }
    checks.push({ l: 'max |[B] - Bateman exact|', exp: 0, act: maxOf(rows.map((r) => Math.abs(r[5]))), u: 'mol/L', abs: 1e-6 * A0 });
    checks.push({ l: 't of [B] max = ln(k2/k1)/(k2-k1)', exp: tmax, act: tm, u: 's', tol: 1e-3, ref: tmax > rows[rows.length - 1][0] });
    checks.push({ l: '[B] max', exp: Bx(tmax), act: rows[ib][2], u: 'mol/L', tol: 1e-4 });
    return {
      cols, rows, checks,
      scalars: [{ l: 'k1', v: k1, u: '1/s' }, { l: 'k2', v: k2, u: '1/s' }, { l: 't at [B] max', v: tmax, u: 's' }, { l: '[B] max', v: Bx(tmax), u: 'mol/L' }],
      charts: [chart(cols, rows, 'c', 'concentrations', 't', ['[A]', '[B]', '[C]', '[B] exact']), arrChart],
      draw: (G, i) => bars(G, [['A', rows[i][1]], ['B', rows[i][2]], ['C', rows[i][3]]], A0, rows[i][0]),
    };
  },
};

function bars(G: any, v: [string, number][], A0: number, t: number) {
  G.view(0, 10, 0, 10, 12, false);
  v.forEach(([n, c], j) => {
    const h = (8 * c) / (A0 || 1);
    G.rect(1 + j * 3, 1, 2, h, PALETTE[j], true);
    G.text(`${n} ${c.toFixed(4)}`, 1 + j * 3, 0.3, COL.fg);
  });
  G.hud([`t=${t.toFixed(3)} s`]);
}
