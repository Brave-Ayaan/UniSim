import type { SimModule, Check, Result, Params, Settings } from '../core/types';
import { integrate, bisect, solve, simpson, DEG, G0, step, trapz, fbdAscii, interp, maxOf, minOf } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL } from '../core/gfx';

/** Morrison (2013) sphere drag correlation, valid to Re ~ 1e6 */
export function cdSphere(Re: number) {
  if (Re <= 0) return Infinity;
  return 24 / Re + (2.6 * (Re / 5)) / (1 + (Re / 5) ** 1.52) + (0.411 * (Re / 263000) ** -7.94) / (1 + (Re / 263000) ** -8) + Re ** 0.8 / 461000;
}

export const aero: SimModule = {
  id: 'aero',
  name: 'Aerodynamics',
  desc: 'sphere drag vs Reynolds, airfoil (vortex panel + lifting line), Blasius boundary layer, wind-tunnel cylinder flow',
  timeBased: true,
  settings: { dt: 0.001, steps: 500, method: 'rk4' },
  modeSettings: { 'sphere fall': { dt: 0.001, steps: 15000 }, airfoil: { steps: 500 }, 'boundary layer': { steps: 1000 }, 'cylinder (tunnel)': { steps: 360 } },
  params: [
    { k: 'mode', l: 'mode', v: 'airfoil', o: ['sphere fall', 'airfoil', 'boundary layer', 'cylinder (tunnel)'] },
    { k: 'rho', l: 'fluid density', u: 'kg/m3', v: 1.225, min: 1e-9, s: 0.01 },
    { k: 'mu', l: 'dynamic viscosity', u: 'Pa s', v: 1.81e-5, min: 1e-12, s: 1e-6 },
    { k: 'd', l: 'sphere diameter', u: 'm', v: 0.05, min: 1e-9, s: 0.01, when: (p) => p.mode === 'sphere fall' },
    { k: 'rhos', l: 'sphere density', u: 'kg/m3', v: 1200, min: 1e-9, s: 100, when: (p) => p.mode === 'sphere fall' },
    { k: 'g', l: 'gravity', u: 'm/s2', v: G0, s: 0.1, when: (p) => p.mode === 'sphere fall' },
    { k: 'U', l: 'freestream speed', u: 'm/s', v: 50, min: 1e-9, s: 1, when: (p) => p.mode !== 'sphere fall' },
    { k: 'alpha', l: 'angle of attack', u: 'deg', v: 5, s: 0.5, when: (p) => p.mode === 'airfoil' },
    { k: 'cm', l: 'NACA max camber m', u: '%c', v: 2, min: 0, max: 9.5, s: 0.5, when: (p) => p.mode === 'airfoil' },
    { k: 'cp', l: 'NACA camber pos p', u: '%c', v: 40, min: 5, max: 95, s: 5, when: (p) => p.mode === 'airfoil' },
    { k: 'c', l: 'chord', u: 'm', v: 1, min: 1e-9, s: 0.1, when: (p) => p.mode === 'airfoil' },
    { k: 'span', l: 'wing span', u: 'm', v: 8, min: 1e-9, s: 0.5, when: (p) => p.mode === 'airfoil' },
    { k: 'e', l: 'Oswald efficiency', v: 0.9, min: 0.01, max: 1, s: 0.05, when: (p) => p.mode === 'airfoil' },
    { k: 'cd0', l: 'profile drag CD0', v: 0.01, min: 0, s: 0.001, when: (p) => p.mode === 'airfoil' },
    { k: 'stall', l: 'stall angle', u: 'deg', v: 15, s: 1, when: (p) => p.mode === 'airfoil' },
    { k: 'Lp', l: 'plate length', u: 'm', v: 2, min: 1e-9, s: 0.1, when: (p) => p.mode === 'boundary layer' },
    { k: 'Retr', l: 'transition Re_x', v: 5e5, min: 1, s: 1e5, when: (p) => p.mode === 'boundary layer' },
    { k: 'R', l: 'cylinder radius', u: 'm', v: 0.5, min: 1e-9, s: 0.05, when: (p) => p.mode === 'cylinder (tunnel)' },
    { k: 'Gam', l: 'circulation Γ (cw)', u: 'm2/s', v: 60, s: 5, when: (p) => p.mode === 'cylinder (tunnel)' },
  ],
  run(p, s) {
    const m = str(p, 'mode');
    if (m === 'sphere fall') return sphere(p, s);
    if (m === 'airfoil') return airfoil(p, s);
    if (m === 'boundary layer') return blayer(p, s);
    return cylinder(p, s);
  },
};

