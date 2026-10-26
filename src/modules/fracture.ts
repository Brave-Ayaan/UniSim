import type { SimModule, Result, Params, Settings } from '../core/types';
import { integrate, bisect, trapz, argmax } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL, heat } from '../core/gfx';

export const fracture: SimModule = {
  id: 'fracture',
  name: 'Fracture & material failure',
  desc: 'tensile test (Ramberg-Osgood, necking by Considère), stress concentration (Kirsch), LEFM + Paris-law fatigue',
  timeBased: false,
  stepsLabel: 'resolution / cycles',
  settings: { dt: 200, steps: 2000, method: 'rk4' },
  modeSettings: { 'tensile test': { steps: 2000 }, 'hole in plate': { steps: 400 }, 'crack fatigue': { dt: 200, steps: 5000 } },
  params: [
    { k: 'mode', l: 'mode', v: 'tensile test', o: ['tensile test', 'hole in plate', 'crack fatigue'] },
    { k: 'E', l: 'Young modulus', u: 'GPa', v: 200, min: 1e-6, s: 10, when: (p) => p.mode === 'tensile test' },
    { k: 'sy', l: 'yield strength (0.2%)', u: 'MPa', v: 250, min: 1e-6, s: 10, when: (p) => p.mode !== 'crack fatigue' },
    { k: 'nRO', l: 'Ramberg-Osgood n', v: 8, min: 1.01, s: 1, when: (p) => p.mode === 'tensile test' },
    { k: 'ef', l: 'fracture true strain', v: 0.6, min: 1e-6, s: 0.05, when: (p) => p.mode === 'tensile test' },
    { k: 'W', l: 'plate width', u: 'mm', v: 100, min: 1e-6, s: 10, when: (p) => p.mode === 'hole in plate' },
    { k: 'dh', l: 'hole diameter', u: 'mm', v: 20, min: 1e-6, s: 2, when: (p) => p.mode === 'hole in plate' },
    { k: 'tp', l: 'plate thickness', u: 'mm', v: 5, min: 1e-6, s: 1, when: (p) => p.mode === 'hole in plate' },
    { k: 'F', l: 'axial load', u: 'kN', v: 40, s: 5, when: (p) => p.mode === 'hole in plate' },
    { k: 'KIC', l: 'fracture toughness', u: 'MPa√m', v: 50, min: 1e-6, s: 5, when: (p) => p.mode === 'crack fatigue' },
    { k: 'Y', l: 'geometry factor Y', v: 1.12, min: 1e-6, s: 0.01, when: (p) => p.mode === 'crack fatigue' },
    { k: 'smax', l: 'max stress', u: 'MPa', v: 200, min: 1e-6, s: 10, when: (p) => p.mode === 'crack fatigue' },
    { k: 'smin', l: 'min stress', u: 'MPa', v: 0, min: 0, s: 10, when: (p) => p.mode === 'crack fatigue' },
    { k: 'a0', l: 'initial crack', u: 'mm', v: 1, min: 1e-6, s: 0.1, when: (p) => p.mode === 'crack fatigue' },
    { k: 'C', l: 'Paris C (m/cycle, MPa√m)', v: 6.9e-12, min: 0, s: 1e-12, when: (p) => p.mode === 'crack fatigue' },
    { k: 'mP', l: 'Paris exponent m', v: 3, min: 0.1, s: 0.1, when: (p) => p.mode === 'crack fatigue' },
  ],
  run(p, s) {
    const m = str(p, 'mode');
    if (m === 'tensile test') return tensile(p, s);
    if (m === 'hole in plate') return hole(p, s);
    return crack(p, s);
  },
};

