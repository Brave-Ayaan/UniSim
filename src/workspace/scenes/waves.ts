// Waves, one room of air: every sound source radiates into the same 2D field, so their waves overlap and
// interfere; walls reflect them and slits in a wall diffract them; a source moving sideways is Doppler shifted;
// microphones record what arrives where they stand. Solved as the 2D wave equation on a grid (leapfrog),
// with open (absorbing) edges.
import type { Catalog } from '../catalog';
import { n, emptyScene, tchart, label, COL, SCENE_W, SCENE_H, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const RES = 2; // grid points per editor cell

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.05), Tair = n(p.Tair, 20), c = 331.3 * Math.sqrt(1 + Tair / 273.15);
  const srcE = ents.filter((e) => e.kind === 'src'), mics = ents.filter((e) => e.kind === 'mic'), walls = ents.filter((e) => e.kind === 'wall');
  if (!srcE.length) return emptyScene('silence: press E and add a sound source');
  const NX = SCENE_W * RES, NY = SCENE_H * RES, dx = scale / RES;
  const dt = Math.min(s.dt, (0.5 * dx) / c), steps = s.steps, C2 = ((c * dt) / dx) ** 2;
  const wall = new Uint8Array(NX * NY);
  const id = (i: number, j: number) => i + NX * j;
  for (const w of walls) {
    // a vertical wall through its spot, with optional slits cut symmetrically about its middle
    const i = Math.round(w.x * RES), L = n(w.v.len, 1.2) / dx, ns = Math.round(n(w.v.slits, 0)), sw = n(w.v.sw, 0.05) / dx, sd = n(w.v.sd, 0.2) / dx, jc = w.y * RES;
    for (let j = Math.round(jc - L / 2); j <= Math.round(jc + L / 2); j++) {
      if (j < 0 || j >= NY || i < 0 || i >= NX) continue;
      const off = j - jc, centres = ns === 1 ? [0] : ns === 2 ? [-sd / 2, sd / 2] : [];
      if (centres.some((cc) => Math.abs(off - cc) <= sw / 2)) continue;
      wall[id(i, j)] = 1; if (i + 1 < NX) wall[id(i + 1, j)] = 1;
    }
  }
  const S = srcE.map((e) => ({ e, f: n(e.v.f, 1000), A: n(e.v.A, 1), ph: (n(e.v.ph, 0) * Math.PI) / 180, vs: n(e.v.vs, 0), x0: e.x * scale, j: Math.round(e.y * RES) }));
  const clampI = (i: number) => Math.min(NX - 1, Math.max(0, i)), clampJ = (j: number) => Math.min(NY - 1, Math.max(0, j));
  const Mi = mics.map((e) => ({ e, i: clampI(Math.round(e.x * RES)), j: clampJ(Math.round(e.y * RES)) }));
  let p0 = new Float64Array(NX * NY), p1 = new Float64Array(NX * NY), p2 = new Float64Array(NX * NY);
  const frames: Float32Array[] = [], ev = Math.max(1, Math.ceil(steps / 200)), evRow = Math.max(1, Math.ceil(steps / 2000));
  const cols = ['t', ...Mi.map((m) => `${m.e.name} pressure (Pa)`), ...S.filter((q) => q.vs).map((q) => `${q.e.name} x (m)`)];
  const rows: number[][] = [], micAll: number[][] = Mi.map(() => []), tAll: number[] = [];
  const kc = (c * dt - dx) / (c * dt + dx); // first-order Mur absorbing edge
  const rowAt = (t: number) => [t, ...Mi.map((m) => p1[id(m.i, m.j)]), ...S.filter((q) => q.vs).map((q) => q.x0 + q.vs * t)];
  for (let k = 0; k <= steps; k++) {
    const t = k * dt;
    if (k % ev === 0) frames.push(Float32Array.from(p1));
    Mi.forEach((m, mi) => micAll[mi].push(p1[id(m.i, m.j)]));
    tAll.push(t);
    if (k % evRow === 0 || k === steps) rows.push(rowAt(t));
    if (k === steps) break;
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const q = id(i, j);
      if (wall[q]) { p2[q] = 0; continue; }
      const pc = p1[q], L = (wall[q - 1] ? pc : p1[q - 1]) + (wall[q + 1] ? pc : p1[q + 1]) + (wall[q - NX] ? pc : p1[q - NX]) + (wall[q + NX] ? pc : p1[q + NX]) - 4 * pc;
      p2[q] = 2 * pc - p0[q] + C2 * L;
    }
    // sources: a smoothly switched-on sine, spread bilinearly onto the grid where the source is now
    for (const q of S) {
      const x = (q.x0 + q.vs * (t + dt)) / dx, i = Math.floor(x), j = q.j, fx = x - i;
      const ramp = Math.min(1, (t + dt) * q.f / 2), val = q.A * ramp * Math.sin(2 * Math.PI * q.f * (t + dt) + q.ph) * C2;
      if (i >= 1 && i < NX - 2 && j >= 1 && j < NY - 1) { p2[id(i, j)] += val * (1 - fx); p2[id(i + 1, j)] += val * fx; }
    }
    for (let i = 0; i < NX; i++) { p2[id(i, 0)] = p1[id(i, 1)] + kc * (p2[id(i, 1)] - p1[id(i, 0)]); p2[id(i, NY - 1)] = p1[id(i, NY - 2)] + kc * (p2[id(i, NY - 2)] - p1[id(i, NY - 1)]); }
    for (let j = 0; j < NY; j++) { p2[id(0, j)] = p1[id(1, j)] + kc * (p2[id(1, j)] - p1[id(0, j)]); p2[id(NX - 1, j)] = p1[id(NX - 2, j)] + kc * (p2[id(NX - 2, j)] - p1[id(NX - 1, j)]); }
    [p0, p1, p2] = [p1, p2, p0];
  }
  // what each microphone hears: dominant frequency (zero crossings over the second half) and level
  const heard = Mi.map((_, mi) => {
    const sig = micAll[mi], h = Math.floor(sig.length / 2), tail = sig.slice(h), tt = tAll.slice(h);
    const cr: number[] = [];
    for (let k = 1; k < tail.length; k++) if (tail[k - 1] < 0 && tail[k] >= 0) cr.push(tt[k - 1] + ((tt[k] - tt[k - 1]) * -tail[k - 1]) / (tail[k] - tail[k - 1]));
    const f = cr.length > 2 ? (cr.length - 1) / (cr[cr.length - 1] - cr[0]) : NaN, rms = Math.sqrt(tail.reduce((a, v) => a + v * v, 0) / Math.max(1, tail.length));
    return { f, rms, arrive: tAll[sig.findIndex((v) => Math.abs(v) > 1e-3 * Math.max(1e-30, ...sig.map(Math.abs)))] };
  });
  const checks: Check[] = [{ l: 'grid stable: Courant number c·dt/dx ≤ 1/√2', exp: 0, act: Math.max(0, (c * dt) / dx - 1 / Math.SQRT2), abs: 1e-12 }];
  if (S.length === 1) Mi.forEach((m, mi) => {
    const q = S[0], h = heard[mi];
    if (!Number.isFinite(h.f)) return;
    if (q.vs === 0) checks.push({ l: `${m.e.name}: hears the source frequency`, exp: q.f, act: h.f, u: 'Hz', tol: 0.01 });
    else {
      // Doppler: approaching f c/(c − v), receding f c/(c + v) (sideways geometry ignored)
      const toward = Math.sign((m.i * dx) - q.x0) === Math.sign(q.vs);
      checks.push({ l: `${m.e.name}: Doppler shift f·c/(c ${toward ? '−' : '+'} v)`, exp: (q.f * c) / (c - (toward ? 1 : -1) * Math.abs(q.vs)), act: h.f, u: 'Hz', tol: 0.03, ref: true });
    }
    const d = Math.hypot(m.i * dx - q.x0, (m.j - q.j) * dx);
    checks.push({ l: `${m.e.name}: first sound arrives after distance / c`, exp: d / c, act: h.arrive, u: 's', tol: 0.15, ref: true });
  });
  const vmax = Math.max(1e-30, ...frames.slice(Math.floor(frames.length / 2)).flatMap((f) => { let m = 0; for (let k = 0; k < f.length; k += 7) m = Math.max(m, Math.abs(f[k])); return [m]; }));
  let off: HTMLCanvasElement | null = null, img: ImageData | null = null;
  return {
    cols, rows, checks,
    notes: [`speed of sound ${c.toFixed(1)} m/s at ${Tair} °C · grid ${NX}×${NY}, ${(dx * 1000).toFixed(1)} mm spacing, dt ${(dt * 1e6).toFixed(2)} µs · walls reflect, slits diffract, edges are open`],
    scalars: [{ l: 'speed of sound', v: c, u: 'm/s' }, ...S.map((q) => ({ l: `${q.e.name}: wavelength`, v: c / q.f, u: 'm' })), ...Mi.flatMap((m, mi) => [{ l: `${m.e.name}: hears`, v: heard[mi].f, u: 'Hz' }, { l: `${m.e.name}: level`, v: 20 * Math.log10(Math.max(1e-30, heard[mi].rms) / 2e-5), u: 'dB (rel.)' }])],
    charts: [tchart(cols, rows, 'mic', 'microphones', Mi.map((m) => `${m.e.name} pressure (Pa)`), 'Pa')],
    draw(G: Gfx, k: number) {
      const fi = Math.min(frames.length - 1, Math.round((k / Math.max(1, rows.length - 1)) * (frames.length - 1))), f = frames[fi];
      G.view(0, SCENE_W, 0, SCENE_H, 14);
      if (typeof document !== 'undefined') {
        off ??= document.createElement('canvas'); off.width = NX; off.height = NY;
        const cx = off.getContext('2d')!; img ??= cx.createImageData(NX, NY);
        for (let q = 0; q < NX * NY; q++) {
          const v = Math.max(-1, Math.min(1, f[q] / vmax)), o = 4 * q;
          if (wall[q]) { img.data[o] = 200; img.data[o + 1] = 200; img.data[o + 2] = 200; }
          else { img.data[o] = v > 0 ? 40 + 215 * v : 40; img.data[o + 1] = 40 + 60 * Math.abs(v); img.data[o + 2] = v < 0 ? 40 - 215 * v : 40; }
          img.data[o + 3] = 255;
        }
        cx.putImageData(img, 0, 0);
        // row 0 of the grid is the top of the scene
        G.ctx.imageSmoothingEnabled = false;
        G.ctx.drawImage(off, G.X(0), G.Y(SCENE_H), G.X(SCENE_W) - G.X(0), G.Y(0) - G.Y(SCENE_H));
      }
      const t = frames.length > 1 ? (fi * ev) * dt : 0;
      S.forEach((q) => { const x = q.x0 / scale + (q.vs * t) / scale, y = SCENE_H - q.j / RES; G.circle(x, y, 4, COL.f, true, true); label(G, `${q.e.name} ${q.f} Hz`, x, y, COL.f, -8); });
      Mi.forEach((m, mi) => { G.circle(m.e.x, SCENE_H - m.e.y, 4, COL.c, false, true); label(G, `${m.e.name} ${Number.isFinite(heard[mi].f) ? heard[mi].f.toFixed(0) + ' Hz' : ''}`, m.e.x, SCENE_H - m.e.y, COL.c, -8); });
      G.hud([`t=${(t * 1000).toFixed(2)} ms  ${S.length} source${S.length > 1 ? 's' : ''} · ${walls.length} wall${walls.length === 1 ? '' : 's'} · ${Mi.length} mic${Mi.length === 1 ? '' : 's'} · c = ${c.toFixed(1)} m/s`, 'red = pressure up, blue = down']);
    },
  };
}