function sphere(p: Params, s: Settings): Result {
  const rho = num(p, 'rho'), mu = num(p, 'mu'), d = num(p, 'd'), rs = num(p, 'rhos'), g = num(p, 'g');
  const A = (Math.PI * d * d) / 4, Vol = (Math.PI * d ** 3) / 6, m = rs * Vol;
  const Fd = (v: number) => {
    const Re = (rho * Math.abs(v) * d) / mu;
    return Re < 1e-12 ? 0 : 0.5 * rho * A * cdSphere(Re) * v * Math.abs(v);
  };
  const net = (v: number) => (rs - rho) * Vol * g - Fd(v);
  const vt = bisect(net, 0, 1e5);
  const tr = integrate((_t, y) => [y[1], net(y[1]) / m], [0, 0], s, { nq: 1 });
  const cols = ['t', 'fallen', 'v', 'a', 'Re', 'Cd', 'F_drag', 'F_buoy'];
  const rows = tr.t.map((t, i) => {
    const [y, v] = tr.y[i];
    const Re = (rho * Math.abs(v) * d) / mu;
    return [t, y, v, net(v) / m, Re, Re > 0 ? cdSphere(Re) : NaN, Fd(v), rho * Vol * g];
  });
  const last = rows[rows.length - 1];
  const tau = vt / g;
  const done = last[0] > 8 * tau * (1 - rho / rs);
  const vStokes = ((rs - rho) * g * d * d) / (18 * mu);
  const t95 = rows.find((r) => r[2] >= 0.95 * vt)?.[0] ?? NaN;
  return {
    cols, rows,
    notes: ['Cd(Re): Morrison (2013) correlation; terminal speed from force balance by bisection', ...(done ? [] : ['run longer to reach terminal velocity'])],
    checks: [
      { l: 'terminal velocity', exp: vt, act: last[2], u: 'm/s', tol: 1e-3, ref: !done },
      { l: 'Stokes-law terminal (Re<1 only)', exp: vStokes, act: last[2], u: 'm/s', ref: true },
    ],
    scalars: [
      { l: 'mass', v: m, u: 'kg' }, { l: 'terminal velocity', v: vt, u: 'm/s' }, { l: 'Re at terminal', v: (rho * vt * d) / mu },
      { l: 'Cd at terminal', v: cdSphere((rho * vt * d) / mu) }, { l: 'time to 95% vt', v: t95, u: 's' },
    ],
    charts: [
      chart(cols, rows, 'v', 'velocity', 't', ['v'], { yl: 'm/s' }),
      chart(cols, rows, 'f', 'forces', 't', ['F_drag', 'F_buoy'], { yl: 'N' }),
      { id: 'cdre', title: 'sphere drag curve Cd(Re)', xl: 'log10 Re', yl: 'log10 Cd', series: [{ name: 'Morrison', x: [...Array(200).keys()].map((k) => -1 + (7 * k) / 199), y: [...Array(200).keys()].map((k) => Math.log10(cdSphere(10 ** (-1 + (7 * k) / 199)))) }] },
    ],
    draw(G, i) {
      const r = rows[i];
      G.view(-1, 1, -1, 1);
      G.circle(0, 0.2, 0.15, COL.a);
      G.arrow(0, 0.2, 0, -40, COL.d, `W=${(m * g).toFixed(3)} N`);
      G.arrow(0, 0.2, 0, (40 * r[6]) / (m * g), COL.b, `D=${r[6].toFixed(3)} N`);
      G.arrow(0.1, 0.2, 0, (40 * r[7]) / (m * g), COL.c, 'B');
      G.hud([`t=${r[0].toFixed(3)} s v=${r[2].toFixed(3)} m/s  Re=${r[4].toExponential(3)}  Cd=${r[5].toFixed(3)}`]);
    },
    fbd(i) {
      const r = rows[i];
      return fbdAscii('FBD sphere', [['weight', 0, -m * g], ['drag', 0, r[6]], ['buoyancy', 0, r[7]]]);
    },
  };
}