function tensile(p: Params, s: Settings): Result {
  const E = num(p, 'E') * 1e3, sy = num(p, 'sy'), n = num(p, 'nRO'), ef = num(p, 'ef'); // MPa
  // true-stress Ramberg-Osgood: ε_t = σ/E + 0.002 (σ/σy)^n
  const eps = (sig: number) => sig / E + 0.002 * (sig / sy) ** n;
  const sMax = bisect((sg) => eps(sg) - ef, 0, sy * 1e3);
  const N = Math.max(50, Math.floor(s.steps));
  const cols = ['eng strain', 'eng stress (MPa)', 'true strain', 'true stress (MPa)', 'plastic strain'];
  const rows = [...Array(N + 1).keys()].map((k) => {
    const st = (sMax * k) / N, et = eps(st);
    const ee = Math.exp(et) - 1;
    return [ee, st / (1 + ee), et, st, 0.002 * (st / sy) ** n];
  });
  // Considère: dσ/dε_t = σ  ->  σ (1/E + 0.002 n σ^(n-1)/σy^n) = 1
  const sNeck = bisect((sg) => sg * (1 / E + (0.002 * n * sg ** (n - 1)) / sy ** n) - 1, 1e-9, sMax * 10);
  const uts = sNeck / Math.exp(eps(sNeck));
  const iU = argmax(rows.map((r) => r[1]));
  // 0.2% offset on the true curve: σ = E(ε - 0.002)
  let yOff = NaN;
  for (let k = 1; k < rows.length; k++) {
    const g0 = rows[k - 1][3] - E * (rows[k - 1][2] - 0.002), g1 = rows[k][3] - E * (rows[k][2] - 0.002);
    if (g0 > 0 && g1 <= 0) { yOff = rows[k - 1][3] + (rows[k][3] - rows[k - 1][3]) * (g0 / (g0 - g1)); break; }
  }
  const E0 = rows[1][3] / rows[1][2];
  const tough = trapz(rows.map((r) => r[0]), rows.map((r) => r[1]));
  // refine UTS by parabolic fit around the discrete maximum
  let utsM = rows[iU][1];
  if (iU > 0 && iU < rows.length - 1) {
    const [a, b, c] = [rows[iU - 1][1], rows[iU][1], rows[iU + 1][1]];
    utsM = b - ((a - c) ** 2) / (8 * (a - 2 * b + c));
  }
  return {
    cols, rows,
    notes: ['strain-controlled test: engineering σ = σ_true/(1+ε), ε = e^{ε_true}-1 (uniform deformation assumed past necking)'],
    checks: [
      { l: 'elastic modulus from initial slope', exp: E / 1e3, act: E0 / 1e3, u: 'GPa', tol: 1e-3 },
      { l: '0.2% offset yield (true curve)', exp: sy, act: yOff, u: 'MPa', tol: 1e-3 },
      { l: 'UTS by Considère criterion', exp: uts, act: utsM, u: 'MPa', tol: 1e-4 },
    ],
    scalars: [
      { l: 'UTS (engineering)', v: uts, u: 'MPa' }, { l: 'uniform elongation (true)', v: eps(sNeck) }, { l: 'Hollomon estimate 1/n', v: 1 / n },
      { l: 'modulus of resilience σy²/2E', v: (sy * sy) / (2 * E), u: 'MJ/m3' }, { l: 'toughness ∫σ dε', v: tough, u: 'MJ/m3' }, { l: 'fracture eng. stress', v: rows[rows.length - 1][1], u: 'MPa' },
    ],
    charts: [chart(cols, rows, 'eng', 'stress-strain', 'eng strain', ['eng stress (MPa)'], { tAxis: false }), chart(cols, rows, 'true', 'true stress-strain', 'true strain', ['true stress (MPa)'], { tAxis: false })],
    draw(G, i) {
      const r = rows[i];
      G.view(-1, 11, -1, 7, 10, false);
      const wN = r[0] > rows[iU][0] ? 1 - 0.5 * Math.min(1, (r[0] - rows[iU][0]) / (rows[rows.length - 1][0] - rows[iU][0] || 1)) : 1;
      const Lg = 4 * (1 + r[0]), w0 = 1 / Math.sqrt(1 + r[0]);
      G.rect(5 - Lg / 2 - 1.5, 2.2, 1.5, 1.6, COL.dim, true); G.rect(5 + Lg / 2, 2.2, 1.5, 1.6, COL.dim, true);
      const xs = [5 - Lg / 2, 5 - 0.3, 5, 5 + 0.3, 5 + Lg / 2];
      const hs = [w0, w0, w0 * wN, w0, w0];
      G.fillPoly([...xs, ...xs.slice().reverse()], [...hs.map((h) => 3 + h * 0.5), ...hs.slice().reverse().map((h) => 3 - h * 0.5)], heat(r[1] / (uts || 1)));
      G.hud([`ε=${r[0].toFixed(4)}  σ=${r[1].toFixed(3)} MPa  σ_true=${r[3].toFixed(3)} MPa`]);
    },
  };
}

