// Room acoustics, one floor plan: a shoebox room, loudspeakers, microphones and absorber panels. Rays from
// every speaker bounce around the same room; a panel makes the wall it hangs on more absorbent, so where you
// put things changes the direct sound, the levels and the reverberation at every microphone.
import type { Catalog } from '../catalog';
import { rng, cadd, cdiv, cabs, type C, maxOf } from '../../core/num';
import { n, str, emptyScene, tchart, spriteC, label, COL, SCENE_H, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const P0 = 20e-6, RHO = 1.204;
const surfAlpha: Record<string, number> = { 'painted concrete': 0.02, plaster: 0.05, 'wood panelling': 0.1, carpet: 0.3, curtains: 0.5, 'acoustic foam': 0.8 };
const MATS = Object.keys(surfAlpha);

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.25);
  const room = ents.find((e) => e.kind === 'room');
  const spk = ents.filter((e) => e.kind === 'spk'), mics = ents.filter((e) => e.kind === 'mic'), panels = ents.filter((e) => e.kind === 'panel');
  if (!room) return emptyScene('no room: press E and add one (speakers and microphones go inside it)');
  if (!spk.length || !mics.length) return emptyScene('a room needs at least one speaker and one microphone (press E)');
  const c = 331.3 * Math.sqrt(1 + n(p.T, 20) / 273.15);
  const L = [n(room.v.Lx, 8), n(room.v.Ly, 6), n(room.v.Lz, 3)];
  const ox = room.x * scale - L[0] / 2, oy = (SCENE_H - room.y) * scale - L[1] / 2;
  const plan = (e: Ent) => [e.x * scale - ox, (SCENE_H - e.y) * scale - oy];
  const inside = (e: Ent) => { const [x, y] = plan(e); return x > 0 && x < L[0] && y > 0 && y < L[1]; };
  const notes: string[] = [];
  for (const e of [...spk, ...mics, ...panels]) if (!inside(e)) notes.push(`${e.name} is outside the room: ignored`);
  const S_ = spk.filter(inside), M_ = mics.filter(inside), P_ = panels.filter(inside);
  if (!S_.length || !M_.length) return emptyScene('put at least one speaker and one microphone inside the room');
  // surfaces: 0 x=0, 1 x=L, 2 y=0, 3 y=L, 4 floor, 5 ceiling
  const area = [L[1] * L[2], L[1] * L[2], L[0] * L[2], L[0] * L[2], L[0] * L[1], L[0] * L[1]];
  const aw = surfAlpha[str(room.v.walls, 'plaster')] ?? 0.05, af = surfAlpha[str(room.v.floor, 'carpet')] ?? 0.3, ac = surfAlpha[str(room.v.ceil, 'plaster')] ?? 0.05;
  const A = [aw * area[0], aw * area[1], aw * area[2], aw * area[3], af * area[4], ac * area[5]]; // absorption m² sabine
  // each panel adds (α_panel − α_wall)·area to the wall nearest to it; audience/seats add to the floor
  for (const q of P_) {
    const [x, y] = plan(q), d = [x, L[0] - x, y, L[1] - y], w = d.indexOf(Math.min(...d));
    const add = Math.min(n(q.v.area, 2), area[w]) * (n(q.v.alpha, 0.8) - aw);
    A[w] = Math.max(0, A[w] + add);
  }
  const alpha = A.map((a, i) => Math.min(0.999, a / area[i]));
  const V = L[0] * L[1] * L[2], S = area.reduce((a, b) => a + b, 0), Atot = A.reduce((a, b) => a + b, 0), am = Atot / S;
  const uniform = alpha.every((a) => Math.abs(a - alpha[0]) < 1e-9);
  const k60 = 24 * Math.LN10, sab = (k60 * V) / (c * Atot), eyr = (k60 * V) / (-c * S * Math.log(1 - am));
  // ray tracing (Lambert scattering), energy per speaker = its sound power for 1 s; receivers are spheres
  const nb = Math.max(10, Math.floor(s.steps)), dt = s.dt, tMax = nb * dt;
  const nR = Math.max(10, Math.round(n(p.rays, 3000))), rr = Math.max(0.05, n(p.rr, 0.3)), Vs = (4 / 3) * Math.PI * rr ** 3;
  const rand = rng(11);
  const micP = M_.map((m) => [...plan(m), n(m.v.h, 1.2)]);
  const W = S_.map((q) => 1e-12 * 10 ** (n(q.v.Lw, 90) / 10)); // sound power, W
  const w = M_.map(() => new Float64Array(nb + 2)); // energy density per bin (J/m³ per joule-second emitted)
  const direct = M_.map(() => 0);
  let absorbed = 0, inFlight = 0, emitted = 0, cut = 0, pathN = 0, pathS = 0, pathS2 = 0;
  const paths: { t: number; x: number; y: number }[][][] = S_.map(() => []);
  const unit = () => { const u = 2 * rand() - 1, ph = 2 * Math.PI * rand(), sn = Math.sqrt(1 - u * u); return [sn * Math.cos(ph), sn * Math.sin(ph), u]; };
  S_.forEach((q, si) => {
    const src = [...plan(q), n(q.v.h, 1.5)];
    for (let k = 0; k < nR; k++) {
      const x = src.slice();
      let d = unit(), t = 0, e = W[si] / nR, order = 0;
      emitted += e;
      const path = k < 5 ? [{ t: 0, x: x[0], y: x[1] }] : null;
      while (t < tMax && e > 1e-14 * W[si] / nR) {
        let sMin = Infinity, ax = 0;
        for (let a = 0; a < 3; a++) {
          if (d[a] === 0) continue;
          const sd = ((d[a] > 0 ? L[a] : 0) - x[a]) / d[a];
          if (sd < sMin) { sMin = sd; ax = a; }
        }
        if (t > 0) { pathN++; pathS += sMin; pathS2 += sMin * sMin; }
        // energy crossing each microphone sphere along this segment
        micP.forEach((m, mi) => {
          const rx = m[0] - x[0], ry = m[1] - x[1], rz = m[2] - x[2], tc = rx * d[0] + ry * d[1] + rz * d[2];
          const dd = rx * rx + ry * ry + rz * rz - tc * tc;
          if (dd >= rr * rr) return;
          const h = Math.sqrt(rr * rr - dd), s0 = Math.max(0, tc - h), s1 = Math.min(sMin, tc + h);
          if (s1 <= s0) return;
          const tm = t + (s0 + s1) / 2 / c, b = Math.floor(tm / dt);
          const de = (e * (s1 - s0)) / (c * Vs);
          if (b <= nb) w[mi][b] += de / dt;
          if (order === 0) direct[mi] += de;
        });
        const tEnd = t + sMin / c;
        if (tEnd > tMax) { inFlight += e; for (let a = 0; a < 3; a++) x[a] += d[a] * (tMax - t) * c; t = tMax; break; }
        for (let a = 0; a < 3; a++) x[a] += d[a] * sMin;
        t = tEnd;
        const wall = ax * 2 + (d[ax] > 0 ? 1 : 0), aW = ax === 2 ? (d[2] > 0 ? alpha[5] : alpha[4]) : alpha[wall];
        absorbed += e * aW; e *= 1 - aW; order++;
        const nIn = d[ax] > 0 ? -1 : 1, u1 = rand(), u2 = rand(), ct = Math.sqrt(u1), st = Math.sqrt(1 - u1), ph = 2 * Math.PI * u2;
        const o = [0, 1, 2].filter((z) => z !== ax);
        d = [0, 0, 0]; d[ax] = nIn * ct; d[o[0]] = Math.cos(ph) * st; d[o[1]] = Math.sin(ph) * st;
        if (path && path.length < 120) path.push({ t, x: x[0], y: x[1] });
      }
      if (t < tMax) cut += e; // ray dropped below the threshold: its tiny remainder is booked as cut-off
      if (path) paths[si].push(path);
    }
  });
  // steady state: energy density = power × ∫ impulse response; SPL from p² = w ρ c²
  const lvl = (wd: number) => 10 * Math.log10(Math.max(1e-30, (wd * RHO * c * c) / (P0 * P0)));
  const wss = w.map((arr) => arr.reduce((a, b) => a + b * dt, 0));
  const Lp = wss.map(lvl);
  // Hopkins–Stryker: direct field Σ W/(4πr²c) + reverberant 4W/(cR), R = Sᾱ/(1−ᾱ)
  const R = (S * am) / (1 - am);
  const hs = micP.map((m) => S_.reduce((acc, q, si) => { const sp = [...plan(q), n(q.v.h, 1.5)]; const r = Math.hypot(m[0] - sp[0], m[1] - sp[1], m[2] - sp[2]); return acc + W[si] / (4 * Math.PI * r * r * c) + (4 * W[si]) / (c * R); }, 0));
  const dirTh = micP.map((m) => S_.reduce((acc, q, si) => { const sp = [...plan(q), n(q.v.h, 1.5)]; const r = Math.hypot(m[0] - sp[0], m[1] - sp[1], m[2] - sp[2]); return acc + W[si] / (4 * Math.PI * r * r * c); }, 0));
  // decay curves (Schroeder backward integration of the first microphone's response)
  const cols = ['t', ...M_.map((m) => `${m.name} level (dB)`), ...M_.map((m) => `${m.name} decay (dB)`), 'Sabine decay (dB)', 'Eyring decay (dB)'];
  const sch = w.map((arr) => { const out = new Float64Array(nb + 1); let acc = 0; for (let b = nb; b >= 0; b--) { acc += arr[b] * dt; out[b] = acc; } return out; });
  const rows = [...Array(nb + 1).keys()].map((b) => [b * dt, ...w.map((arr) => lvl(arr[b] * 1 + 1e-40)), ...sch.map((q) => 10 * Math.log10(Math.max(q[b] / q[0], 1e-30))), (-60 * b * dt) / sab, (-60 * b * dt) / eyr]);
  const t30 = (mi: number) => {
    const j = 1 + M_.length + mi, pts = rows.filter((r) => r[j] <= -5 && r[j] >= -35);
    if (pts.length < 4) return NaN;
    const N = pts.length, mx = pts.reduce((a, r) => a + r[0], 0) / N, my = pts.reduce((a, r) => a + r[j], 0) / N;
    return -60 / (pts.reduce((a, r) => a + (r[0] - mx) * (r[j] - my), 0) / pts.reduce((a, r) => a + (r[0] - mx) ** 2, 0));
  };
  const rts = M_.map((_, i) => t30(i));
  const mfp = pathN ? pathS / pathN : (4 * V) / S, gam2 = pathN ? (pathS2 / pathN - mfp * mfp) / (mfp * mfp) : 0, la = Math.log(1 - am);
  const kut = (k60 * V) / (-c * S * la * (1 + 0.5 * gam2 * la));
  // room modes and the modal response from the first speaker to the first microphone
  const fmax = n(p.fmax, 150), modes: { f: number; nn: number[]; type: number }[] = [];
  const nmax = L.map((l) => Math.ceil((2 * fmax * l) / c));
  for (let i = 0; i <= nmax[0]; i++) for (let j = 0; j <= nmax[1]; j++) for (let k = 0; k <= nmax[2]; k++) {
    if (!i && !j && !k) continue;
    const f = (c / 2) * Math.hypot(i / L[0], j / L[1], k / L[2]);
    if (f <= fmax) modes.push({ f, nn: [i, j, k], type: [i, j, k].filter((q) => q > 0).length });
  }
  modes.sort((a, b) => a.f - b.f);
  const s0 = [...plan(S_[0]), n(S_[0].v.h, 1.5)], r0 = micP[0], del = 6.91 / sab;
  const psi = (nn: number[], q: number[]) => nn.reduce((a, ni, ax) => a * Math.cos((ni * Math.PI * q[ax]) / L[ax]), 1);
  const fr = [...Array(300).keys()].map((k) => 20 + ((fmax - 20) * k) / 299);
  const H = fr.map((f) => { const om = 2 * Math.PI * f; let h: C = [0, 0]; for (const md of modes) { const wn = 2 * Math.PI * md.f; h = cadd(h, cdiv([psi(md.nn, s0) * psi(md.nn, r0), 0], [wn * wn - om * om, 2 * del * om])); } return 20 * Math.log10(Math.max(cabs(h), 1e-30)); });
  const Hm = maxOf(H);
  const checks: Check[] = [
    { l: 'energy: emitted = absorbed + in flight + cut-off', exp: emitted, act: absorbed + inFlight + cut, u: 'J', tol: 1e-9 },
    ...M_.map((m, i) => ({ l: `${m.name}: ray-traced T30 vs Kuttruff`, exp: kut, act: rts[i], u: 's', tol: 0.06, ref: !uniform })),
    ...M_.map((m, i) => ({ l: `${m.name}: direct sound vs Σ W/(4πr²c)`, exp: dirTh[i], act: direct[i], u: 'J/m³', tol: 0.15, ref: true })),
    ...M_.map((m, i) => ({ l: `${m.name}: level vs Hopkins–Stryker`, exp: lvl(hs[i]), act: Lp[i], u: 'dB', abs: 1.5, ref: true })),
    { l: 'lowest axial mode c/2L', exp: c / (2 * maxOf(L)), act: modes[0]?.f ?? NaN, u: 'Hz' },
  ];
  if (!uniform) notes.push('surfaces absorb differently (panels or materials), so Kuttruff/Eyring with the mean α is only a reference');
  notes.push(`plan view · ${nR} rays per speaker, Lambert scattering · microphones are ${rr} m spheres · a panel adds its absorption to the wall nearest to it`);
  return {
    cols, rows, checks, notes,
    scalars: [
      ...M_.map((m, i) => ({ l: `${m.name}: sound level`, v: Lp[i], u: 'dB' })), ...M_.map((m, i) => ({ l: `${m.name}: RT60 (T30)`, v: rts[i], u: 's' })),
      { l: 'RT60 Sabine', v: sab, u: 's' }, { l: 'RT60 Eyring', v: eyr, u: 's' }, { l: 'RT60 Kuttruff', v: kut, u: 's' },
      { l: 'total absorption', v: Atot, u: 'm² sabine' }, { l: 'mean absorption ᾱ', v: am }, { l: 'speed of sound', v: c, u: 'm/s' },
      { l: 'volume', v: V, u: 'm3' }, { l: 'Schroeder frequency', v: 2000 * Math.sqrt(sab / V), u: 'Hz' }, { l: `modes below ${fmax} Hz`, v: modes.length },
    ],
    charts: [
      tchart(cols, rows, 'decay', 'decay at each microphone (Schroeder)', [...M_.map((m) => `${m.name} decay (dB)`), 'Sabine decay (dB)', 'Eyring decay (dB)'], 'dB'),
      tchart(cols, rows, 'etc', 'energy arriving at each microphone', M_.map((m) => `${m.name} level (dB)`), 'dB'),
      { id: 'fr', title: `modal response ${S_[0].name} → ${M_[0].name}`, xl: 'f (Hz)', yl: 'dB', series: [{ name: '|H|', x: fr, y: H.map((h) => h - Hm) }] },
      { id: 'modes', title: 'room modes (1 axial, 2 tangential, 3 oblique)', xl: 'f (Hz)', yl: 'type', bars: true, series: [{ name: 'mode', x: modes.map((q) => q.f), y: modes.map((q) => q.type) }] },
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)], tNow = rw[0];
      G.view(-0.5, L[0] + 0.5, -0.5, L[1] + 0.5);
      const wallCol = (a: number) => `rgb(${Math.round(200 - 150 * a)},${Math.round(200 - 60 * a)},${Math.round(210 - 40 * a)})`;
      G.line(0, 0, 0, L[1], wallCol(alpha[0]), 3); G.line(L[0], 0, L[0], L[1], wallCol(alpha[1]), 3);
      G.line(0, 0, L[0], 0, wallCol(alpha[2]), 3); G.line(0, L[1], L[0], L[1], wallCol(alpha[3]), 3);
      paths.forEach((ps, si) => ps.forEach((pp) => { const q = pp.filter((z) => z.t <= tNow); if (q.length) G.path(q.map((z) => z.x), q.map((z) => z.y), si ? COL.e : COL.a); }));
      for (const q of P_) { const [x, y] = plan(q); spriteC(G, q.sprite, x, y, 2); }
      S_.forEach((q) => { const [x, y] = plan(q); spriteC(G, q.sprite, x, y, 2); label(G, q.name, x, y, COL.f); });
      M_.forEach((m, i) => { const [x, y] = plan(m); G.circle(x, y, rr, COL.c, false); spriteC(G, m.sprite, x, y, 2); label(G, `${m.name} ${Lp[i].toFixed(1)} dB`, x, y, COL.c, 16); });
      G.hud([`plan view  t=${tNow.toFixed(3)} s   ${S_.length} speaker${S_.length > 1 ? 's' : ''} · ${M_.length} mic${M_.length > 1 ? 's' : ''} · ${P_.length} panel${P_.length === 1 ? '' : 's'}`, `RT60 Sabine ${sab.toFixed(2)} s · traced ${rts[0].toFixed(2)} s · ᾱ ${am.toFixed(3)}`]);
    },
  };
}