function airfoil(p: Params, s: Settings): Result {
  const rho = num(p, 'rho'), mu = num(p, 'mu'), U = num(p, 'U'), c = num(p, 'c'), b = num(p, 'span');
  const mC = num(p, 'cm') / 100, pC = num(p, 'cp') / 100, e = num(p, 'e'), cd0 = num(p, 'cd0'), stall = num(p, 'stall') * DEG;
  const AR = b / c, S = b * c;
  const z = (x: number) => (mC === 0 ? 0 : x < pC ? (mC / (pC * pC)) * (2 * pC * x - x * x) : (mC / (1 - pC) ** 2) * (1 - 2 * pC + 2 * pC * x - x * x));
  const dz = (x: number) => (mC === 0 ? 0 : x < pC ? ((2 * mC) / (pC * pC)) * (pC - x) : ((2 * mC) / (1 - pC) ** 2) * (pC - x));
  // lumped-vortex panel method on the camber line (unit chord)
  const N = 200;
  const xv: number[] = [], zv: number[] = [], xc: number[] = [], zc: number[] = [], nx: number[] = [], nz: number[] = [];
  for (let i = 0; i < N; i++) {
    const x0 = i / N, x1 = (i + 1) / N;
    const ang = Math.atan2(z(x1) - z(x0), x1 - x0);
    // planar (thin-airfoil) model: elements on the chord line, camber enters through the panel normals
    const xa = x0 + 0.25 / N, xb = x0 + 0.75 / N;
    xv.push(xa); zv.push(0); xc.push(xb); zc.push(0);
    nx.push(-Math.sin(ang)); nz.push(Math.cos(ang));
  }
  const Am = xc.map((_, i) => xv.map((_, j) => {
    const dx = xc[i] - xv[j], dzz = zc[i] - zv[j], r2 = dx * dx + dzz * dzz;
    return ((dzz / r2) * nx[i] - (dx / r2) * nz[i]) / (2 * Math.PI);
  }));
  // superposition: RHS = -(cos a nx + sin a nz) -> solve for nx and nz parts separately
  const gX = solve(Am, nx.map((v) => -v)), gZ = solve(Am, nz.map((v) => -v));
  const sX = gX.reduce((a, v) => a + v, 0), sZ = gZ.reduce((a, v) => a + v, 0);
  // linearised (thin-airfoil) form so the comparison with thin-airfoil theory is like for like:
  // CL = 2ΣΓ/(Uc) = 2(sX + α sZ)  →  slope 2 sZ, zero-lift angle −sX/sZ
  const cl2d = (a: number) => 2 * (sX + a * sZ);
  const a0num = -sX / sZ;
  const slope = 2 * sZ;
  // thin airfoil theory zero-lift angle
  const a0th = -(1 / Math.PI) * simpson((t) => dz(0.5 * (1 - Math.cos(t))) * (Math.cos(t) - 1), 0, Math.PI, 20000);
  const a3 = slope / (1 + slope / (Math.PI * e * AR));
  const wing = (a: number) => {
    const clmax = a3 * (stall - a0num);
    let CL = a3 * (a - a0num), extra = 0;
    if (a > stall) { CL = clmax * (1 - 0.5 * Math.min(1, (a - stall) / (10 * DEG))); extra = 2 * Math.sin(a - stall) ** 2; }
    const CDi = (CL * CL) / (Math.PI * e * AR);
    return { CL, CDi, CD: cd0 + CDi + extra };
  };
  const q = 0.5 * rho * U * U;
  const n = Math.min(500, Math.max(10, Math.floor(s.steps)));
  const cols = ['alpha (deg)', 'Cl 2D panel', 'Cl thin-airfoil', 'CL wing', 'CDi', 'CD', 'L/D', 'Lift (N)', 'Drag (N)'];
  const rows = [...Array(n + 1).keys()].map((k) => {
    const a = (-5 + (25 * k) / n) * DEG;
    const w = wing(a);
    return [a / DEG, cl2d(a), 2 * Math.PI * (a - a0th), w.CL, w.CDi, w.CD, w.CL / w.CD, q * S * w.CL, q * S * w.CD];
  });
  const al = num(p, 'alpha') * DEG;
  const w = wing(al);
  const Re = (rho * U * c) / mu;
  const checks: Check[] = [
    { l: 'zero-lift angle α0 (thin-airfoil ∫)', exp: a0th / DEG, act: a0num / DEG, u: 'deg', tol: 5e-3, abs: 2e-3 },
    { l: '2D lift slope = 2π', exp: 2 * Math.PI, act: slope, u: '/rad', tol: 2e-3 },
    { l: `Cl(${num(p, 'alpha')}°) panel vs 2π(α-α0)`, exp: 2 * Math.PI * (al - a0th), act: cl2d(al), tol: 5e-3 },
    { l: 'lifting-line slope a0/(1+a0/πeAR)', exp: (2 * Math.PI) / (1 + 2 / (e * AR)), act: a3, u: '/rad', tol: 3e-3 },
  ];
  const sel = Math.round(((num(p, 'alpha') + 5) / 25) * n);
  return {
    cols, rows, checks,
    notes: [`discrete (lumped) vortex method, ${N} panels, planar wake/BC on the chord with NACA camber-line slopes; post-stall model is empirical`, 'table = angle-of-attack sweep (steps = resolution, max 500)'],
    scalars: [
      { l: 'Reynolds (chord)', v: Re }, { l: 'aspect ratio', v: AR }, { l: 'CL', v: w.CL }, { l: 'CDi', v: w.CDi }, { l: 'CD', v: w.CD },
      { l: 'L/D', v: w.CL / w.CD }, { l: 'lift', v: q * S * w.CL, u: 'N' }, { l: 'drag', v: q * S * w.CD, u: 'N' }, { l: 'dynamic pressure', v: q, u: 'Pa' },
      { l: 'α0 (panel)', v: a0num / DEG, u: 'deg' }, { l: 'best L/D', v: maxOf(rows.map((r) => r[6])) },
    ],
    charts: [
      chart(cols, rows, 'cl', 'lift curve', 'alpha (deg)', ['Cl 2D panel', 'Cl thin-airfoil', 'CL wing'], { tAxis: false }),
      chart(cols, rows, 'polar', 'drag polar', 'CD', ['CL wing'], { tAxis: false }),
      chart(cols, rows, 'ld', 'L/D', 'alpha (deg)', ['L/D'], { tAxis: false }),
    ],
    draw(G, i) {
      const a = (rows[i] ?? rows[sel])[0] * DEG;
      G.view(-0.3, 1.3, -0.5, 0.5);
      const xs = [...Array(101).keys()].map((k) => k / 100);
      const rot = (x: number, y: number): [number, number] => [(x - 0.25) * Math.cos(a) + y * Math.sin(a) + 0.25, -(x - 0.25) * Math.sin(a) + y * Math.cos(a)];
      const pts = xs.map((x) => rot(x, z(x)));
      G.path(pts.map((q) => q[0]), pts.map((q) => q[1]), COL.fg, 2);
      for (let k = -4; k <= 4; k++) G.line(-0.3, k * 0.1, -0.15, k * 0.1, COL.grid);
      const ww = wing(a);
      G.arrow(0.25, 0, 0, 60 * Math.max(-1.5, Math.min(1.5, ww.CL)), COL.c, 'L');
      G.arrow(0.25, 0, 300 * ww.CD, 0, COL.d, 'D');
      G.hud([`α=${(a / DEG).toFixed(3)}°  CL=${ww.CL.toFixed(3)}  CD=${ww.CD.toFixed(4)}`]);
    },
  };
}

