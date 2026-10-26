// Optics, one bench: lamps and lasers shine where you put them; every ray then meets whatever lies in its way —
// lenses bend it, mirrors bounce it, glass blocks and prisms refract it (and split white light into colours),
// screens catch it. Moving any element along the bench moves the image.
import type { Catalog } from '../catalog';
import { DEG } from '../../core/num';
import { n, str, emptyScene, label, COL, SCENE_W, SCENE_H, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const WAVES: Record<string, number[]> = { white: [650, 589, 532, 450], red: [650], green: [532], blue: [450], yellow: [589] };
const waveCol = (l: number) => (l >= 620 ? '#ff5050' : l >= 570 ? '#ffd84b' : l >= 500 ? '#5cd65c' : '#5a8cff');
/** Cauchy dispersion from the index at 589 nm and the Abbe number */
const nOf = (nd: number, V: number, l: number) => { const B = (nd - 1) / V / (1 / 0.4861 ** 2 - 1 / 0.6563 ** 2); return nd + B * (1 / (l / 1000) ** 2 - 1 / 0.5893 ** 2); };

interface Seg { x1: number; y1: number; x2: number; y2: number; el: number }
interface El { e: Ent; k: string; cx: number; cy: number; nx: number; ny: number; tx: number; ty: number; f: number; nd: number; V: number; segs: Seg[]; poly?: number[][]; hits: { y: number; l: number }[] }

function run(p: Params, _s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 1), n1 = n(p.n1, 1), W = SCENE_W * scale, H = SCENE_H * scale;
  const pos = (e: Ent) => [e.x * scale, (SCENE_H - e.y) * scale];
  const sources = ents.filter((e) => e.kind === 'lamp' || e.kind === 'laser');
  if (!sources.length) return emptyScene('no light: press E and add a lamp or a laser');
  const els: El[] = ents.filter((e) => !['lamp', 'laser'].includes(e.kind)).map((e) => {
    const [cx, cy] = pos(e), tilt = n(e.v.tilt, 0) * DEG, tx = -Math.sin(tilt), ty = Math.cos(tilt), nx = Math.cos(tilt), ny = Math.sin(tilt);
    const el: El = { e, k: e.kind, cx, cy, nx, ny, tx, ty, f: n(e.v.f, 10), nd: n(e.v.n, 1.52), V: n(e.v.V, 59), segs: [], hits: [] };
    const i = 0;
    const line = (h: number) => [{ x1: cx - tx * h / 2, y1: cy - ty * h / 2, x2: cx + tx * h / 2, y2: cy + ty * h / 2, el: i }];
    if (e.kind === 'lens' || e.kind === 'mirror' || e.kind === 'screen') el.segs = line(n(e.v.h, 8));
    else {
      let pts: number[][];
      if (e.kind === 'block') { const w = n(e.v.w, 4) / 2, h = n(e.v.h, 8) / 2; pts = [[-w, -h], [w, -h], [w, h], [-w, h]]; }
      else { const a = n(e.v.a, 6), r = a / Math.sqrt(3); pts = [90, 210, 330].map((d) => [r * Math.cos(d * DEG), r * Math.sin(d * DEG)]); }
      el.poly = pts.map(([u, v]) => [cx + u * nx + v * tx, cy + u * ny + v * ty]);
      el.segs = el.poly.map((q, j) => { const r2 = el.poly![(j + 1) % el.poly!.length]; return { x1: q[0], y1: q[1], x2: r2[0], y2: r2[1], el: i }; });
    }
    return el;
  });
  els.forEach((el, i) => el.segs.forEach((sg) => (sg.el = i)));
  const segs = els.flatMap((el) => el.segs);
  const inside = (el: El, x: number, y: number) => { const P = el.poly!; let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
  // ---- trace
  interface Ray { src: number; l: number; pts: number[][]; out: number[]; lensOut?: { x: number; y: number; dx: number; dy: number } }
  const rays: Ray[] = [];
  sources.forEach((e, si) => {
    const [x0, y0] = pos(e), ang = n(e.v.ang, 0) * DEG, ls = WAVES[str(e.v.col, e.kind === 'laser' ? 'red' : 'white')] ?? [589];
    const starts: [number, number, number][] = [];
    if (e.kind === 'lamp') { const N = Math.max(1, Math.round(n(e.v.N, 9))), sp = n(e.v.spread, 30) * DEG; for (let k = 0; k < N; k++) starts.push([x0, y0, ang + (N === 1 ? 0 : -sp / 2 + (sp * k) / (N - 1))]); }
    else { const N = Math.max(1, Math.round(n(e.v.N, 1))), w = n(e.v.w, 2); for (let k = 0; k < N; k++) { const off = N === 1 ? 0 : -w / 2 + (w * k) / (N - 1); starts.push([x0 - Math.sin(ang) * off, y0 + Math.cos(ang) * off, ang]); } }
    for (const l of ls) for (const [sx, sy, a] of starts) {
      let x = sx, y = sy, dx = Math.cos(a), dy = Math.sin(a), last = -1;
      const r: Ray = { src: si, l, pts: [[x, y]], out: [] };
      for (let bounce = 0; bounce < 60; bounce++) {
        let best = Infinity, hit: Seg | null = null;
        for (const sg of segs) {
          if (sg === segs[last]) continue;
          const ex = sg.x2 - sg.x1, ey = sg.y2 - sg.y1, den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-15) continue;
          const t = ((sg.x1 - x) * ey - (sg.y1 - y) * ex) / den, u = ((sg.x1 - x) * dy - (sg.y1 - y) * dx) / den;
          if (t > 1e-9 && u >= 0 && u <= 1 && t < best) { best = t; hit = sg; }
        }
        if (!hit) {
          // leave the bench
          const tb = Math.min(dx > 0 ? (W - x) / dx : dx < 0 ? -x / dx : Infinity, dy > 0 ? (H - y) / dy : dy < 0 ? -y / dy : Infinity);
          r.pts.push([x + dx * tb, y + dy * tb]); r.out = [x, y, dx, dy]; break;
        }
        last = segs.indexOf(hit);
        x += dx * best; y += dy * best; r.pts.push([x, y]);
        const el = els[hit.el];
        if (el.k === 'screen') { el.hits.push({ y: (x - el.cx) * el.tx + (y - el.cy) * el.ty, l }); r.out = [x, y, dx, dy]; break; }
        if (el.k === 'lens' || el.k === 'mirror') {
          // ideal thin element: tanθ' = tanθ − h/f (h = height on the element); a mirror also turns the ray back
          const h = (x - el.cx) * el.tx + (y - el.cy) * el.ty, dn = dx * el.nx + dy * el.ny, dt = dx * el.tx + dy * el.ty, sg = Math.sign(dn) || 1;
          const tn = dt / Math.abs(dn) - (el.f === 0 ? 0 : h / el.f), s2 = el.k === 'mirror' ? -sg : sg, L = Math.hypot(1, tn);
          dx = (s2 * el.nx + tn * el.tx) / L; dy = (s2 * el.ny + tn * el.ty) / L;
          if (el.k === 'lens') r.lensOut = { x, y, dx, dy };
          continue;
        }
        // refraction (Snell) or total internal reflection at a glass surface
        let nxs = hit.y2 - hit.y1, nys = -(hit.x2 - hit.x1); const L0 = Math.hypot(nxs, nys); nxs /= L0; nys /= L0;
        const mx = x - nxs * 1e-7, my = y - nys * 1e-7, enteringFromSide = !inside(el, x + dx * 1e-7, y + dy * 1e-7) ? false : true;
        void mx; void my;
        const ng = nOf(el.nd, el.V, l), [na, nb] = enteringFromSide ? [n1, ng] : [ng, n1];
        let c1 = -(dx * nxs + dy * nys);
        if (c1 < 0) { nxs = -nxs; nys = -nys; c1 = -c1; }
        const eta = na / nb, k = 1 - eta * eta * (1 - c1 * c1);
        if (k < 0) { dx += 2 * c1 * nxs; dy += 2 * c1 * nys; last = -1; }
        else { const c2 = Math.sqrt(k); dx = eta * dx + (eta * c1 - c2) * nxs; dy = eta * dy + (eta * c1 - c2) * nys; }
        const Ld = Math.hypot(dx, dy); dx /= Ld; dy /= Ld;
      }
      rays.push(r);
    }
  });
  // ---- results
  const cols = ['ray', 'source', 'wavelength (nm)', 'end x', 'end y', 'path length', 'bounces'];
  const rows = rays.map((r, i) => { const e = r.pts[r.pts.length - 1]; let Lp = 0; for (let k = 1; k < r.pts.length; k++) Lp += Math.hypot(r.pts[k][0] - r.pts[k - 1][0], r.pts[k][1] - r.pts[k - 1][1]); return [i + 1, r.src + 1, r.l, e[0], e[1], Lp, r.pts.length - 2]; });
  const checks: Check[] = [];
  const lenses = els.filter((q) => q.k === 'lens');
  if (sources.length === 1 && sources[0].kind === 'lamp' && lenses.length === 1 && els.every((q) => q.k === 'lens' || q.k === 'screen')) {
    // thin lens: rays from one point meet again at the image: 1/d_o + 1/d_i = 1/f, magnification −d_i/d_o
    const L = lenses[0], [sx, sy] = pos(sources[0]), dO = Math.abs((sx - L.cx) * L.nx + (sy - L.cy) * L.ny), yo = (sx - L.cx) * L.tx + (sy - L.cy) * L.ty;
    const outs = rays.filter((r) => r.lensOut).map((r) => r.lensOut!);
    if (outs.length >= 2 && Math.abs(dO - L.f) > 1e-9 && L.f !== 0) {
      const [a, b] = [outs[0], outs[outs.length - 1]], den = a.dx * b.dy - a.dy * b.dx;
      if (Math.abs(den) > 1e-12) {
        const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / den, ix = a.x + a.dx * t, iy = a.y + a.dy * t;
        const side = Math.sign((L.cx - sx) * L.nx + (L.cy - sy) * L.ny) || 1, di = ((ix - L.cx) * L.nx + (iy - L.cy) * L.ny) * side, yi = (ix - L.cx) * L.tx + (iy - L.cy) * L.ty;
        checks.push({ l: 'image distance 1/dₒ + 1/dᵢ = 1/f', exp: 1 / (1 / L.f - 1 / dO), act: di, u: 'cm', tol: 1e-9 });
        if (Math.abs(yo) > 1e-9) checks.push({ l: 'image height −(dᵢ/dₒ) yₒ', exp: (-(1 / (1 / L.f - 1 / dO)) / dO) * yo, act: yi, u: 'cm', tol: 1e-9 });
      }
    }
  }
  const blocks = els.filter((q) => q.k === 'block');
  if (sources.length === 1 && sources[0].kind === 'laser' && blocks.length === 1 && els.length === 1 && n(sources[0].v.N, 1) === 1 && str(sources[0].v.col, 'red') !== 'white') {
    // a parallel-sided block shifts a beam sideways without turning it: d = t sin(θ−θr)/cos θr
    const r = rays[0], B = blocks[0], [ox, oy, odx, ody] = r.out, a0 = n(sources[0].v.ang, 0) * DEG;
    if (r.pts.length >= 4) {
      const th = Math.acos(Math.min(1, Math.abs(Math.cos(a0) * B.nx + Math.sin(a0) * B.ny))), ng = nOf(B.nd, B.V, r.l), thr = Math.asin((n1 * Math.sin(th)) / ng), t = n(B.e.v.w, 4);
      const [sx, sy] = pos(sources[0]), shift = Math.abs((ox - sx) * -Math.sin(a0) + (oy - sy) * Math.cos(a0));
      checks.push({ l: 'beam leaves the block parallel to how it came in', exp: a0, act: Math.atan2(ody, odx), u: 'rad', abs: 1e-9 });
      checks.push({ l: 'sideways shift t·sin(θ − θr)/cos θr', exp: (t * Math.sin(th - thr)) / Math.cos(thr), act: shift, u: 'cm', tol: 1e-9 });
    }
  }
  const screens = els.filter((q) => q.k === 'screen');
  return {
    cols, rows, checks,
    notes: ['every ray meets the elements in its way, in order · lenses and mirrors are ideal thin elements (tanθ′ = tanθ − h/f); glass refracts by Snell\'s law with dispersion (white light splits)'],
    scalars: [...screens.map((sc) => ({ l: `${sc.e.name}: rays caught`, v: sc.hits.length })), ...screens.filter((sc) => sc.hits.length).map((sc) => ({ l: `${sc.e.name}: spot size`, v: Math.max(...sc.hits.map((h) => h.y)) - Math.min(...sc.hits.map((h) => h.y)), u: 'cm' })), { l: 'rays traced', v: rays.length }],
    charts: screens.filter((sc) => sc.hits.length).map((sc) => ({ id: `scr${sc.e.id}`, title: `${sc.e.name}: where the light lands`, xl: 'position on screen (cm)', yl: 'wavelength (nm)', series: [{ name: 'hits', x: sc.hits.map((h) => h.y), y: sc.hits.map((h) => h.l), pts: true }] })),
    draw(G: Gfx) {
      G.view(0, W, 0, H, 14);
      for (const r of rays) G.path(r.pts.map((q) => q[0]), r.pts.map((q) => q[1]), waveCol(r.l), 1);
      for (const el of els) {
        if (el.poly) G.path(el.poly.map((q) => q[0]), el.poly.map((q) => q[1]), COL.c, 1.5, true);
        else for (const sg of el.segs) G.line(sg.x1, sg.y1, sg.x2, sg.y2, el.k === 'screen' ? COL.fg : el.k === 'mirror' ? '#b0b8c4' : COL.c, el.k === 'lens' ? 3 : 2);
        if (el.k === 'lens' && el.f) for (const sgn of [-1, 1]) G.circle(el.cx + sgn * el.f * el.nx, el.cy + sgn * el.f * el.ny, 2, COL.dim, true, true);
        label(G, el.k === 'lens' || el.k === 'mirror' ? `${el.e.name} f=${el.f}` : el.e.name, el.cx, el.cy, COL.dim, -6 - 6 * G.sy * (el.k === 'screen' || el.k === 'lens' || el.k === 'mirror' ? n(el.e.v.h, 8) / 2 : 3) / 6);
      }
      sources.forEach((e) => { const [x, y] = pos(e); G.circle(x, y, 4, COL.f, true, true); label(G, e.name, x, y, COL.f, -8); });
      G.hud([`${rays.length} rays · ${els.length} element${els.length === 1 ? '' : 's'} · n(surroundings) = ${n1}`, 'dots = focal points']);
    },
  };
}

