import type { SimModule, Result, Params, Settings, Check } from '../core/types';
import { integrate, G0, DEG, bisect, eig2, solve, fbdAscii, maxOf, minOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

export const vehicle: SimModule = {
  id: 'vehicle',
  name: 'Vehicle dynamics',
  desc: 'braking distance with weight transfer & drag (closed form), cornering slide vs rollover, quarter-car suspension',
  timeBased: true,
  settings: { dt: 0.001, steps: 10000, method: 'rk4' },
  modeSettings: { braking: { dt: 0.001, steps: 10000 }, cornering: { steps: 400 }, suspension: { dt: 0.0005, steps: 8000 } },
  params: [
    { k: 'mode', l: 'mode', v: 'braking', o: ['braking', 'cornering', 'suspension'] },
    { k: 'm', l: 'vehicle mass', u: 'kg', v: 1500, min: 1e-6, s: 50, when: (p) => p.mode !== 'suspension' },
    { k: 'v0', l: 'initial speed', u: 'km/h', v: 100, min: 0, s: 5, when: (p) => p.mode === 'braking' },
    { k: 'mu', l: 'peak friction μ', v: 0.8, min: 0, s: 0.05, when: (p) => p.mode !== 'suspension' },
    { k: 'muk', l: 'locked-wheel μ', v: 0.7, min: 0, s: 0.05, when: (p) => p.mode === 'braking' },
    { k: 'abs', l: 'ABS', v: 'on', o: ['on', 'off'], when: (p) => p.mode === 'braking' },
    { k: 'tr', l: 'reaction time', u: 's', v: 1.0, min: 0, s: 0.1, when: (p) => p.mode === 'braking' },
    { k: 'grade', l: 'grade (uphill +)', u: 'deg', v: 0, s: 1, when: (p) => p.mode === 'braking' },
    { k: 'CdA', l: 'drag area CdA', u: 'm2', v: 0.7, min: 0, s: 0.05, when: (p) => p.mode === 'braking' },
    { k: 'hcg', l: 'CG height', u: 'm', v: 0.55, min: 1e-6, s: 0.05, when: (p) => p.mode !== 'suspension' },
    { k: 'wb', l: 'wheelbase', u: 'm', v: 2.7, min: 1e-6, s: 0.1, when: (p) => p.mode === 'braking' },
    { k: 'ff', l: 'front static load', u: '%', v: 60, min: 0, max: 100, s: 5, when: (p) => p.mode === 'braking' },
    { k: 'R', l: 'curve radius', u: 'm', v: 50, min: 1e-6, s: 5, when: (p) => p.mode === 'cornering' },
    { k: 'tw', l: 'track width', u: 'm', v: 1.55, min: 1e-6, s: 0.05, when: (p) => p.mode === 'cornering' },
    { k: 'bank', l: 'bank angle', u: 'deg', v: 0, s: 1, when: (p) => p.mode === 'cornering' },
    { k: 'ms', l: 'sprung mass (1/4)', u: 'kg', v: 300, min: 1e-6, s: 10, when: (p) => p.mode === 'suspension' },
    { k: 'mus', l: 'unsprung mass', u: 'kg', v: 40, min: 1e-6, s: 5, when: (p) => p.mode === 'suspension' },
    { k: 'ks', l: 'spring rate', u: 'N/m', v: 20000, min: 1e-6, s: 1000, when: (p) => p.mode === 'suspension' },
    { k: 'cs', l: 'damper rate', u: 'N s/m', v: 1500, min: 0, s: 100, when: (p) => p.mode === 'suspension' },
    { k: 'kt', l: 'tyre stiffness', u: 'N/m', v: 200000, min: 1e-6, s: 10000, when: (p) => p.mode === 'suspension' },
    { k: 'road', l: 'road input', v: 'step', o: ['step', 'sine'], when: (p) => p.mode === 'suspension' },
    { k: 'zr', l: 'bump height / amplitude', u: 'm', v: 0.05, s: 0.01, when: (p) => p.mode === 'suspension' },
    { k: 'fr', l: 'sine frequency', u: 'Hz', v: 1.5, min: 1e-6, s: 0.1, when: (p) => p.mode === 'suspension' && p.road === 'sine' },
    { k: 'rho', l: 'air density', u: 'kg/m3', v: 1.225, min: 0, s: 0.01, when: (p) => p.mode === 'braking' },
  ],
  run(p, s) {
    const m = str(p, 'mode');
    if (m === 'braking') return braking(p, s);
    if (m === 'cornering') return cornering(p, s);
    return suspension(p, s);
  },
};

function braking(p: Params, s: Settings): Result {
  const m = num(p, 'm'), v0 = num(p, 'v0') / 3.6, mu = str(p, 'abs') === 'on' ? num(p, 'mu') : num(p, 'muk'), tr = num(p, 'tr'), th = num(p, 'grade') * DEG;
  const CdA = num(p, 'CdA'), rho = num(p, 'rho'), h = num(p, 'hcg'), wb = num(p, 'wb'), ff = num(p, 'ff') / 100;
  const g = G0;
  // reaction phase: constant speed (textbook convention); braking: a = -(A + B v²)
  const A = g * (mu * Math.cos(th) + Math.sin(th)), B = (0.5 * rho * CdA) / m;
  const f = (t: number, y: number[]) => {
    if (t < tr || y[1] <= 0) return [t < tr ? y[1] : 0, 0];
    return [y[1], -(A + B * y[1] * y[1])];
  };
  // split exactly at the reaction instant so the step discontinuity isn't smeared
  const n1 = Math.round(tr / s.dt);
  const part1 = integrate((_t, y) => [y[1], 0], [0, v0], { ...s, steps: Math.max(1, n1), dt: n1 > 0 ? tr / n1 : s.dt }, { nq: 1 });
  const y1 = part1.y[part1.y.length - 1];
  const part2 = integrate((_t, y) => [y[1], -(A + B * y[1] * y[1])], y1, s, { nq: 1, t0: tr, stop: (_t, y) => y[1] <= 0 });
  void f;
  const ts = [...part1.t, ...part2.t.slice(1)], ys = [...part1.y, ...part2.y.slice(1)];
  const cols = ['t', 'x', 'v (km/h)', 'decel (g)', 'F_brake (kN)', 'F_drag (N)', 'N_front (kN)', 'N_rear (kN)'];
  const rows = ts.map((t, i) => {
    const [x, v] = ys[i];
    const braking = t >= tr && v > 0;
    const a = braking ? A + B * v * v : 0;
    const dN = (m * a * h) / wb; // longitudinal load transfer
    return [t, x, v * 3.6, a / g, braking ? (m * g * mu * Math.cos(th)) / 1e3 : 0, 0.5 * rho * CdA * v * v, (m * g * Math.cos(th) * ff + dN) / 1e3, (m * g * Math.cos(th) * (1 - ff) - dN) / 1e3];
  });
  // land on v = 0
  if (part2.stopped) {
    const a = rows[rows.length - 2], b = rows[rows.length - 1], fr = a[2] / (a[2] - b[2]);
    rows[rows.length - 1] = a.map((v, j) => v + fr * (b[j] - v));
  }
  const last = rows[rows.length - 1];
  const dReact = v0 * tr;
  const dBrake = B > 0 ? Math.log(1 + (B * v0 * v0) / A) / (2 * B) : (v0 * v0) / (2 * A);
  const tBrake = B > 0 ? Math.atan(v0 * Math.sqrt(B / A)) / Math.sqrt(A * B) : v0 / A;
  const checks: Check[] = A > 0 ? [
    { l: 'stopping distance (closed form)', exp: dReact + dBrake, act: last[1], u: 'm', tol: 1e-4 },
    { l: 'stopping time', exp: tr + tBrake, act: last[0], u: 's', tol: 1e-4 },
  ] : [];
  const dNoDrag = dReact + (v0 * v0) / (2 * A);
  return {
    cols, rows, checks,
    notes: A <= 0 ? ['friction cannot overcome the downhill grade: vehicle never stops'] : ['braking: a = g(μcosθ + sinθ) + ρCdA v²/2m; weight transfer ΔN = m a h / L'],
    scalars: [
      { l: 'reaction distance', v: dReact, u: 'm' }, { l: 'braking distance', v: dBrake, u: 'm' }, { l: 'total stopping distance', v: dReact + dBrake, u: 'm' },
      { l: 'no-drag textbook distance', v: dNoDrag, u: 'm' }, { l: 'peak front load', v: maxOf(rows.map((r) => r[6])), u: 'kN' }, { l: 'rear load at onset', v: rows.find((r) => r[3] > 0)?.[7] ?? NaN, u: 'kN' },
    ],
    charts: [chart(cols, rows, 'v', 'speed', 't', ['v (km/h)']), chart(cols, rows, 'x', 'distance', 't', ['x'], { yl: 'm' }), chart(cols, rows, 'N', 'axle loads', 't', ['N_front (kN)', 'N_rear (kN)'])],
    draw(G, i) {
      const r = rows[i];
      const D = Math.max(dReact + dBrake, 1) * 1.1;
      G.view(-0.05 * D, D, -0.1 * D, 0.2 * D, 18, true);
      G.ground(-0.05 * D, D, 0);
      G.line(dReact, 0, dReact, 0.05 * D, COL.f, 1, [2, 2]);
      G.line(dReact + dBrake, 0, dReact + dBrake, 0.08 * D, COL.d);
      G.rect(r[1] - 4.5, 0.3, 4.5, 1.3, COL.a, true);
      G.hud([`t=${r[0].toFixed(3)} s  x=${r[1].toFixed(3)} m  v=${r[2].toFixed(3)} km/h  ${r[3] > 0 ? 'BRAKING' : 'reaction'}`]);
    },
    fbd(i) {
      const r = rows[i];
      return fbdAscii('FBD car (side view)', [['weight', 0, -m * g], ['N front', 0, r[6] * 1e3], ['N rear', 0, r[7] * 1e3], ['brake', -r[4] * 1e3, 0], ['drag', -r[5], 0]]);
    },
  };
}

function cornering(p: Params, s: Settings): Result {
  const m = num(p, 'm'), mu = num(p, 'mu'), h = num(p, 'hcg'), R = num(p, 'R'), t = num(p, 'tw'), b = num(p, 'bank') * DEG;
  const g = G0, ssf = t / (2 * h);
  // road-frame accelerations at speed v
  const acc = (v: number) => { const ac = (v * v) / R; return { lat: ac * Math.cos(b) - g * Math.sin(b), nor: g * Math.cos(b) + ac * Math.sin(b) }; };
  const loads = (v: number) => { const a = acc(v); const N = m * a.nor, dN = (m * a.lat * h) / t; return { inn: N / 2 - dN, out: N / 2 + dN, req: a.lat / a.nor }; };
  const vSlide = Math.sqrt((g * R * (Math.sin(b) + mu * Math.cos(b))) / Math.max(1e-12, Math.cos(b) - mu * Math.sin(b)));
  const vRoll = Math.sqrt((g * R * (ssf + Math.tan(b))) / Math.max(1e-12, 1 - ssf * Math.tan(b)));
  const vMax = Math.min(vSlide, vRoll) * 1.3;
  const n = Math.min(2000, Math.max(20, Math.floor(s.steps)));
  const cols = ['v (km/h)', 'lateral accel (g)', 'N inner (kN)', 'N outer (kN)', 'μ required', 'μ margin'];
  const rows = [...Array(n + 1).keys()].map((k) => {
    const v = (vMax * k) / n, L = loads(v);
    return [v * 3.6, acc(v).lat / g, L.inn / 1e3, L.out / 1e3, L.req, mu - L.req];
  });
  // numerical limits by root finding on the force balance
  const vS = bisect((v) => loads(v).req - mu, 0, vMax * 2);
  const vR = bisect((v) => loads(v).inn, 0, vMax * 2);
  const first = vSlide < vRoll ? 'slides first' : 'rolls over first';
  return {
    cols, rows,
    notes: [`rigid-body quasi-static model (no suspension roll); vehicle ${first}`, `static stability factor SSF = t/2h = ${ssf.toFixed(3)}`],
    checks: [
      { l: 'slide speed (banked closed form)', exp: vSlide * 3.6, act: vS * 3.6, u: 'km/h', tol: 1e-6 },
      { l: 'rollover speed (inner wheel lift)', exp: vRoll * 3.6, act: vR * 3.6, u: 'km/h', tol: 1e-6 },
    ],
    targets: [{ l: 'slides before rollover', hit: vSlide < vRoll, err: vSlide / vRoll, u: 'v_slide/v_roll' }],
    scalars: [{ l: 'max speed (slide)', v: vSlide * 3.6, u: 'km/h' }, { l: 'max speed (rollover)', v: vRoll * 3.6, u: 'km/h' }, { l: 'SSF t/2h', v: ssf }, { l: 'design speed (no friction)', v: Math.sqrt(g * R * Math.tan(Math.max(0, b))) * 3.6, u: 'km/h' }],
    charts: [chart(cols, rows, 'N', 'wheel loads vs speed', 'v (km/h)', ['N inner (kN)', 'N outer (kN)'], { tAxis: false }), chart(cols, rows, 'mu', 'friction demand', 'v (km/h)', ['μ required'], { tAxis: false })],
    draw(G, i) {
      const r = rows[i];
      G.view(-2, 2, -0.5, 2.2);
      const tilt = -b;
      const rot = (x: number, y: number): [number, number] => [x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt)];
      const road = [rot(-2, 0), rot(2, 0)];
      G.line(road[0][0], road[0][1], road[1][0], road[1][1], COL.dim, 2);
      const body = [rot(-t / 2, 0.3), rot(t / 2, 0.3), rot(t / 2, 0.3 + 2 * h - 0.3), rot(-t / 2, 0.3 + 2 * h - 0.3)];
      G.path([...body.map((q) => q[0]), body[0][0]], [...body.map((q) => q[1]), body[0][1]], COL.a);
      const cg = rot(0, h);
      G.circle(cg[0], cg[1], 3, COL.f, true, true);
      const wi = rot(-t / 2, 0), wo = rot(t / 2, 0);
      G.arrow(wi[0], wi[1], 0, Math.max(0, r[2]) * 6, COL.c, 'Ni');
      G.arrow(wo[0], wo[1], 0, Math.max(0, r[3]) * 6, COL.c, 'No');
      G.hud([`v=${r[0].toFixed(2)} km/h  a_lat=${r[1].toFixed(3)} g  μ req=${r[4].toFixed(3)}`, `(outside of curve to the right)`]);
    },
  };
}