/** Blasius f''' + ½ f f'' = 0 solved by RK4 shooting */
function blasius() {
  const shoot = (k: number, keep = false) => {
    let y = [0, 0, k];
    const h = 0.001;
    const out: number[][] = [];
    for (let i = 0; i <= 10000; i++) {
      if (keep && i % 10 === 0) out.push([i * h, ...y]);
      y = step((_t, q) => [q[1], q[2], -0.5 * q[0] * q[2]], i * h, y, h, 'rk4');
    }
    return { end: y[1], out, f: y[0], eta: 10.001 };
  };
  let a = 0.3, b = 0.35, fa = shoot(a).end - 1, fb = shoot(b).end - 1;
  for (let i = 0; i < 30 && Math.abs(fb) > 1e-13; i++) {
    const c = b - (fb * (b - a)) / (fb - fa);
    [a, fa] = [b, fb];
    b = c; fb = shoot(b).end - 1;
  }
  const res = shoot(b, true);
  const eta = res.out.map((r) => r[0]), fp = res.out.map((r) => r[2]);
  const eta99 = interp(fp.slice(0, fp.findIndex((v) => v > 0.995)), eta.slice(0, fp.findIndex((v) => v > 0.995)), 0.99);
  const dstar = res.eta - res.f;
  const theta = trapz(eta, fp.map((v) => v * (1 - v)));
  return { fpp0: b, eta, fp, eta99, dstar, theta };
}

