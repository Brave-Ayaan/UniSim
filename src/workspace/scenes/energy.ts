// Energy, one track: the track points you place define a smooth coaster track (a cubic spline through them);
// carts ride on it, push off with their own start speed, rub with friction, bump into each other and into the
// buffers at both ends. Every joule is tracked: kinetic + potential + springs + friction losses.
import type { Catalog } from '../catalog';
import { n, emptyScene, tchart, simulate, energyCheck, sprite, label, COL, GROUND, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

/** natural cubic spline y(x) with first and second derivatives */
function spline(xs: number[], ys: number[]) {
  const N = xs.length;
  if (N === 1) return (_x: number) => [ys[0], 0, 0];
  const h = xs.slice(1).map((x, i) => x - xs[i]), M = new Array(N).fill(0);
  if (N > 2) {
    const a = new Array(N).fill(0), b = new Array(N).fill(1), c = new Array(N).fill(0), d = new Array(N).fill(0);
    for (let i = 1; i < N - 1; i++) { a[i] = h[i - 1]; b[i] = 2 * (h[i - 1] + h[i]); c[i] = h[i]; d[i] = 6 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]); }
    for (let i = 2; i < N - 1; i++) { const w = a[i] / b[i - 1]; b[i] -= w * c[i - 1]; d[i] -= w * d[i - 1]; }
    for (let i = N - 2; i >= 1; i--) M[i] = (d[i] - c[i] * M[i + 1]) / b[i];
  }
  return (x: number) => {
    let i = 0;
    while (i < N - 2 && x > xs[i + 1]) i++;
    const H = h[i], A = (xs[i + 1] - x) / H, B = (x - xs[i]) / H;
    const y = A * ys[i] + B * ys[i + 1] + ((A ** 3 - A) * M[i] + (B ** 3 - B) * M[i + 1]) * (H * H) / 6;
    const y1 = (ys[i + 1] - ys[i]) / H - ((3 * A * A - 1) * M[i] - (3 * B * B - 1) * M[i + 1]) * H / 6;
    const y2 = A * M[i] + B * M[i + 1];
    return [y, y1, y2];
  };
}
const zetaOf = (e: number) => (e >= 1 ? 0 : e <= 0 ? 1 : -Math.log(e) / Math.sqrt(Math.PI ** 2 + Math.log(e) ** 2));

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.5), g = n(p.g, 9.80665);
  const pts = ents.filter((e) => e.kind === 'point').sort((a, b) => a.x - b.x);
  const carts = ents.filter((e) => e.kind === 'cart').sort((a, b) => a.x - b.x);
  if (pts.length < 2) return emptyScene('a track needs at least two track points: press E and add them');
  if (!carts.length) return emptyScene('no carts on the track: press E and add one');
  const xs = pts.map((q) => q.x * scale), ys = pts.map((q) => (GROUND - q.y) * scale), tr = spline(xs, ys);
  const N = carts.length, m = carts.map((c) => Math.max(1e-6, n(c.v.m, 100))), mu = carts.map((c) => n(c.v.mu, 0)), half = 0.6 * scale;
  const tc = 30 * s.dt, om2 = (Math.PI / tc) ** 2, zeta = carts.map((c) => zetaOf(n(c.v.e, 0.5))), vs = 0.05;
  const x0 = carts.map((c) => Math.min(xs[xs.length - 1] - half, Math.max(xs[0] + half, c.x * scale)));
  const lo = xs[0] + half, hi = xs[xs.length - 1] - half;
  let elastic = 0;
  const f = (_t: number, y: number[], stats = false) => {
    const d = new Array(2 * N + 1).fill(0);
    if (stats) elastic = 0;
    let diss = 0;
    const F = new Array(N).fill(0); // generalized forces along x from contacts
    const spring = (i: number, ov: number, rel: number, Meff: number, z: number) => { const k = Meff * om2, c = 2 * z * Math.sqrt(Meff * k), Fn = Math.max(0, k * ov + c * rel); diss += (Fn - k * ov) * rel; if (stats) elastic += 0.5 * k * ov * ov; return Fn; };
    for (let i = 0; i < N; i++) {
      const x = y[i], v = y[N + i];
      if (x < lo) F[i] += spring(i, lo - x, -v, m[i], zeta[i]);
      if (x > hi) F[i] -= spring(i, x - hi, v, m[i], zeta[i]);
      if (i < N - 1) { const ov = 2 * half - (y[i + 1] - x); if (ov > 0) { const Fn = spring(i, ov, v - y[N + i + 1], (m[i] * m[i + 1]) / (m[i] + m[i + 1]), Math.max(zeta[i], zeta[i + 1])); F[i] -= Fn; F[i + 1] += Fn; } }
    }
    for (let i = 0; i < N; i++) {
      const x = y[i], v = y[N + i], [, y1, y2] = tr(x), s1 = 1 + y1 * y1;
      const Nn = (m[i] * (g + y2 * v * v)) / Math.sqrt(s1), vt = v * Math.sqrt(s1);
      const Ff = mu[i] * Math.abs(Nn) * (Math.abs(vt) > vs ? Math.sign(vt) : vt / vs);
      diss += Ff * vt;
      d[i] = v;
      d[N + i] = (-g * y1 - y1 * y2 * v * v - (Ff / m[i]) * Math.sqrt(s1) + F[i] / m[i]) / s1;
    }
    d[2 * N] = diss;
    return d;
  };
  const E = (y: number[]) => { f(0, y, true); return carts.reduce((a, _, i) => { const [h, y1] = tr(y[i]); return a + 0.5 * m[i] * (1 + y1 * y1) * y[N + i] ** 2 + m[i] * g * h; }, 0) + elastic; };
  const y0 = [...x0, ...carts.map((c, i) => n(c.v.v0, 0) / Math.sqrt(1 + tr(x0[i])[1] ** 2)), 0];
  const cols = ['t', ...carts.flatMap((c) => [`${c.name} x (m)`, `${c.name} height (m)`, `${c.name} speed (m/s)`, `${c.name} g-force`]), 'mechanical energy (J)', 'friction & impacts (J)'];
  const rows: number[][] = [];
  const yE = simulate(f, y0, s, (t, y) => rows.push([t, ...carts.flatMap((_, i) => { const [h, y1, y2] = tr(y[i]), v = y[N + i], s1 = 1 + y1 * y1; return [y[i], h, Math.abs(v) * Math.sqrt(s1), (1 + (y2 * v * v) / g) / Math.sqrt(s1)]; }), E(y), y[2 * N]]));
  const E0 = E(y0);
  const checks: Check[] = [energyCheck('energy: mechanical + losses = start', E0, E(yE) + yE[2 * N], Math.max(Math.abs(E0), ...carts.map((_, i) => m[i] * g * Math.max(...ys.map(Math.abs)))), s.method, 1e-5)];
  carts.forEach((c, i) => {
    if (N > 1 || mu[i] > 0) return;
    // frictionless lone cart: top speed = √(v0² + 2 g (h0 − lowest height it reaches))
    const j = 1 + 4 * i, hmin = Math.min(...rows.map((r) => r[j + 1])), vmax = Math.max(...rows.map((r) => r[j + 2]));
    checks.push({ l: `${c.name}: top speed √(v₀² + 2gΔh)`, exp: Math.sqrt(n(c.v.v0, 0) ** 2 + 2 * g * (tr(x0[i])[0] - hmin)), act: vmax, u: 'm/s', tol: 2e-3, ref: true });
  });
  const samp = [...Array(201).keys()].map((k) => xs[0] + ((xs[xs.length - 1] - xs[0]) * k) / 200);
  return {
    cols, rows, checks,
    notes: ['the track is a smooth cubic spline through your track points · carts are held on the track (like a coaster) · buffers at both ends'],
    scalars: [...carts.flatMap((c, i) => [{ l: `${c.name}: top speed`, v: Math.max(...rows.map((r) => r[3 + 4 * i])), u: 'm/s' }, { l: `${c.name}: max g-force`, v: Math.max(...rows.map((r) => r[4 + 4 * i])) }]), { l: 'start energy', v: E0, u: 'J' }, { l: 'lost to friction & impacts', v: yE[2 * N], u: 'J' }],
    charts: [
      tchart(cols, rows, 'v', 'speed', carts.map((c) => `${c.name} speed (m/s)`), 'm/s'),
      tchart(cols, rows, 'E', 'energy', ['mechanical energy (J)', 'friction & impacts (J)'], 'J'),
      { id: 'track', title: 'track profile', xl: 'x (m)', yl: 'height (m)', equal: true, series: [{ name: 'track', x: samp, y: samp.map((x) => tr(x)[0]) }] },
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(0, SCENE_W * scale, -2 * scale, GROUND * scale, 14);
      G.ground(0, SCENE_W * scale, 0);
      for (let q = 0; q < samp.length; q += 10) { const h = tr(samp[q])[0]; if (h > 0) G.line(samp[q], 0, samp[q], h, '#2b3036'); }
      G.path(samp, samp.map((x) => tr(x)[0]), COL.fg, 2);
      G.line(xs[0], ys[0], xs[0], ys[0] + 2 * scale, COL.b, 3); G.line(xs[xs.length - 1], ys[ys.length - 1], xs[xs.length - 1], ys[ys.length - 1] + 2 * scale, COL.b, 3);
      carts.forEach((c, i) => { const x = rw[1 + 4 * i], h = rw[2 + 4 * i]; sprite(G, c.sprite, x, h, 2); label(G, `${c.name} ${rw[3 + 4 * i].toFixed(1)} m/s`, x, h, COL.dim, -18); });
      G.hud([`t=${rw[0].toFixed(2)} s  ${N} cart${N > 1 ? 's' : ''} on ${pts.length} track points`, `mechanical ${rw[cols.indexOf('mechanical energy (J)')].toFixed(1)} J · lost ${rw[cols.indexOf('friction & impacts (J)')].toFixed(1)} J`]);
    },
  };
}