export const acousticsScene: Catalog = {
  env: [], engine: 'scene', run,
  desc: 'a room, speakers, microphones and absorber panels in one floor plan: ray-traced reverberation, levels, room modes',
  settings: { dt: 0.002, steps: 1500, method: 'rk4' }, timeBased: true,
  envDefs: [{ k: 'T', l: 'air temperature', u: 'C', v: 20, s: 1, d: 'Sets the speed of sound c = 331.3·√(1 + T/273.15).' }],
  globals: [
    { k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.25, min: 0.01, s: 0.05, d: 'Size of one editor grid cell in the floor plan.' },
    { k: 'rays', l: 'rays per speaker', v: 3000, min: 10, max: 50000, s: 500, d: 'More rays = smoother decay curves, slower run.' },
    { k: 'rr', l: 'microphone sphere radius', u: 'm', v: 0.3, min: 0.05, s: 0.05, d: 'Rays passing through this sphere count as heard.' },
    { k: 'fmax', l: 'max mode frequency', u: 'Hz', v: 150, min: 10, s: 10, d: 'Room modes are listed up to this frequency.' },
  ],
  where: 'floor plan: the room is centred where you put it; speakers, microphones and panels must be inside it · a panel absorbs on the wall nearest to it',
  kinds: [
    { kind: 'room', name: 'room', sprite: 'hall', desc: 'the room (its walls, floor and ceiling)', custom: [
      { k: 'Lx', l: 'length', u: 'm', v: 8, min: 0.5, s: 0.5, d: 'Room length (left-right in the plan).' },
      { k: 'Ly', l: 'width', u: 'm', v: 6, min: 0.5, s: 0.5, d: 'Room width (up-down in the plan).' },
      { k: 'Lz', l: 'height', u: 'm', v: 3, min: 0.5, s: 0.25, d: 'Ceiling height.' },
      { k: 'walls', l: 'walls', v: 'plaster', o: MATS, d: 'Wall finish: sets how much sound each bounce absorbs.' },
      { k: 'floor', l: 'floor', v: 'carpet', o: MATS, d: 'Floor finish.' },
      { k: 'ceil', l: 'ceiling', v: 'plaster', o: MATS, d: 'Ceiling finish.' },
    ] },
    { kind: 'spk', name: 'loudspeaker', sprite: 'speaker', desc: 'a sound source', custom: [
      { k: 'Lw', l: 'sound power level', u: 'dB', v: 90, s: 3, d: 'Acoustic power: 90 dB ≈ a loud voice, 110 dB ≈ a PA speaker.' },
      { k: 'h', l: 'height above floor', u: 'm', v: 1.5, min: 0, s: 0.1, d: 'How high it is mounted.' },
    ] },
    { kind: 'mic', name: 'microphone', sprite: 'mic', desc: 'a listening position', custom: [
      { k: 'h', l: 'height above floor', u: 'm', v: 1.2, min: 0, s: 0.1, d: 'Ear height (seated ≈ 1.2 m).' },
    ] },
    { kind: 'panel', name: 'absorber panel', sprite: 'foam', desc: 'acoustic panel on the nearest wall', custom: [
      { k: 'area', l: 'panel area', u: 'm2', v: 4, min: 0, s: 0.5, d: 'Face area of the panel.' },
      { k: 'alpha', l: 'panel absorption α', v: 0.8, min: 0, max: 1, s: 0.05, d: 'Fraction of sound energy it absorbs per hit (foam ≈ 0.8, curtain ≈ 0.5).' },
    ] },
  ],
  presets: [
    { name: 'concert hall', kind: 'room', sprite: 'hall', desc: '40×25×15 m', v: { Lx: 40, Ly: 25, Lz: 15, walls: 'wood panelling', floor: 'carpet', ceil: 'plaster' } },
    { name: 'bathroom', kind: 'room', sprite: 'bathroom', desc: 'hard tiles everywhere', v: { Lx: 3, Ly: 2, Lz: 2.5, walls: 'painted concrete', floor: 'painted concrete', ceil: 'painted concrete' } },
    { name: 'recording studio', kind: 'room', sprite: 'studio', desc: 'foam walls', v: { Lx: 6, Ly: 5, Lz: 3, walls: 'acoustic foam', floor: 'carpet', ceil: 'acoustic foam' } },
    { name: 'PA speaker', kind: 'spk', sprite: 'speaker', desc: '110 dB', v: { Lw: 110, h: 2 } },
    { name: 'thick curtain', kind: 'panel', sprite: 'curtain', desc: '6 m², α 0.5', v: { area: 6, alpha: 0.5 } },
  ],
  start: [['room', 32, 18], ['spk', 22, 16], ['mic', 42, 20]],
  tests: [
    { name: 'plaster box (T30 vs Kuttruff, pass/fail)', list: [['room', 32, 18, { walls: 'plaster', floor: 'plaster', ceil: 'plaster' }], ['spk', 22, 16], ['mic', 42, 20]] },
    { name: 'bathroom with speaker & mic', list: [['bathroom', 32, 18], ['spk', 28, 17], ['mic', 36, 19]] },
    { name: 'two speakers, two mics, foam panels', list: [['room', 32, 18], ['spk', 22, 16], ['spk', 24, 22], ['mic', 42, 20], ['mic', 36, 12], ['panel', 47, 18], ['panel', 32, 7]] },
  ],
  guide(g, X, Y, cp, p, ents) {
    const r = ents.find((e) => e.k === 'room');
    if (!r) return;
    const sc = n(p.ws_scale, 0.25), lx = n(p[`e${r.id}_Lx`], 8) / sc, ly = n(p[`e${r.id}_Ly`], 6) / sc;
    g.strokeStyle = '#c9d1d9'; g.lineWidth = 3; g.strokeRect(X(r.x - lx / 2), Y(r.y - ly / 2), lx * cp, ly * cp); g.lineWidth = 1;
  },
};