function blayer(p: Params, s: Settings): Result {
  const rho = num(p, 'rho'), mu = num(p, 'mu'), U = num(p, 'U'), L = num(p, 'Lp'), Rt = num(p, 'Retr');
  const B = blasius();
  const nu = mu / rho;
  const xt = (Rt * nu) / U;
  const n = Math.min(2000, Math.max(10, Math.floor(s.steps)));
  const at = (x: number) => {
    const Re = (U * x) / nu;
    if (x <= xt) return { Re, d: (B.eta99 * x) / Math.sqrt(Re), ds: (B.dstar * x) / Math.sqrt(Re), th: (B.theta * x) / Math.sqrt(Re), cf: (2 * B.fpp0) / Math.sqrt(Re), lam: 1 };
    const d = (0.37 * x) / Re ** 0.2;
    return { Re, d, ds: d / 8, th: (7 * d) / 72, cf: 0.0592 / Re ** 0.2, lam: 0 };
  };
  const cols = ['x', 'Re_x', 'delta99 (mm)', 'delta* (mm)', 'theta (mm)', 'Cf', 'tau_w (Pa)', 'laminar'];
  const rows = [...Array(n).keys()].map((k) => {
    const x = (L * (k + 1)) / n;
    const r = at(x);
    return [x, r.Re, r.d * 1e3, r.ds * 1e3, r.th * 1e3, r.cf, 0.5 * rho * U * U * r.cf, r.lam];
  });
  // drag per unit width: ∫τ dx with x = s² to remove the 1/√x singularity
  const sN = 4000;
  const sMax = Math.sqrt(L);
  let D = 0;
  for (let k = 1; k <= sN; k++) {
    const s0 = (sMax * (k - 1)) / sN, s1 = (sMax * k) / sN;
    const fI = (ss: number) => (ss === 0 ? (rho * U * U * B.fpp0) / Math.sqrt(U / nu) * 2 : 0.5 * rho * U * U * at(ss * ss).cf * 2 * ss);
    D += 0.5 * (fI(s0) + fI(s1)) * (s1 - s0);
  }
  const ReL = (U * L) / nu;
  const lamOnly = ReL <= Rt;
  const Dlam = 0.5 * rho * U * U * L * (1.328 / Math.sqrt(ReL));
  const Dmix = 0.5 * rho * U * U * L * (0.074 / ReL ** 0.2 - 1742 / ReL);
  return {
    cols, rows,
    notes: ['Blasius similarity ODE solved by RK4 shooting (η∞=10); turbulent: 1/7-power law', `transition at x = ${xt.toFixed(4)} m`],
    checks: [
      { l: "f''(0) (lit. 0.332057)", exp: 0.332057, act: B.fpp0, tol: 1e-5 },
      { l: 'η at u/U=0.99 (lit. 4.9099)', exp: 4.9099, act: B.eta99, tol: 1e-3 },
      { l: 'δ* η-thickness (lit. 1.7208)', exp: 1.7208, act: B.dstar, tol: 1e-4 },
      { l: 'θ η-thickness (lit. 0.6641)', exp: 0.6641, act: B.theta, tol: 1e-3 },
      lamOnly ? { l: 'drag/width 1.328/√Re_L', exp: Dlam, act: D, u: 'N/m', tol: 1e-3 } : { l: 'drag/width (mixed, Prandtl-Schlichting ref)', exp: Dmix, act: D, u: 'N/m', ref: true },
    ],
    scalars: [{ l: 'Re_L', v: ReL }, { l: 'x transition', v: xt, u: 'm' }, { l: 'δ at L', v: rows[rows.length - 1][2], u: 'mm' }, { l: 'drag per width (one side)', v: D, u: 'N/m' }, { l: 'C_D', v: D / (0.5 * rho * U * U * L) }],
    charts: [
      chart(cols, rows, 'd', 'boundary-layer thickness', 'x', ['delta99 (mm)', 'delta* (mm)', 'theta (mm)'], { tAxis: false, yl: 'mm' }),
      chart(cols, rows, 'cf', 'skin friction', 'x', ['Cf'], { tAxis: false }),
      { id: 'prof', title: "Blasius profile u/U = f'(η)", xl: 'u/U', yl: 'η', series: [{ name: "f'", x: B.fp, y: B.eta }] },
    ],
    draw(G, i) {
      const r = rows[i];
      const dm = maxOf(rows.map((q) => q[2])) / 1e3;
      G.view(-0.05 * L, 1.05 * L, -0.1 * dm, 1.6 * dm, 20, false);
      G.line(0, 0, L, 0, COL.fg, 2);
      G.path(rows.map((q) => q[0]), rows.map((q) => q[2] / 1e3), COL.a);
      if (xt < L) G.line(xt, 0, xt, 1.4 * dm, COL.dim, 1, [3, 3]);
      const x = r[0], d = r[2] / 1e3;
      for (let k = 0; k <= 12; k++) {
        const yy = (k / 12) * 1.3 * d;
        const u = r[7] ? interp(B.eta, B.fp, (yy / d) * B.eta99) : Math.min(1, (yy / d) ** (1 / 7));
        G.arrow(x, yy, u * 40, 0, COL.b);
      }
      G.hud([`x=${x.toFixed(3)} m  Re_x=${r[1].toExponential(3)}  ${r[7] ? 'laminar' : 'turbulent'}  δ=${r[2].toFixed(3)} mm`]);
    },
  };
}