export const wavesScene: Catalog = {
  env: [], engine: 'scene', run,
  desc: 'sound sources, walls with slits and microphones sharing one patch of air: interference, diffraction, Doppler',
  settings: { dt: 1e-4, steps: 1200, method: 'rk4' }, timeBased: true,
  envDefs: [{ k: 'Tair', l: 'air temperature', u: '°C', v: 20, s: 1, d: 'Sets the speed of sound c = 331.3√(1 + T/273.15).' }],
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.05, min: 1e-4, s: 0.01, d: 'Size of one editor grid cell (the field has 2 grid points per cell).' }],
  where: 'sources sound from where you put them · walls stand upright through their spot · microphones listen where they stand',
  kinds: [
    { kind: 'src', name: 'sound source', sprite: 'speaker', desc: 'a loudspeaker playing a steady tone', aim: { kind: 'len', field: 'vs', per: 5 }, custom: [
      { k: 'f', l: 'frequency', u: 'Hz', v: 1000, min: 1, s: 50, d: 'Pitch: wavelength = c / f.' },
      { k: 'A', l: 'strength', u: 'Pa', v: 1, s: 0.1, d: 'Source amplitude.' },
      { k: 'ph', l: 'phase', u: 'deg', v: 0, s: 15, d: 'Start of its cycle: two sources 180° apart cancel along the middle.' },
      { k: 'vs', l: 'moving at (→ +)', u: 'm/s', v: 0, s: 5, d: 'A moving source is Doppler shifted. Drag sideways in EDIT.' },
    ] },
    { kind: 'wall', name: 'wall', sprite: 'brick', desc: 'an upright reflecting wall, with optional slits', custom: [
      { k: 'len', l: 'length', u: 'm', v: 1.2, min: 0, s: 0.1, d: 'How tall the wall is.' },
      { k: 'slits', l: 'slits', v: '0', o: ['0', '1', '2'], d: 'Openings in the middle: one slit diffracts, two interfere.' },
      { k: 'sw', l: 'slit width', u: 'm', v: 0.05, min: 0, s: 0.01, d: 'Width of each opening.' },
      { k: 'sd', l: 'slit spacing', u: 'm', v: 0.25, min: 0, s: 0.05, d: 'Centre-to-centre distance of two slits.' },
    ] },
    { kind: 'mic', name: 'microphone', sprite: 'mic', desc: 'records the pressure where it stands', custom: [] },
  ],
  presets: [
    { name: 'tuning fork (A4)', kind: 'src', sprite: 'speaker', desc: '440 Hz', v: { f: 440, A: 1 } },
    { name: 'ambulance siren', kind: 'src', sprite: 'siren', desc: '700 Hz driving at 25 m/s', v: { f: 700, A: 1, vs: 25 } },
    { name: 'whistle', kind: 'src', sprite: 'speaker', desc: '2 kHz', v: { f: 2000, A: 1 } },
    { name: 'double slit', kind: 'wall', sprite: 'brick', desc: 'two 5 cm slits 25 cm apart', v: { len: 1.8, slits: '2', sw: 0.05, sd: 0.25 } },
  ],
  start: [['src', 8, 12], ['src', 8, 24, { ph: 0 }], ['double slit', 30, 18], ['mic', 50, 18], ['mic', 50, 8]],
  tests: [
    { name: 'one tone, one mic', list: [['src', 16, 18], ['mic', 40, 18]] },
    { name: 'moving siren', list: [['ambulance siren', 10, 18], ['mic', 50, 18], ['mic', 2, 18]], s: { steps: 1500 } },
  ],
  guide(g, X, Y, cp, p, ents) {
    g.fillStyle = '#6e7681';
    for (const e of ents.filter((q) => q.k === 'wall')) { const L = n(p[`e${e.id}_len`], 1.2) / n(p.ws_scale, 0.05); g.fillRect(X(e.x) - 1, Y(e.y - L / 2), 3, L * cp); }
  },
};