function suspension(p: Params, s: Settings): Result {
  const ms = num(p, 'ms'), mu = num(p, 'mus'), ks = num(p, 'ks'), cs = num(p, 'cs'), kt = num(p, 'kt'), Z = num(p, 'zr'), sine = str(p, 'road') === 'sine';
  const w = 2 * Math.PI * num(p, 'fr');
  const zr = (t: number) => (sine ? Z * Math.sin(w * t) : t >= 0 ? Z : 0);
  // state [zs, zu, vs, vu] measured from static equilibrium
  const f = (t: number, y: number[]) => {
    const Fs = ks * (y[0] - y[1]) + cs * (y[2] - y[3]);
    return [y[2], y[3], -Fs / ms, (Fs - kt * (y[1] - zr(t))) / mu];
  };
  const tr = integrate(f, [0, 0, 0, 0], s, { nq: 2 });
  const cols = ['t', 'z body', 'z wheel', 'z road', 'body accel (g)', 'suspension travel', 'tyre deflection', 'tyre force (kN)'];
  const rows = tr.t.map((t, i) => {
    const y = tr.y[i];
    const a = f(t, y)[2];
    return [t, y[0], y[1], zr(t), a / G0, y[0] - y[1], y[1] - zr(t), (-kt * (y[1] - zr(t)) + (ms + mu) * G0) / 1e3];
  });
  // undamped natural frequencies from the 2-dof eigenproblem
  const s1 = Math.sqrt(ms), s2 = Math.sqrt(mu);
  const E = eig2(ks / ms, -ks / (s1 * s2), (ks + kt) / mu);
  const fn = E.l.map((l) => Math.sqrt(l) / (2 * Math.PI));
  // complex transfer function zs/zr at ω
  const H = (om: number) => {
    // [ -ms ω² + ks + jω cs , -(ks + jω cs) ; -(ks + jω cs), -mu ω² + ks + kt + jω cs ] z = [0 ; kt]
    const a = [ks - ms * om * om, om * cs], bq = [-ks, -om * cs], d = [ks + kt - mu * om * om, om * cs];
    const re = (x: number[], y: number[]) => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
    const det = [re(a, d)[0] - re(bq, bq)[0], re(a, d)[1] - re(bq, bq)[1]];
    const num2 = [-bq[0] * kt, -bq[1] * kt];
    const dd = det[0] ** 2 + det[1] ** 2;
    return Math.hypot((num2[0] * det[0] + num2[1] * det[1]) / dd, (num2[1] * det[0] - num2[0] * det[1]) / dd);
  };
  const last = rows[rows.length - 1];
  const checks: Check[] = [];
  const zeta = cs / (2 * Math.sqrt(((ks * kt) / (ks + kt)) * ms));
  if (!sine) {
    checks.push({ l: 'final body position = bump', exp: Z, act: last[1], u: 'm', abs: 1e-4 * Math.abs(Z) + 1e-12, ref: last[0] < 8 / (zeta * 2 * Math.PI * fn[0] + 1e-12) });
    checks.push({ l: 'final wheel position = bump', exp: Z, act: last[2], u: 'm', abs: 1e-4 * Math.abs(Z) + 1e-12, ref: last[0] < 8 / (zeta * 2 * Math.PI * fn[0] + 1e-12) });
  } else {
    const tail = rows.filter((r) => r[0] > last[0] - 2 / num(p, 'fr'));
    const amp = (maxOf(tail.map((r) => r[1])) - minOf(tail.map((r) => r[1]))) / 2;
    checks.push({ l: '|zs/zr| steady state (transfer fn)', exp: H(w), act: amp / Math.abs(Z), tol: 5e-3, ref: last[0] < 10 / (zeta * 2 * Math.PI * fn[0] + 1e-12) });
  }
  // verify eigenfrequencies against the characteristic determinant directly
  const detK = (om: number) => (ks - ms * om * om) * (ks + kt - mu * om * om) - ks * ks;
  const om1 = bisect(detK, 1e-9, 2 * Math.PI * Math.sqrt(fn[0] * fn[1]));
  checks.push({ l: 'body mode freq (det K-ω²M = 0)', exp: fn[0], act: om1 / (2 * Math.PI), u: 'Hz', tol: 1e-9 });
  void solve;
  const fs = [...Array(300).keys()].map((k) => 0.1 + (k * 25) / 300);
  return {
    cols, rows, checks,
    notes: ['quarter-car: sprung mass, unsprung mass, spring/damper, tyre spring; displacements from static equilibrium'],
    scalars: [{ l: 'body (ride) frequency', v: fn[0], u: 'Hz' }, { l: 'wheel-hop frequency', v: fn[1], u: 'Hz' }, { l: 'ride damping ratio (approx)', v: zeta }, { l: 'peak body accel', v: maxOf(rows.map((r) => Math.abs(r[4]))), u: 'g' }, { l: 'min tyre load', v: minOf(rows.map((r) => r[7])), u: 'kN' }],
    charts: [
      chart(cols, rows, 'z', 'displacements', 't', ['z body', 'z wheel', 'z road'], { yl: 'm' }),
      chart(cols, rows, 'a', 'body acceleration (comfort)', 't', ['body accel (g)']),
      { id: 'H', title: 'transmissibility |zs/zr|', xl: 'f (Hz)', yl: '', series: [{ name: '|H|', x: fs, y: fs.map((ff) => H(2 * Math.PI * ff)) }] },
    ],
    draw(G, i) {
      const r = rows[i];
      const sc = 4;
      G.view(-1, 1, -0.4, 1.6);
      G.line(-1, r[3] * sc, 1, r[3] * sc, COL.dim, 2);
      const yu = 0.35 + r[2] * sc, ys = 1.05 + r[1] * sc;
      G.spring(0, r[3] * sc, 0, yu - 0.08, COL.dim, 4);
      G.rect(-0.25, yu - 0.08, 0.5, 0.16, COL.b, true);
      G.spring(-0.15, yu + 0.08, -0.15, ys - 0.15, COL.c, 6);
      G.line(0.15, yu + 0.08, 0.15, (yu + ys) / 2, COL.fg, 3); G.line(0.15, (yu + ys) / 2, 0.15, ys - 0.15, COL.fg, 1);
      G.rect(-0.5, ys - 0.15, 1, 0.3, COL.a, true);
      G.hud([`t=${r[0].toFixed(4)}  body=${(r[1] * 1e3).toFixed(2)} mm  wheel=${(r[2] * 1e3).toFixed(2)} mm (x${sc})`]);
    },
  };
}
