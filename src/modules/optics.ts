import type { SimModule, Result, Params, Settings } from '../core/types';
import { DEG } from '../core/num';
import { chart, num, str } from '../core/build';
import { COL, PALETTE } from '../core/gfx';

export const optics: SimModule = {
  id: 'optics',
  name: 'Optics',
  desc: 'Snell/Fresnel at an interface (verified by Fermat), two-lens ABCD ray trace, exact thick-lens trace & spherical aberration',
  timeBased: false,
  stepsLabel: 'rays / samples',
  settings: { dt: 1, steps: 91, method: 'rk4' },
  modeSettings: { interface: { steps: 91 }, 'thin lens system': { steps: 11 }, 'thick lens trace': { steps: 21 } },
  params: [
    { k: 'mode', l: 'mode', v: 'interface', o: ['interface', 'thin lens system', 'thick lens trace'] },
    { k: 'n1', l: 'n incident', v: 1.0, min: 1, s: 0.01, when: (p) => p.mode === 'interface' },
    { k: 'n2', l: 'n transmitted', v: 1.5, min: 1, s: 0.01, when: (p) => p.mode === 'interface' },
    { k: 'th', l: 'incidence angle', u: 'deg', v: 40, min: 0, max: 89.9, s: 1, when: (p) => p.mode === 'interface' },
    { k: 't', l: 'slab thickness', u: 'mm', v: 20, min: 0, s: 1, when: (p) => p.mode === 'interface' },
    { k: 'f1', l: 'lens 1 focal length', u: 'mm', v: 100, s: 5, when: (p) => p.mode === 'thin lens system' },
    { k: 'f2', l: 'lens 2 focal length', u: 'mm', v: 50, s: 5, when: (p) => p.mode === 'thin lens system' },
    { k: 'sep', l: 'lens separation', u: 'mm', v: 250, min: 0, s: 10, when: (p) => p.mode === 'thin lens system' },
    { k: 'do', l: 'object distance', u: 'mm', v: 300, min: 1e-6, s: 10, when: (p) => p.mode === 'thin lens system' },
    { k: 'ho', l: 'object height', u: 'mm', v: 10, s: 1, when: (p) => p.mode === 'thin lens system' },
    { k: 'R1', l: 'front radius R1', u: 'mm', v: 100, s: 5, when: (p) => p.mode === 'thick lens trace' },
    { k: 'R2', l: 'back radius R2', u: 'mm', v: -100, s: 5, when: (p) => p.mode === 'thick lens trace' },
    { k: 'tc', l: 'centre thickness', u: 'mm', v: 10, min: 0, s: 1, when: (p) => p.mode === 'thick lens trace' },
    { k: 'n', l: 'glass index', v: 1.5168, min: 1, s: 0.01, when: (p) => p.mode === 'thick lens trace' },
    { k: 'ap', l: 'aperture radius', u: 'mm', v: 20, min: 1e-6, s: 1, when: (p) => p.mode === 'thick lens trace' },
  ],
  run(p, s) {
    const m = str(p, 'mode');
    if (m === 'interface') return iface(p, s);
    if (m === 'thin lens system') return thin(p, s);
    return thick(p, s);
  },
};

const fresnel = (n1: number, n2: number, ti: number) => {
  const st = (n1 / n2) * Math.sin(ti);
  if (st >= 1) return { tt: NaN, Rs: 1, Rp: 1 };
  const tt = Math.asin(st), ci = Math.cos(ti), ct = Math.cos(tt);
  const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
  return { tt, Rs: rs * rs, Rp: rp * rp };
};