export const opticsScene: Catalog = {
  env: [], engine: 'scene', run,
  desc: 'one optical bench: lamps and lasers, lenses, mirrors, glass blocks, prisms and screens, all in the same light',
  settings: { dt: 1, steps: 1, method: 'rk4' }, timeBased: false,
  envDefs: [{ k: 'n1', l: 'surrounding medium index', v: 1, min: 1, s: 0.01, d: 'Refractive index of what fills the bench: air 1.000, water 1.333.' }],
  globals: [{ k: 'ws_scale', l: 'scene: cm per cell', u: 'cm', v: 1, min: 1e-3, s: 0.5, d: 'Size of one editor grid cell (sets distances to focal lengths).' }],
  where: 'light leaves each lamp or laser where you put it · move lenses, mirrors and screens along the bench to move the image',
  kinds: [
    { kind: 'lamp', name: 'lamp', sprite: 'lamp', desc: 'a point source shining a fan of rays', custom: [
      { k: 'ang', l: 'aim', u: 'deg', v: 0, s: 5, d: 'Direction of the middle ray (0 = right).' },
      { k: 'spread', l: 'fan width', u: 'deg', v: 20, min: 0, s: 5, d: 'Angle the fan of rays covers.' },
      { k: 'N', l: 'rays', v: 7, min: 1, max: 60, s: 1, d: 'How many rays to draw.' },
      { k: 'col', l: 'colour', v: 'yellow', o: Object.keys(WAVES), d: 'White light splits into colours in glass.' },
    ] },
    { kind: 'laser', name: 'laser', sprite: 'laser', desc: 'a narrow straight beam', custom: [
      { k: 'ang', l: 'aim', u: 'deg', v: 0, s: 1, d: 'Beam direction (0 = right).' },
      { k: 'N', l: 'beams', v: 1, min: 1, max: 40, s: 1, d: 'Several parallel beams across the width.' },
      { k: 'w', l: 'bundle width', u: 'cm', v: 4, min: 0, s: 0.5, d: 'Width of a bundle of parallel beams.' },
      { k: 'col', l: 'colour', v: 'red', o: Object.keys(WAVES), d: 'Wavelength (white = several).' },
    ] },
    { kind: 'lens', name: 'lens', sprite: 'magnifier', desc: 'a thin lens', custom: [
      { k: 'f', l: 'focal length', u: 'cm', v: 10, s: 1, d: 'Positive = converging, negative = diverging.' },
      { k: 'h', l: 'height', u: 'cm', v: 10, min: 0.1, s: 1, d: 'Aperture (rays outside it miss the lens).' },
      { k: 'tilt', l: 'tilt', u: 'deg', v: 0, s: 5, d: 'Rotation from upright.' },
    ] },
    { kind: 'mirror', name: 'mirror', sprite: 'mirror', desc: 'a flat or curved mirror', custom: [
      { k: 'f', l: 'focal length (0 = flat)', u: 'cm', v: 0, s: 1, d: 'Concave mirrors focus (+), convex spread (−).' },
      { k: 'h', l: 'height', u: 'cm', v: 10, min: 0.1, s: 1, d: 'Size of the mirror.' },
      { k: 'tilt', l: 'tilt', u: 'deg', v: 0, s: 5, d: 'Rotation from upright.' },
    ] },
    { kind: 'block', name: 'glass block', sprite: 'glassblock', desc: 'a rectangular slab of glass', custom: [
      { k: 'n', l: 'refractive index (589 nm)', v: 1.52, min: 1, s: 0.01, d: 'Crown glass 1.52, flint 1.62, water 1.333, diamond 2.42.' },
      { k: 'V', l: 'Abbe number', v: 59, min: 1, s: 5, d: 'Low = more dispersion (more colour splitting).' },
      { k: 'w', l: 'thickness', u: 'cm', v: 4, min: 0.01, s: 0.5, d: 'Thickness along the bench.' },
      { k: 'h', l: 'height', u: 'cm', v: 8, min: 0.01, s: 1, d: 'Height.' },
      { k: 'tilt', l: 'tilt', u: 'deg', v: 0, s: 5, d: 'Rotation.' },
    ] },
    { kind: 'prism', name: 'prism', sprite: 'prism', desc: 'a triangular prism', custom: [
      { k: 'n', l: 'refractive index (589 nm)', v: 1.62, min: 1, s: 0.01, d: 'Index at yellow light.' },
      { k: 'V', l: 'Abbe number', v: 36, min: 1, s: 5, d: 'Flint glass ≈ 36: strong dispersion.' },
      { k: 'a', l: 'side', u: 'cm', v: 8, min: 0.01, s: 1, d: 'Edge length.' },
      { k: 'tilt', l: 'tilt', u: 'deg', v: 0, s: 5, d: 'Rotation.' },
    ] },
    { kind: 'screen', name: 'screen', sprite: 'screen', desc: 'catches the light', custom: [
      { k: 'h', l: 'height', u: 'cm', v: 20, min: 0.1, s: 1, d: 'Size of the screen.' },
      { k: 'tilt', l: 'tilt', u: 'deg', v: 0, s: 5, d: 'Rotation.' },
    ] },
  ],
  presets: [
    { name: 'candle', kind: 'lamp', sprite: 'candle', desc: 'yellow point source', v: { col: 'yellow', spread: 20, N: 7 } },
    { name: 'white torch', kind: 'lamp', sprite: 'lamp', desc: 'white light fan', v: { col: 'white', spread: 10, N: 5 } },
    { name: 'laser pointer', kind: 'laser', sprite: 'laser', desc: 'red 650 nm', v: { col: 'red', N: 1 } },
    { name: 'magnifying glass', kind: 'lens', sprite: 'magnifier', desc: 'f = 10 cm', v: { f: 10, h: 8 } },
    { name: 'glasses for short sight', kind: 'lens', sprite: 'glasses', desc: 'f = −25 cm', v: { f: -25, h: 5 } },
    { name: 'make-up mirror', kind: 'mirror', sprite: 'mirror', desc: 'concave, f = 15 cm', v: { f: 15, h: 12 } },
    { name: 'diamond', kind: 'prism', sprite: 'diamond', desc: 'n = 2.42, V = 55', v: { n: 2.417, V: 55, a: 6 } },
    { name: 'fish tank wall', kind: 'block', sprite: 'water', desc: 'water slab n = 1.333', v: { n: 1.333, V: 56, w: 6, h: 14 } },
  ],
  start: [['candle', 6, 16], ['magnifying glass', 22, 18], ['screen', 49, 22], ['laser', 6, 30, { col: 'white' }], ['prism', 30, 30, { tilt: 0 }]],
  tests: [
    { name: 'real image', list: [['candle', 6, 16], ['magnifying glass', 22, 18], ['screen', 50, 18]] },
    { name: 'virtual image', list: [['candle', 16, 16], ['magnifying glass', 22, 18]] },
    { name: 'diverging lens', list: [['candle', 6, 16], ['glasses for short sight', 22, 18]] },
    { name: 'beam through a slab', list: [['laser pointer', 6, 18, { ang: 10 }], ['block', 30, 16]] },
  ],
  guide(g, X, Y, _cp, p, ents) {
    // optical axis through every lens and mirror
    g.strokeStyle = '#2b3036'; g.setLineDash([4, 4]);
    for (const e of ents.filter((q) => q.k === 'lens' || q.k === 'mirror')) { g.beginPath(); g.moveTo(X(0), Y(e.y)); g.lineTo(X(SCENE_W), Y(e.y)); g.stroke(); const f = n(p[`e${e.id}_f`], 0) / n(p.ws_scale, 1); if (f) { g.fillStyle = '#4b525c'; g.fillRect(X(e.x - f) - 2, Y(e.y) - 2, 4, 4); g.fillRect(X(e.x + f) - 2, Y(e.y) - 2, 4, 4); } }
    g.setLineDash([]);
  },
};