export const energyScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'a coaster track through the points you place: carts trade height for speed, rub, bump and bounce off buffers',
  settings: { dt: 0.002, steps: 6000, method: 'rk4' }, timeBased: true,
  envDefs: [{ k: 'g', l: 'gravity', u: 'm/s2', v: 9.80665, s: 0.1, d: 'Acceleration of free fall.' }],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.5, min: 0.001, s: 0.1, d: 'Size of one editor grid cell.' }],
  where: 'track points shape the track (it runs smoothly through them, left to right) · carts start on the track under them · drag a cart sideways to give it a push',
  kinds: [
    { kind: 'point', name: 'track point', sprite: 'trackpt', desc: 'the track passes through here', custom: [] },
    { kind: 'cart', name: 'cart', sprite: 'cart', desc: 'a cart on the track', aim: { kind: 'len', field: 'v0', per: 0.5 }, custom: [
      { k: 'm', l: 'mass', u: 'kg', v: 500, min: 1e-3, s: 50, d: 'Mass of the cart (with riders).' },
      { k: 'v0', l: 'start push', u: 'm/s', v: 0, s: 0.5, d: 'Speed along the track at the start (+ = right). Drag sideways in EDIT.' },
      { k: 'mu', l: 'rolling friction μ', v: 0.01, min: 0, s: 0.005, d: 'Friction force = μ × normal force (wheels ≈ 0.01, a sliding crate ≈ 0.3).' },
      { k: 'e', l: 'bumper bounciness', v: 0.5, min: 0, max: 1, s: 0.05, d: 'How elastic its bumpers are when it hits another cart or the buffers at the ends.' },
    ] },
  ],
  presets: [
    { name: 'coaster train car', kind: 'cart', sprite: 'cart', desc: '500 kg, smooth wheels', v: { m: 500, mu: 0.01, v0: 0 } },
    { name: 'wooden crate', kind: 'cart', sprite: 'crate', desc: '20 kg, sliding μ 0.3', v: { m: 20, mu: 0.3, v0: 0 } },
    { name: 'sled on snow', kind: 'cart', sprite: 'sled', desc: '10 kg, μ 0.05', v: { m: 10, mu: 0.05, v0: 0 } },
    { name: 'skateboard', kind: 'cart', sprite: 'skateboard', desc: '5 kg, μ 0.02', v: { m: 5, mu: 0.02, v0: 2 } },
  ],
  start: [['point', 2, 6], ['point', 18, 30], ['point', 32, 20], ['point', 46, 28], ['point', 62, 12], ['cart', 6, 8]],
  tests: [
    { name: 'frictionless lone cart', list: [['point', 2, 6], ['point', 18, 30], ['point', 32, 20], ['point', 62, 12], ['cart', 6, 8, { mu: 0 }]] },
    { name: 'two carts collide', list: [['point', 2, 6], ['point', 32, 30], ['point', 62, 6], ['cart', 6, 8], ['wooden crate', 32, 28]] },
  ],
  guide(g, X, Y, cp, _p, ents) {
    const pts = ents.filter((e) => e.k === 'point').sort((a, b) => a.x - b.x);
    g.fillStyle = '#8b5a2b'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2);
    if (pts.length < 2) return;
    const tr = spline(pts.map((q) => q.x), pts.map((q) => q.y));
    g.strokeStyle = '#c9d1d9'; g.lineWidth = 2; g.beginPath();
    for (let k = 0; k <= 100; k++) { const x = pts[0].x + ((pts[pts.length - 1].x - pts[0].x) * k) / 100; const y = tr(x)[0]; if (k) g.lineTo(X(x), Y(y)); else g.moveTo(X(x), Y(y)); }
    g.stroke(); g.lineWidth = 1;
  },
};