function iface(p: Params, s: Settings): Result {
  const n1 = num(p, 'n1'), n2 = num(p, 'n2'), ti = num(p, 'th') * DEG, t = num(p, 't');
  const n = Math.min(1000, Math.max(5, Math.floor(s.steps)));
  const cols = ['theta_i (deg)', 'theta_t (deg)', 'Rs', 'Rp', 'R (unpolarised)', 'T'];
  const rows = [...Array(n).keys()].map((k) => {
    const a = (89.99 * k) / (n - 1) * DEG;
    const F = fresnel(n1, n2, a);
    return [a / DEG, F.tt / DEG, F.Rs, F.Rp, 0.5 * (F.Rs + F.Rp), 1 - 0.5 * (F.Rs + F.Rp)];
  });
  // Fermat: ray from A (above) to B (below) through the interface point minimising optical path
  const A = [-Math.tan(ti) * 1, 1];
  const F = fresnel(n1, n2, ti);
  const B = [Number.isNaN(F.tt) ? 1 : Math.tan(F.tt) * 1, -1];
  const opl = (x: number) => n1 * Math.hypot(x - A[0], A[1]) + n2 * Math.hypot(B[0] - x, B[1]);
  let lo = Math.min(A[0], B[0]), hi = Math.max(A[0], B[0]);
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 200; it++) {
    const c = hi - gr * (hi - lo), d = lo + gr * (hi - lo);
    if (opl(c) < opl(d)) hi = d; else lo = c;
  }
  const xm = (lo + hi) / 2;
  const tF = Math.atan2(B[0] - xm, 1);
  const tir = Number.isNaN(F.tt);
  const shift = tir ? NaN : (t * Math.sin(ti - F.tt)) / Math.cos(F.tt);
  // trace through the slab explicitly for the lateral shift
  const xIn = 0, xOut = xIn + t * Math.tan(F.tt);
  const xStraight = xIn + t * Math.tan(ti);
  const shiftTrace = (xStraight - xOut) * Math.cos(ti);
  return {
    cols, rows,
    notes: ['Fermat check: golden-section minimisation of optical path n1|AP| + n2|PB| reproduces Snell', 'table = Fresnel reflectance vs incidence angle'],
    checks: tir ? [{ l: 'total internal reflection', exp: 1, act: 1 }] : [
      { l: 'refraction angle: Fermat vs Snell', exp: F.tt / DEG, act: tF / DEG, u: 'deg', abs: 1e-6 },
      { l: 'slab lateral shift', exp: shift, act: shiftTrace, u: 'mm', abs: 1e-9 },
      { l: 'energy R + T = 1', exp: 1, act: 0.5 * (F.Rs + F.Rp) + (1 - 0.5 * (F.Rs + F.Rp)) },
    ],
    scalars: [
      { l: 'refraction angle', v: F.tt / DEG, u: 'deg' }, { l: 'Rs', v: F.Rs }, { l: 'Rp', v: F.Rp }, { l: 'R unpolarised', v: 0.5 * (F.Rs + F.Rp) },
      { l: 'Brewster angle', v: Math.atan(n2 / n1) / DEG, u: 'deg' }, { l: 'critical angle', v: n1 > n2 ? Math.asin(n2 / n1) / DEG : NaN, u: 'deg' }, { l: 'slab lateral shift', v: shift, u: 'mm' },
    ],
    charts: [chart(cols, rows, 'R', 'Fresnel reflectance', 'theta_i (deg)', ['Rs', 'Rp', 'R (unpolarised)'], { tAxis: false }), chart(cols, rows, 'tt', 'refraction angle', 'theta_i (deg)', ['theta_t (deg)'], { tAxis: false })],
    draw(G, i) {
      const a = rows[i][0] * DEG;
      const Fi = fresnel(n1, n2, a);
      G.view(-1.2, 1.2, -1.1, 1.1);
      G.rect(-1.2, -1.1, 2.4, 1.1, 'rgba(127,209,255,0.08)', true);
      G.line(-1.2, 0, 1.2, 0, COL.dim);
      G.line(0, -1, 0, 1, COL.grid, 1, [2, 3]);
      G.line(-Math.sin(a), Math.cos(a), 0, 0, COL.f, 2);
      G.line(0, 0, Math.sin(a), Math.cos(a), COL.f, 1, [4, 3]);
      if (!Number.isNaN(Fi.tt)) G.line(0, 0, Math.sin(Fi.tt), -Math.cos(Fi.tt), COL.a, 2);
      G.text(`n1=${n1}`, -1.1, 0.9, COL.dim); G.text(`n2=${n2}`, -1.1, -0.9, COL.dim);
      G.hud([`θi=${(a / DEG).toFixed(2)}°  θt=${(Fi.tt / DEG).toFixed(3)}°  R=${(0.5 * (Fi.Rs + Fi.Rp)).toFixed(4)}`]);
    },
  };
}

