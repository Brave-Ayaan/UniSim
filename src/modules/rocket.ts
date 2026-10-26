import type { SimModule, Check } from '../core/types';
import { step, G0, fbdAscii, maxOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

const RE = 6.371e6, MU = 3.986004418e14;

const stageParams = (i: number, mp: number, md: number, isp: number, T: number) => [
  { k: `mp${i}`, l: `S${i} propellant`, u: 't', v: mp, min: 0, s: 1, when: (p: any) => Number(p.ns) >= i },
  { k: `md${i}`, l: `S${i} dry mass`, u: 't', v: md, min: 0, s: 0.5, when: (p: any) => Number(p.ns) >= i },
  { k: `isp${i}`, l: `S${i} Isp`, u: 's', v: isp, min: 1e-6, s: 5, when: (p: any) => Number(p.ns) >= i },
  { k: `T${i}`, l: `S${i} thrust`, u: 'kN', v: T, min: 1e-6, s: 50, when: (p: any) => Number(p.ns) >= i },
];

export const rocket: SimModule = {
  id: 'rocket',
  name: 'Rocket propulsion',
  desc: 'multi-stage vertical ascent: Tsiolkovsky Δv, gravity & drag losses, apogee by energy, target altitude',
  timeBased: true,
  settings: { dt: 0.05, steps: 20000, method: 'rk4' },
  params: [
    { k: 'ns', l: 'stages', v: 2, min: 1, max: 3, s: 1 },
    { k: 'pay', l: 'payload', u: 't', v: 1, min: 0, s: 0.5 },
    ...stageParams(1, 100, 10, 290, 2000),
    ...stageParams(2, 20, 2, 340, 300),
    ...stageParams(3, 5, 0.6, 360, 60),
    { k: 'grav', l: 'gravity model', v: 'inverse square', o: ['inverse square', 'constant', 'off'] },
    { k: 'drag', l: 'drag', v: 'on', o: ['on', 'off'] },
    { k: 'Cd', l: 'drag coeff', v: 0.3, min: 0, s: 0.05, when: (p) => p.drag === 'on' },
    { k: 'dia', l: 'diameter', u: 'm', v: 3.7, min: 0, s: 0.1, when: (p) => p.drag === 'on' },
    { k: 'h0', l: 'launch pad altitude', u: 'm', v: 0, min: 0, s: 100 },
    { k: 'ht', l: 'target apogee', u: 'km', v: 500, min: 0, s: 10 },
    { k: 'htol', l: 'target tolerance', u: 'km', v: 10, min: 0, s: 1 },
  ],
  run(p, s) {
    const ns = Math.max(1, Math.min(3, Math.round(num(p, 'ns'))));
    const pay = num(p, 'pay') * 1e3;
    const st = [...Array(ns).keys()].map((i) => ({ mp: num(p, `mp${i + 1}`) * 1e3, md: num(p, `md${i + 1}`) * 1e3, isp: num(p, `isp${i + 1}`), T: num(p, `T${i + 1}`) * 1e3 }));
    // stage timeline
    let t0 = 0;
    const seg = st.map((S, i) => {
      const above = st.slice(i + 1).reduce((a, q) => a + q.mp + q.md, 0) + pay;
      const mdot = S.T / (S.isp * G0);
      const tb = S.mp / mdot;
      const r = { ...S, m0: above + S.mp + S.md, mdot, tb, ts: t0, dv: S.isp * G0 * Math.log((above + S.mp + S.md) / (above + S.md)) };
      t0 += tb;
      return r;
    });
    const tBurn = t0;
    const mass = (t: number) => {
      for (const S of seg) if (t < S.ts + S.tb) return S.m0 - S.mdot * (t - S.ts);
      return pay + 0; // all stages dropped: payload coasts
    };
    const thrust = (t: number) => { for (const S of seg) if (t < S.ts + S.tb) return S.T; return 0; };
    const stageOf = (t: number) => { for (let i = 0; i < seg.length; i++) if (t < seg[i].ts + seg[i].tb) return i + 1; return 0; };
    const gm = str(p, 'grav'), dragOn = str(p, 'drag') === 'on';
    const A = dragOn ? (Math.PI * num(p, 'dia') ** 2) / 4 : 0, Cd = dragOn ? num(p, 'Cd') : 0;
    const g = (h: number) => (gm === 'off' ? 0 : gm === 'constant' ? G0 : MU / (RE + h) ** 2);
    const rho = (h: number) => 1.225 * Math.exp(-Math.max(0, h) / 8500);
    const D = (h: number, v: number) => 0.5 * rho(h) * Cd * A * v * Math.abs(v);
    // state [h, v, gravity loss, drag loss]; losses ride along as 'velocity' components so they share the integrator.
    // Steps are split at staging/burnout instants and each sub-step uses that phase's mass/thrust (no smeared discontinuity).
    const phase = (t: number) => { for (let i = 0; i < seg.length; i++) if (t < seg[i].ts + seg[i].tb) return i; return seg.length; };
    const fPh = (k: number) => (t: number, y: number[]) => {
      const m = k < seg.length ? seg[k].m0 - seg[k].mdot * (t - seg[k].ts) : pay;
      const T = k < seg.length ? seg[k].T : 0;
      return [y[1], (T - D(y[0], y[1])) / m - g(y[0]), g(y[0]), D(y[0], y[1]) / m];
    };
    const brk = seg.map((S) => S.ts + S.tb);
    const h0 = Math.max(0, num(p, 'h0') || 0);
    const tr = { t: [0], y: [[h0, 0, 0, 0]], stopped: false };
    let bo: number[] | null = null;
    let y = [h0, 0, 0, 0], t = 0;
    for (let i = 1; i <= s.steps; i++) {
      const t1 = i * s.dt;
      const cuts = [t, ...brk.filter((b) => b > t && b < t1), t1];
      for (let j = 1; j < cuts.length; j++) {
        y = step(fPh(phase(0.5 * (cuts[j - 1] + cuts[j]))), cuts[j - 1], y, cuts[j] - cuts[j - 1], s.method, 1);
        if (cuts[j] === tBurn) bo = [tBurn, ...y];
      }
      t = t1;
      tr.t.push(t); tr.y.push(y);
      if (Math.abs(t - tBurn) < 1e-12 * Math.max(1, tBurn)) bo = [tBurn, ...y];
      if (!y.every(Number.isFinite) || (t > tBurn && y[1] <= 0) || (t > 1 && y[0] < h0)) { tr.stopped = true; break; }
    }
    const cols = ['t', 'h (km)', 'v', 'a', 'mass', 'thrust', 'drag', 'g', 'q (kPa)', 'stage', 'gravity loss', 'drag loss'];
    const rows = tr.t.map((t, i) => {
      const [h, v, gl, dl] = tr.y[i];
      const m = mass(t);
      return [t, h / 1e3, v, (thrust(t) - D(h, v)) / m - g(h), m, thrust(t) / 1e3, D(h, v) / 1e3, g(h), (0.5 * rho(h) * v * v) / 1e3, stageOf(t), gl, dl];
    });
    // apogee by interpolation of v = 0
    let apo = maxOf(rows.map((r) => r[1]));
    if (tr.stopped && rows.length > 1 && rows[rows.length - 1][2] <= 0) {
      const a = rows[rows.length - 2], b = rows[rows.length - 1], fr = a[2] / (a[2] - b[2]);
      const it = a.map((v, j) => v + fr * (b[j] - v));
      apo = it[1];
      rows[rows.length - 1] = it;
    }
    const dvTot = seg.reduce((a, S) => a + S.dv, 0);
    const checks: Check[] = [];
    const notes: string[] = [];
    if (bo) {
      // bo = exact integrator state at t = tBurn: [t, h, v, gravity loss, drag loss]
      checks.push({ l: 'v_bo = Δv - gravity loss - drag loss', exp: dvTot - bo[3] - bo[4], act: bo[2], u: 'm/s', tol: 1e-6 });
      if (gm === 'off' && !dragOn) checks.push({ l: 'v_bo = Σ Tsiolkovsky Δv', exp: dvTot, act: bo[2], u: 'm/s', tol: 1e-6 });
      const hb = bo[1], vb = bo[2];
      if (!dragOn && gm === 'constant') checks.push({ l: 'apogee h_bo + v²/2g', exp: (hb + (vb * vb) / (2 * G0)) / 1e3, act: apo, u: 'km', tol: 1e-4 });
      if (!dragOn && gm === 'inverse square') {
        const eps = (vb * vb) / 2 - MU / (RE + hb);
        checks.push({ l: 'apogee from energy (1/r²)', exp: eps < 0 ? (-MU / eps - RE) / 1e3 : Infinity, act: apo, u: 'km', tol: 1e-4 });
      }
    } else notes.push('burnout not reached: increase steps');
    seg.forEach((S, i) => { if (S.T / (S.m0 * G0) < 1 && i === 0 && gm !== 'off') notes.push(`stage 1 T/W = ${(S.T / (S.m0 * G0)).toFixed(3)} < 1: cannot lift off`); });
    if (!tr.stopped) notes.push('apogee not reached within steps*dt');
    const ht = num(p, 'ht'), tol = num(p, 'htol');
    const maxQ = maxOf(rows.map((r) => r[8]));
    return {
      cols, rows, checks, notes,
      targets: [{ l: `apogee target ${ht} km`, hit: Math.abs(apo - ht) <= tol, err: apo - ht, u: 'km' }],
      scalars: [
        ...seg.map((S, i) => ({ l: `S${i + 1} Δv (Tsiolkovsky)`, v: S.dv, u: 'm/s' })),
        { l: 'total ideal Δv', v: dvTot, u: 'm/s' }, { l: 'total burn time', v: tBurn, u: 's' }, { l: 'liftoff mass', v: seg[0].m0 / 1e3, u: 't' },
        { l: 'liftoff T/W', v: seg[0].T / (seg[0].m0 * G0) }, { l: 'apogee', v: apo, u: 'km' }, { l: 'max dynamic pressure', v: maxQ, u: 'kPa' },
        { l: 'burnout speed', v: bo ? bo[2] : NaN, u: 'm/s' }, { l: 'payload fraction', v: pay / seg[0].m0 },
      ],
      charts: [
        chart(cols, rows, 'h', 'altitude', 't', ['h (km)']),
        chart(cols, rows, 'v', 'velocity & losses', 't', ['v', 'gravity loss', 'drag loss'], { yl: 'm/s' }),
        chart(cols, rows, 'f', 'thrust & drag', 't', ['thrust', 'drag'], { yl: 'kN' }),
        chart(cols, rows, 'm', 'mass', 't', ['mass'], { yl: 'kg' }),
      ],
      draw(G, i) {
        const r = rows[i];
        const H = Math.max(apo, ht) * 1.1 || 1;
        G.view(-1, 3, -0.03 * H, H, 22, false);
        G.ground(-1, 3, 0);
        G.line(0.4, ht, 1.6, ht, COL.c, 1, [3, 3]);
        G.text(`target ${ht} km`, 1.65, ht, COL.c);
        G.rect(0.9, r[1], 0.2, H * 0.04, COL.fg, true);
        if (r[5] > 0) G.line(1, r[1], 1, r[1] - H * 0.03, COL.b, 3);
        G.hud([`t=${r[0].toFixed(2)} s  h=${r[1].toFixed(3)} km  v=${r[2].toFixed(3)} m/s  stage ${r[9] || 'coast'}`]);
      },
      fbd(i) {
        const r = rows[i];
        return fbdAscii('FBD vehicle', [['thrust', 0, r[5] * 1e3], ['weight', 0, -r[4] * r[7]], ['drag', 0, -Math.sign(r[2]) * r[6] * 1e3]]);
      },
    };
  },
};
