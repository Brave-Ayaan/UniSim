import type { SimModule } from '../core/types';
import { rng, cadd, cdiv, cabs, type C, maxOf } from '../core/num';
import { chart, num } from '../core/build';
import { COL, PALETTE } from '../core/gfx';

/** shoebox room: statistical ray tracing decay vs Sabine/Eyring, modal density, modal frequency response */
export const acoustics: SimModule = {
  id: 'acoustics',
  name: 'Room acoustics',
  desc: 'reverberation (ray-traced decay vs Sabine/Eyring), room modes, Schroeder frequency, modal frequency response',
  timeBased: true,
  settings: { dt: 0.002, steps: 1500, method: 'rk4' },
  params: [
    { k: 'Lx', l: 'length', u: 'm', v: 8, min: 0.1, s: 0.5 },
    { k: 'Ly', l: 'width', u: 'm', v: 6, min: 0.1, s: 0.5 },
    { k: 'Lz', l: 'height', u: 'm', v: 3, min: 0.1, s: 0.25 },
    { k: 'alpha', l: 'mean absorption α', v: 0.2, min: 1e-4, max: 0.99, s: 0.02 },
    { k: 'T', l: 'air temperature', u: 'C', v: 20, s: 1 },
    { k: 'rays', l: 'rays traced', v: 4000, min: 10, max: 50000, s: 1000 },
    { k: 'scatter', l: 'scattering coeff', v: 1, min: 0, max: 1, s: 0.1 },
    { k: 'fmax', l: 'max mode frequency', u: 'Hz', v: 150, min: 10, s: 10 },
    { k: 'sx', l: 'source position', u: 'x/L', v: 0.1, min: 0, max: 1, s: 0.05 },
    { k: 'rx', l: 'receiver position', u: 'x/L', v: 0.7, min: 0, max: 1, s: 0.05 },
  ],
  run(p, s) {
    const L = [num(p, 'Lx'), num(p, 'Ly'), num(p, 'Lz')], a = num(p, 'alpha');
    const c = 331.3 * Math.sqrt(1 + num(p, 'T') / 273.15);
    const V = L[0] * L[1] * L[2], S = 2 * (L[0] * L[1] + L[1] * L[2] + L[0] * L[2]);
    const k60 = 24 * Math.LN10;
    const sab = (k60 * V) / (c * S * a), eyr = (k60 * V) / (-c * S * Math.log(1 - a));
    // ray tracing: each wall hit multiplies energy by (1-α); with probability `scatter` the ray leaves
    // in a Lambert (cosine) direction, otherwise it reflects specularly. Energy is binned over time.
    const nR = Math.round(num(p, 'rays')), rand = rng(11), scat = num(p, 'scatter');
    const nb = Math.max(10, Math.floor(s.steps)), dt = s.dt, tMax = nb * dt;
    const dE = new Float64Array(nb + 2);
    const src = [num(p, 'sx') * L[0], 0.4 * L[1], 0.5 * L[2]];
    const paths: { t: number; x: number; y: number }[][] = [];
    // free-path statistics between reflections (for Kuttruff's correction to Eyring)
    let pathN = 0, pathS = 0, pathS2 = 0;
    const unit = () => { const u = 2 * rand() - 1, ph = 2 * Math.PI * rand(), sn = Math.sqrt(1 - u * u); return [sn * Math.cos(ph), sn * Math.sin(ph), u]; };
    for (let k = 0; k < nR; k++) {
      const x = src.slice();
      let d = unit(), t = 0, w = 1 / nR;
      const path = k < 6 ? [{ t: 0, x: x[0], y: x[1] }] : null;
      while (t < tMax && w > 1e-12 / nR) {
        let sMin = Infinity, axis = 0;
        for (let ax = 0; ax < 3; ax++) {
          if (d[ax] === 0) continue;
          const sd = ((d[ax] > 0 ? L[ax] : 0) - x[ax]) / d[ax];
          if (sd < sMin) { sMin = sd; axis = ax; }
        }
        const t2 = t + sMin / c;
        if (t > 0) { pathN++; pathS += sMin; pathS2 += sMin * sMin; }
        const b0 = Math.floor(t / dt), b1 = Math.min(nb + 1, Math.floor(t2 / dt));
        if (b0 <= nb) { dE[b0] += w; dE[b1] -= w; }
        for (let ax = 0; ax < 3; ax++) x[ax] += d[ax] * sMin;
        t = t2;
        w *= 1 - a;
        if (rand() < scat) {
          // Lambert reflection about the inward wall normal
          const nIn = d[axis] > 0 ? -1 : 1;
          const u1 = rand(), u2 = rand(), ct = Math.sqrt(u1), st = Math.sqrt(1 - u1), ph = 2 * Math.PI * u2;
          const t1 = [Math.cos(ph) * st, Math.sin(ph) * st];
          const o = [0, 1, 2].filter((q) => q !== axis);
          d = [0, 0, 0];
          d[axis] = nIn * ct; d[o[0]] = t1[0]; d[o[1]] = t1[1];
        } else d[axis] = -d[axis];
        if (path && path.length < 200) path.push({ t, x: x[0], y: x[1] });
      }
      if (path) paths.push(path);
    }
    // Kuttruff: T = 24 ln10 V / (c S [−ln(1−α)] (1 + ½γ² ln(1−α))), γ² = relative variance of free paths
    const mfp = pathN ? pathS / pathN : (4 * V) / S;
    const gam2 = pathN ? (pathS2 / pathN - mfp * mfp) / (mfp * mfp) : 0;
    const la = Math.log(1 - a);
    const kut = (k60 * V) / (-c * S * la * (1 + 0.5 * gam2 * la));
    const E = new Float64Array(nb + 1);
    let acc = 0;
    for (let b = 0; b <= nb; b++) { acc += dE[b]; E[b] = acc; }
    const cols = ['t', 'energy (dB)', 'Sabine decay (dB)', 'Eyring decay (dB)'];
    const rows = [...Array(nb + 1).keys()].map((b) => {
      const t = b * dt;
      return [t, 10 * Math.log10(Math.max(E[b], 1e-30)), (-60 * t) / sab, (-60 * t) / eyr];
    });
    // T30: regression between -5 and -35 dB
    const pts = rows.filter((r) => r[1] <= -5 && r[1] >= -35);
    let rt = NaN;
    if (pts.length > 3) {
      const n = pts.length, mx = pts.reduce((q, r) => q + r[0], 0) / n, my = pts.reduce((q, r) => q + r[1], 0) / n;
      const sl = pts.reduce((q, r) => q + (r[0] - mx) * (r[1] - my), 0) / pts.reduce((q, r) => q + (r[0] - mx) ** 2, 0);
      rt = -60 / sl;
    }
    // room modes
    const fmax = num(p, 'fmax');
    const modes: { f: number; n: number[]; type: number }[] = [];
    const nmax = L.map((l) => Math.ceil((2 * fmax * l) / c));
    for (let i = 0; i <= nmax[0]; i++) for (let j = 0; j <= nmax[1]; j++) for (let k = 0; k <= nmax[2]; k++) {
      if (!i && !j && !k) continue;
      const f = (c / 2) * Math.hypot(i / L[0], j / L[1], k / L[2]);
      if (f <= fmax) modes.push({ f, n: [i, j, k], type: [i, j, k].filter((q) => q > 0).length });
    }
    modes.sort((x, y) => x.f - y.f);
    // modal frequency response between source and receiver (δ from Sabine RT)
    const rcv = [num(p, 'rx') * L[0], 0.6 * L[1], 0.4 * L[2]];
    const del = 6.91 / sab;
    const psi = (n: number[], q: number[]) => n.reduce((acc, ni, ax) => acc * Math.cos((ni * Math.PI * q[ax]) / L[ax]), 1);
    const fr = [...Array(400).keys()].map((k) => 20 + ((fmax - 20) * k) / 399);
    const H = fr.map((f) => {
      const w = 2 * Math.PI * f;
      let h: C = [0, 0];
      for (const md of modes) {
        const wn = 2 * Math.PI * md.f;
        h = cadd(h, cdiv([psi(md.n, src) * psi(md.n, rcv), 0], [wn * wn - w * w, 2 * del * w]));
      }
      return 20 * Math.log10(Math.max(cabs(h), 1e-30));
    });
    const Hmax = maxOf(H);
    // asymptotic mode count N(f) = 4πV f³/(3c³) + πS f²/(4c²) + L' f/(8c)
    const Lp = 4 * (L[0] + L[1] + L[2]);
    const Nweyl = (4 * Math.PI * V * fmax ** 3) / (3 * c ** 3) + (Math.PI * S * fmax ** 2) / (4 * c * c) + (Lp * fmax) / (8 * c);
    return {
      cols, rows,
      notes: ['decay: deterministic seeded rays, energy ×(1-α) per wall hit, Lambert scattering with probability s (s→0: specular, non-diffuse shoebox decays slower than Eyring)', 'Sabine/Eyring constant 24 ln10 / c (no air absorption)'],
      checks: [
        { l: 'ray-traced T30 vs Kuttruff (Eyring + path-length spread)', exp: kut, act: rt, u: 's', tol: 0.05, ref: scat < 0.5 },
        { l: 'mode count vs Weyl asymptotic', exp: Nweyl, act: modes.length, tol: 0.15, ref: true },
        { l: 'lowest axial mode c/2L', exp: c / (2 * maxOf(L)), act: modes[0]?.f ?? NaN, u: 'Hz' },
      ],
      scalars: [
        { l: 'RT60 Kuttruff', v: kut, u: 's' }, { l: 'mean free path (traced)', v: mfp, u: 'm' }, { l: 'path variance γ²', v: gam2 },
        { l: 'speed of sound', v: c, u: 'm/s' }, { l: 'volume', v: V, u: 'm3' }, { l: 'surface', v: S, u: 'm2' }, { l: 'RT60 Sabine', v: sab, u: 's' }, { l: 'RT60 Eyring', v: eyr, u: 's' },
        { l: 'RT60 ray-traced (T30)', v: rt, u: 's' }, { l: 'mean free path 4V/S', v: (4 * V) / S, u: 'm' }, { l: 'Schroeder frequency', v: 2000 * Math.sqrt(sab / V), u: 'Hz' },
        { l: `modes below ${fmax} Hz`, v: modes.length }, { l: 'axial / tangential / oblique', v: modes.filter((q) => q.type === 1).length * 1e4 + modes.filter((q) => q.type === 2).length * 100 + modes.filter((q) => q.type === 3).length, u: 'AA TT OO' },
      ],
      charts: [
        chart(cols, rows, 'decay', 'energy decay curve', 't', ['energy (dB)', 'Sabine decay (dB)', 'Eyring decay (dB)']),
        { id: 'fr', title: 'modal frequency response (src→rcv)', xl: 'f (Hz)', yl: 'dB', series: [{ name: '|H|', x: fr, y: H.map((h) => h - Hmax) }] },
        { id: 'modes', title: 'room modes (1 axial, 2 tangential, 3 oblique)', xl: 'f (Hz)', yl: 'type', bars: true, series: [{ name: 'mode', x: modes.map((q) => q.f), y: modes.map((q) => q.type) }] },
      ],
      draw(G, i) {
        G.view(-0.3, L[0] + 0.3, -0.3, L[1] + 0.3);
        G.rect(0, 0, L[0], L[1], COL.fg);
        const tNow = rows[i][0];
        paths.forEach((pp, k) => { const q = pp.filter((z) => z.t <= tNow); G.path(q.map((z) => z.x), q.map((z) => z.y), PALETTE[k]); });
        G.circle(src[0], src[1], 4, COL.f, true, true);
        G.circle(rcv[0], rcv[1], 4, COL.c, true, true);
        G.hud([`plan view  t=${rows[i][0].toFixed(3)} s  level=${rows[i][1].toFixed(2)} dB`]);
      },
    };
  },
};