function thin(p: Params, s: Settings): Result {
  const f1 = num(p, 'f1'), f2 = num(p, 'f2'), d = num(p, 'sep'), so = num(p, 'do'), ho = num(p, 'ho');
  // sequential thin-lens equation
  const si1 = 1 / (1 / f1 - 1 / so);
  const so2 = d - si1;
  const si2 = 1 / (1 / f2 - 1 / so2);
  const M = (-si1 / so) * (-si2 / so2);
  // ABCD tracing: rays from the object tip, z measured from lens 1
  const nr = Math.max(2, Math.floor(s.steps));
  const rays: { z: number[]; y: number[] }[] = [];
  const cols = ['ray', 'angle in (mrad)', 'y at L1', 'y at L2', 'angle out (mrad)', 'axis/image z'];
  const rows: number[][] = [];
  const outs: [number, number][] = [];
  for (let k = 0; k < nr; k++) {
    const yL1 = -15 + (30 * k) / (nr - 1);
    let u = (yL1 - ho) / so;
    let y = yL1;
    u = u - y / f1;
    const yL2 = y + d * u;
    y = yL2;
    u = u - y / f2;
    outs.push([y, u]);
    rays.push({ z: [-so, 0, d, d + Math.max(si2 * 1.4, 150)], y: [ho, yL1, yL2, yL2 + u * Math.max(si2 * 1.4, 150)] });
    rows.push([k, ((yL1 - ho) / so) * 1e3, yL1, yL2, u * 1e3, NaN]);
  }
  // image = intersection of first and last rays after lens 2
  const [y1, u1] = outs[0], [y2, u2] = outs[outs.length - 1];
  const zImg = (y2 - y1) / (u1 - u2);
  const hImg = y1 + u1 * zImg;
  rows.forEach((r, k) => (r[5] = d + zImg + 0 * k));
  const efl = 1 / (1 / f1 + 1 / f2 - d / (f1 * f2));
  return {
    cols, rows,
    notes: ['paraxial ABCD tracing of a ray fan from the object tip; image located where rays re-converge'],
    checks: [
      { l: 'image distance after L2', exp: si2, act: zImg, u: 'mm', abs: 1e-9 },
      { l: 'image height (magnification)', exp: M * ho, act: hImg, u: 'mm', abs: 1e-9 },
    ],
    scalars: [{ l: 'intermediate image after L1', v: si1, u: 'mm' }, { l: 'final image after L2', v: si2, u: 'mm' }, { l: 'magnification', v: M }, { l: 'system EFL', v: efl, u: 'mm' }, { l: 'system power', v: 1000 / efl, u: 'dioptre' }],
    charts: [chart(cols, rows, 'fan', 'ray fan', 'y at L1', ['y at L2', 'angle out (mrad)'], { tAxis: false })],
    draw(G, i) {
      const zmax = d + Math.max(si2 * 1.3, 100);
      G.view(-so - 10, zmax, -40, 40, 18, false);
      G.line(-so - 10, 0, zmax, 0, COL.grid);
      G.line(0, -30, 0, 30, COL.fg, 2); G.line(d, -30, d, 30, COL.fg, 2);
      G.arrow(-so, 0, 0, ho * G.sy, COL.c, 'obj');
      if (Number.isFinite(si2)) G.arrow(d + si2, 0, 0, M * ho * G.sy, COL.d, 'img');
      rays.forEach((r, k) => G.path(r.z, r.y, k === i ? '#ffffff' : PALETTE[k % PALETTE.length]));
      G.hud([`L1 f=${f1}  L2 f=${f2}  image at L2+${si2.toFixed(3)} mm, m=${M.toFixed(4)}`]);
    },
  };
}