function cylinder(p: Params, s: Settings): Result {
  const rho = num(p, 'rho'), U = num(p, 'U'), R = num(p, 'R'), Gm = num(p, 'Gam');
  const n = Math.min(720, Math.max(16, Math.floor(s.steps)));
  const cols = ['theta (deg)', 'V_theta', 'Cp', 'p - p_inf (Pa)'];
  const rows = [...Array(n + 1).keys()].map((k) => {
    const th = (2 * Math.PI * k) / n;
    const vt = -2 * U * Math.sin(th) - Gm / (2 * Math.PI * R);
    const cp = 1 - (vt / U) ** 2;
    return [th / DEG, vt, cp, 0.5 * rho * U * U * cp];
  });
  const th = rows.map((r) => r[0] * DEG);
  const Lp = -trapz(th, rows.map((r, k) => r[3] * Math.sin(th[k]) * R));
  const Dp = -trapz(th, rows.map((r, k) => r[3] * Math.cos(th[k]) * R));
  const vel = (x: number, y: number): [number, number] => {
    const r = Math.hypot(x, y), t = Math.atan2(y, x);
    const ur = U * Math.cos(t) * (1 - (R * R) / (r * r)), ut = -U * Math.sin(t) * (1 + (R * R) / (r * r)) - Gm / (2 * Math.PI * r);
    return [ur * Math.cos(t) - ut * Math.sin(t), ur * Math.sin(t) + ut * Math.cos(t)];
  };
  const lines: number[][][] = [];
  for (let k = -12; k <= 12; k++) {
    let q = [-4 * R, k * 0.25 * R];
    const pts = [q];
    for (let it = 0; it < 3000; it++) {
      const h = 0.01 * R;
      const f = (_t: number, y: number[]) => { const [u, v] = vel(y[0], y[1]); const m = Math.hypot(u, v) || 1; return [u / m, v / m]; };
      q = step(f, 0, q, h, 'rk4');
      pts.push(q);
      if (q[0] > 4 * R || Math.abs(q[1]) > 3.2 * R || Math.hypot(q[0], q[1]) < R * 1.001) break;
    }
    lines.push(pts);
  }
  const sinS = -Gm / (4 * Math.PI * U * R);
  return {
    cols, rows,
    notes: ['inviscid potential flow: uniform stream + doublet + vortex; forces from numerically integrated surface pressure', 'table = surface pressure distribution (steps = resolution, max 720)'],
    checks: [
      { l: 'lift/span = ρUΓ (Kutta-Joukowski)', exp: rho * U * Gm, act: Lp, u: 'N/m', abs: 1e-9 },
      { l: "drag/span = 0 (d'Alembert)", exp: 0, act: Dp, u: 'N/m', abs: 1e-6 * Math.max(1, Math.abs(rho * U * Gm)) },
      { l: 'Cp at front stagnation (Γ=0) = 1', exp: 1, act: rows[n / 2 | 0][2], ref: Gm !== 0 },
    ],
    scalars: [
      { l: 'lift per span', v: Lp, u: 'N/m' }, { l: 'C_L = Γ/(U R)', v: Gm / (U * R) },
      { l: 'stagnation angle', v: Math.abs(sinS) <= 1 ? Math.asin(sinS) / DEG : NaN, u: 'deg' },
      { l: 'max surface speed', v: maxOf(rows.map((r) => Math.abs(r[1]))), u: 'm/s' }, { l: 'min Cp', v: minOf(rows.map((r) => r[2])) },
    ],
    charts: [
      chart(cols, rows, 'cp', 'surface pressure coefficient', 'theta (deg)', ['Cp'], { tAxis: false }),
      chart(cols, rows, 'vt', 'surface velocity', 'theta (deg)', ['V_theta'], { tAxis: false }),
    ],
    draw(G, i) {
      G.view(-4 * R, 4 * R, -3 * R, 3 * R);
      G.rect(-4 * R, -3 * R, 8 * R, 6 * R, COL.dim);
      lines.forEach((l) => G.path(l.map((q) => q[0]), l.map((q) => q[1]), COL.a));
      G.circle(0, 0, R, COL.fg);
      const t = rows[i][0] * DEG;
      G.circle(R * Math.cos(t), R * Math.sin(t), 4, COL.f, true, true);
      G.arrow(0, 0, 0, Math.max(-60, Math.min(60, (Lp / (rho * U * U * R)) * 30)), COL.c, 'L');
      G.hud([`wind tunnel: U=${U} m/s Γ=${Gm} m2/s  θ=${rows[i][0].toFixed(1)}° Cp=${rows[i][2].toFixed(3)}`]);
    },
  };
}