function hole(p: Params, s: Settings): Result {
  const W = num(p, 'W') / 1e3, d = num(p, 'dh') / 1e3, t = num(p, 'tp') / 1e3, F = num(p, 'F') * 1e3, sy = num(p, 'sy') * 1e6;
  const a = d / 2, sg = F / (W * t), sn = F / ((W - d) * t);
  const Kt = 2 + (1 - d / W) ** 3; // Heywood, net-section based
  const smax = Kt * sn;
  const kirsch = (r: number) => sg * (1 + (a * a) / (2 * r * r) + (3 * a ** 4) / (2 * r ** 4));
  const n = Math.min(4000, Math.max(20, Math.floor(s.steps)));
  const cols = ['r/a', 'σ_yy Kirsch / σ', 'σ_θθ at hole edge θ', 'σ_θθ/σ'];
  const rows = [...Array(n + 1).keys()].map((k) => {
    const r = a * (1 + (4 * k) / n);
    const th = (Math.PI * k) / n;
    return [r / a, kirsch(r) / sg, (th * 180) / Math.PI, 1 - 2 * Math.cos(2 * th)];
  });
  // equilibrium: excess load carried beside the hole equals the load removed by the hole
  const R = a * 400;
  const m = 20000;
  let ex = 0;
  for (let k = 0; k < m; k++) {
    const u0 = k / m, u1 = (k + 1) / m;
    const r0 = a / (1 - u0 * (1 - a / R)), r1 = a / (1 - u1 * (1 - a / R));
    ex += 0.5 * (kirsch(r0) - sg + kirsch(r1) - sg) * (r1 - r0);
  }
  return {
    cols, rows,
    notes: ['Kirsch: infinite plate, uniaxial far-field stress; Heywood finite-width Kt on net section'],
    checks: [
      { l: 'Kirsch peak = 3σ (Kt∞)', exp: 3, act: rows[0][1] },
      { l: 'σ_θθ at θ=0 (compressive) = -σ', exp: -1, act: rows[0][3] },
      { l: 'equilibrium ∫(σyy-σ)dr → σa (to r=400a)', exp: sg * a * (0.5 * (1 - a / R) + 0.5 * (1 - (a / R) ** 3)), act: ex, u: 'N/m', tol: 1e-4 },
    ],
    targets: [{ l: 'peak stress below yield', hit: smax < sy, err: smax / sy, u: 'σ/σy' }],
    scalars: [{ l: 'gross stress', v: sg / 1e6, u: 'MPa' }, { l: 'net-section stress', v: sn / 1e6, u: 'MPa' }, { l: 'Kt (Heywood)', v: Kt }, { l: 'peak stress', v: smax / 1e6, u: 'MPa' }, { l: 'safety factor', v: sy / smax }, { l: 'Inglis Kt ellipse a/b=2', v: 1 + 2 * 2 }],
    charts: [chart(cols, rows, 'k', 'Kirsch stress decay from hole', 'r/a', ['σ_yy Kirsch / σ'], { tAxis: false }), chart(cols, rows, 'th', 'hoop stress around hole', 'σ_θθ at hole edge θ', ['σ_θθ/σ'], { tAxis: false })],
    draw(G, i) {
      G.view(-W / 2 * 1.1, W / 2 * 1.1, -W / 2, W / 2);
      const N = 60;
      for (let ix = 0; ix < N; ix++) for (let iy = 0; iy < N; iy++) {
        const x = -W / 2 + (W * (ix + 0.5)) / N, y = -W / 2 + (W * (iy + 0.5)) / N;
        const r = Math.hypot(x, y);
        if (r < a) continue;
        const syy = kirschField(sg, a, x, y);
        G.ctx.fillStyle = heat(syy / (3 * sg));
        G.ctx.fillRect(G.X(x - W / N / 2), G.Y(y + W / N / 2), (W / N) * G.sx + 1, (W / N) * G.sy + 1);
      }
      G.circle(0, 0, a, COL.fg);
      G.arrow(0, W / 2, 0, 20, COL.f, 'σ'); G.arrow(0, -W / 2, 0, -20, COL.f);
      G.hud([`hoop stress colour map (σ_yy), peak ${(smax / 1e6).toFixed(3)} MPa`, `sel r/a=${rows[i][0].toFixed(3)}`]);
    },
  };
}