function thick(p: Params, s: Settings): Result {
  const R1 = num(p, 'R1'), R2 = num(p, 'R2'), t = num(p, 'tc'), n = num(p, 'n'), ap = num(p, 'ap');
  const P = (n - 1) * (1 / R1 - 1 / R2 + ((n - 1) * t) / (n * R1 * R2));
  const f = 1 / P;
  const bfl = f * (1 - ((n - 1) * t) / (n * R1));
  // vector Snell refraction at a sphere centred on the axis
  const refract = (d: number[], nrm: number[], n1: number, n2: number) => {
    let c = -(nrm[0] * d[0] + nrm[1] * d[1]);
    let N = nrm;
    if (c < 0) { N = [-nrm[0], -nrm[1]]; c = -c; }
    const r = n1 / n2, k = 1 - r * r * (1 - c * c);
    if (k < 0) return null;
    return [r * d[0] + (r * c - Math.sqrt(k)) * N[0], r * d[1] + (r * c - Math.sqrt(k)) * N[1]];
  };
  const hitSphere = (o: number[], d: number[], zc: number, R: number) => {
    // sphere centre (zc, 0), signed radius R (vertex at zc - R); choose intersection nearest the vertex
    const oc = [o[0] - zc, o[1]];
    const b = oc[0] * d[0] + oc[1] * d[1], c = oc[0] ** 2 + oc[1] ** 2 - R * R;
    const disc = b * b - c;
    if (disc < 0) return null;
    const ts = [-b - Math.sqrt(disc), -b + Math.sqrt(disc)].filter((x) => x > 1e-12);
    const vz = zc - R;
    let best: number[] | null = null;
    for (const tt of ts) { const q = [o[0] + tt * d[0], o[1] + tt * d[1]]; if (!best || Math.abs(q[0] - vz) < Math.abs(best[0] - vz)) best = q; }
    return best;
  };
  const trace = (h: number) => {
    const o = [-20, h];
    let d = [1, 0];
    const p1 = hitSphere(o, d, R1, R1);
    if (!p1) return null;
    const n1v = [(p1[0] - R1) / Math.abs(R1), p1[1] / Math.abs(R1)];
    const d1 = refract(d, n1v, 1, n);
    if (!d1) return null;
    const p2 = hitSphere(p1, d1, t + R2, R2);
    if (!p2) return null;
    const n2v = [(p2[0] - t - R2) / Math.abs(R2), p2[1] / Math.abs(R2)];
    d = refract(d1, n2v, n, 1) ?? [NaN, NaN];
    const zc = p2[0] - (p2[1] / d[1]) * d[0];
    return { pts: [o, p1, p2], d, zc };
  };
  const nr = Math.max(3, Math.floor(s.steps));
  const par = trace(1e-4 * ap);
  const zPar = par ? par.zc - t : NaN;
  const cols = ['ray h (mm)', 'axis crossing after back vertex (mm)', 'LSA (mm)', 'exit angle (deg)'];
  const rows: number[][] = [];
  const tr: ReturnType<typeof trace>[] = [];
  for (let k = 0; k < nr; k++) {
    const h = (ap * (k + 1)) / nr;
    const r = trace(h);
    tr.push(r);
    rows.push(r ? [h, r.zc - t, r.zc - t - zPar, Math.atan2(r.d[1], r.d[0]) / DEG] : [h, NaN, NaN, NaN]);
  }
  const valid = rows.filter((r) => !Number.isNaN(r[2]));
  // LSA ∝ h² for third-order aberration: fit coefficient from the smallest rays
  return {
    cols, rows,
    notes: ['exact 2D meridional ray trace with vector Snell at both spherical surfaces; paraxial focus from lensmaker (thick)'],
    checks: [
      { l: 'paraxial BFL (lensmaker thick)', exp: bfl, act: zPar, u: 'mm', tol: 1e-6 },
    ],
    scalars: [
      { l: 'effective focal length', v: f, u: 'mm' }, { l: 'back focal length', v: bfl, u: 'mm' }, { l: 'marginal ray LSA', v: valid.length ? valid[valid.length - 1][2] : NaN, u: 'mm' },
      { l: 'f-number', v: f / (2 * ap) }, { l: 'rays traced', v: valid.length },
    ],
    charts: [chart(cols, rows, 'lsa', 'longitudinal spherical aberration', 'LSA (mm)', ['ray h (mm)'], { tAxis: false })],
    draw(G, i) {
      const zmax = t + Math.max(bfl * 1.2, 20);
      G.view(-25, zmax, -ap * 1.3, ap * 1.3, 16, false);
      G.line(-25, 0, zmax, 0, COL.grid);
      const prof = (zc: number, R: number) => {
        const xs: number[] = [], ys: number[] = [];
        for (let k = -40; k <= 40; k++) {
          const y = (ap * 1.05 * k) / 40;
          if (Math.abs(y) > Math.abs(R)) continue;
          xs.push(zc - Math.sign(R) * Math.sqrt(R * R - y * y));
          ys.push(y);
        }
        G.path(xs, ys, COL.fg);
      };
      prof(R1, R1); prof(t + R2, R2);
      tr.forEach((r, k) => {
        if (!r) return;
        const end = [r.pts[2][0] + r.d[0] * (zmax - r.pts[2][0]) / r.d[0], r.pts[2][1] + (r.d[1] * (zmax - r.pts[2][0])) / r.d[0]];
        G.path([...r.pts.map((q) => q[0]), end[0]], [...r.pts.map((q) => q[1]), end[1]], k === i ? '#ffffff' : COL.a);
      });
      G.line(t + bfl, -ap * 0.2, t + bfl, ap * 0.2, COL.d);
      G.hud([`paraxial focus (red) BFL=${bfl.toFixed(3)} mm   sel h=${rows[i]?.[0].toFixed(2)} LSA=${rows[i]?.[2].toFixed(4)} mm`]);
    },
  };
}