/** Kirsch σ_yy at (x,y) for a hole of radius a under far-field σ along y */
function kirschField(s: number, a: number, x: number, y: number) {
  const r = Math.hypot(x, y);
  // polar with θ from the load (y) axis
  const th = Math.atan2(x, y);
  const q = (a * a) / (r * r);
  const srr = (s / 2) * (1 - q) + (s / 2) * (1 - 4 * q + 3 * q * q) * Math.cos(2 * th);
  const stt = (s / 2) * (1 + q) - (s / 2) * (1 + 3 * q * q) * Math.cos(2 * th);
  const srt = (-s / 2) * (1 + 2 * q - 3 * q * q) * Math.sin(2 * th);
  // rotate to y (load) direction: σ_yy = σrr cos²θ + σθθ sin²θ - 2σrθ sinθ cosθ
  return srr * Math.cos(th) ** 2 + stt * Math.sin(th) ** 2 - 2 * srt * Math.sin(th) * Math.cos(th);
}

function crack(p: Params, s: Settings): Result {
  const KIC = num(p, 'KIC'), Y = num(p, 'Y'), smax = num(p, 'smax'), smin = num(p, 'smin'), a0 = num(p, 'a0') / 1e3, C = num(p, 'C'), m = num(p, 'mP');
  const ds = smax - smin;
  const ac = (1 / Math.PI) * (KIC / (Y * smax)) ** 2;
  const dK = (a: number) => Y * ds * Math.sqrt(Math.PI * a);
  const tr = integrate((_N, y) => [C * dK(y[0]) ** m], [a0], s, { stop: (_N, y) => y[0] >= ac });
  const cols = ['cycles N', 'a (mm)', 'ΔK (MPa√m)', 'K_max (MPa√m)', 'da/dN (m/cycle)', 'residual strength (MPa)'];
  const rows = tr.t.map((N, i) => {
    const a = tr.y[i][0];
    return [N, a * 1e3, dK(a), Y * smax * Math.sqrt(Math.PI * a), C * dK(a) ** m, KIC / (Y * Math.sqrt(Math.PI * a))];
  });
  let Nf = NaN;
  if (tr.stopped && rows.length > 1) {
    const A = rows[rows.length - 2], B = rows[rows.length - 1];
    Nf = A[0] + ((ac * 1e3 - A[1]) / (B[1] - A[1])) * (B[0] - A[0]);
  }
  const k = C * (Y * ds * Math.sqrt(Math.PI)) ** m;
  const NfA = Math.abs(m - 2) < 1e-12 ? Math.log(ac / a0) / k : (ac ** (1 - m / 2) - a0 ** (1 - m / 2)) / (k * (1 - m / 2));
  const immediate = a0 >= ac;
  return {
    cols, rows,
    notes: ['K = Yσ√(πa); Paris law da/dN = C ΔK^m integrated over cycles (dt = cycles per step)', ...(tr.stopped || immediate ? [] : ['critical crack not reached: increase steps or dt'])],
    checks: [{ l: 'cycles to failure (closed form)', exp: NfA, act: Nf, u: 'cycles', tol: 2e-3, ref: immediate }],
    targets: [{ l: 'initial K_max < K_IC', hit: !immediate, err: (Y * smax * Math.sqrt(Math.PI * a0)) / KIC, u: 'K/KIC' }],
    scalars: [{ l: 'critical crack length', v: ac * 1e3, u: 'mm' }, { l: 'initial ΔK', v: dK(a0), u: 'MPa√m' }, { l: 'cycles to failure', v: NfA, u: 'cycles' }, { l: 'R ratio', v: smin / smax }],
    charts: [chart(cols, rows, 'a', 'crack growth a(N)', 'cycles N', ['a (mm)'], { tAxis: false }), chart(cols, rows, 'rs', 'residual strength', 'a (mm)', ['residual strength (MPa)'], { tAxis: false })],
    draw(G, i) {
      const r = rows[i];
      G.view(0, 10, 0, 6);
      G.rect(1, 1, 8, 4, COL.dim);
      const L = Math.min(7.9, (r[1] / (ac * 1e3)) * 4);
      G.line(1, 3, 1 + L, 3, COL.d, 2);
      G.arrow(5, 5, 0, 20, COL.f, 'σ'); G.arrow(5, 1, 0, -20, COL.f);
      G.hud([`N=${r[0].toFixed(0)}  a=${r[1].toFixed(4)} mm  K_max=${r[3].toFixed(3)} / ${KIC}`]);
    },
  };
}
