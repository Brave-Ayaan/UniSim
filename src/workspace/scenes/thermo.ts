// Heat, one room: blocks, water (that really melts and boils), conducting rods, heaters and heat engines.
// Objects closer than the contact reach touch and exchange heat through their contact; everything loses heat
// to the room air by convection (and radiation). A heater warms what it touches; an engine runs between the
// hottest and coldest things it touches and turns part of that heat flow into work.
import type { Catalog } from '../catalog';
import { n, str, emptyScene, tchart, simulate, energyCheck, spriteC, label, heatCol, COL, SCENE_H, type Ent, type Gfx, type Result, type Params, type Settings, type Check } from './kit';

const SB = 5.670374419e-8;
const MAT: Record<string, { k: number; rho: number; c: number; eps: number }> = {
  copper: { k: 400, rho: 8960, c: 385, eps: 0.05 }, aluminium: { k: 237, rho: 2700, c: 897, eps: 0.1 }, iron: { k: 80, rho: 7870, c: 449, eps: 0.6 },
  stone: { k: 2.5, rho: 2600, c: 790, eps: 0.9 }, wood: { k: 0.15, rho: 600, c: 1700, eps: 0.9 }, glass: { k: 1, rho: 2500, c: 840, eps: 0.92 },
};
// water / ice / steam: specific enthalpy from solid ice at 0 °C
const CI = 2100, CW = 4186, CS = 2010, LF = 334e3, LV = 2257e3, HB = LF + 100 * CW;
const hOf = (T: number) => (T < 0 ? CI * T : T <= 100 ? LF + CW * T : HB + LV + CS * (T - 100));
const TOf = (h: number) => (h < 0 ? h / CI : h < LF ? 0 : h <= HB ? (h - LF) / CW : h < HB + LV ? 100 : 100 + (h - HB - LV) / CS);
const phase = (h: number) => (h < 0 ? 'ice' : h < LF ? `melting ${((100 * h) / LF).toFixed(0)}%` : h <= HB ? 'water' : h < HB + LV ? `boiling ${((100 * (h - HB)) / LV).toFixed(0)}%` : 'steam');

interface Body { e: Ent; water: boolean; m: number; a: number; k: number; c: number; eps: number; s: number }
interface Rod { e: Ent; N: number; dx: number; A: number; k: number; C: number; per: number; eps: number; ends: [number, number] }

function run(p: Params, st: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 0.05), reach = n(p.reach, 3), Ta = n(p.Tair, 20), hc = n(p.hconv, 10), rad = str(p.rad, 'on') === 'on', hContact = 2000;
  const bodies: Body[] = [], rods: Rod[] = [];
  for (const e of ents) {
    if (e.kind === 'block' || e.kind === 'water') {
      const water = e.kind === 'water', mt = MAT[str(e.v.mat, 'copper')] ?? MAT.copper, m = Math.max(1e-6, n(e.v.m, 1));
      const rho = water ? 1000 : mt.rho, a = Math.cbrt(m / rho);
      bodies.push({ e, water, m, a, k: water ? 0.6 : mt.k, c: water ? CW : mt.c, eps: water ? 0.95 : mt.eps, s: 0 });
    }
  }
  if (!bodies.length) return emptyScene('nothing to heat: press E and add a block or some water');
  const nb = bodies.length;
  // rods: a bar of N slices; each end touches the nearest body within reach of that end
  for (const e of ents.filter((q) => q.kind === 'rod')) {
    const mt = MAT[str(e.v.mat, 'copper')] ?? MAT.copper, Lr = n(e.v.L, 0.5), A = n(e.v.A, 1) * 1e-4, N = 20, half = Lr / 2 / scale;
    const end = (x: number) => { let bi = -1, bd = reach; bodies.forEach((b, i) => { const d = Math.hypot(b.e.x - x, b.e.y - e.y); if (d <= bd) { bd = d; bi = i; } }); return bi; };
    rods.push({ e, N, dx: Lr / N, A, k: mt.k, C: mt.rho * mt.c * A * (Lr / N), per: 4 * Math.sqrt(A), eps: mt.eps, ends: [end(e.x - half), end(e.x + half)] });
  }
  // contacts between bodies (centres within reach): series resistance half-body + contact + half-body
  const touch = (a: Ent, b: Ent) => Math.hypot(a.x - b.x, a.y - b.y) <= reach;
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < nb; i++) for (let j = i + 1; j < nb; j++) if (touch(bodies[i].e, bodies[j].e)) {
    const A = Math.min(bodies[i].a, bodies[j].a) ** 2, B1 = bodies[i], B2 = bodies[j];
    pairs.push([i, j, 1 / (B1.a / 2 / (B1.k * A) + 1 / (hContact * A) + B2.a / 2 / (B2.k * A))]);
  }
  const heaters = ents.filter((q) => q.kind === 'heater').map((e) => { let bi = -1, bd = reach; bodies.forEach((b, i) => { const d = Math.hypot(b.e.x - e.x, b.e.y - e.y); if (d <= bd) { bd = d; bi = i; } }); return { e, P: n(e.v.P, 1000), on: n(e.v.ton, 1e9), b: bi }; });
  const engines = ents.filter((q) => q.kind === 'engine').map((e) => {
    const near = bodies.map((b, i) => [i, Math.hypot(b.e.x - e.x, b.e.y - e.y)] as const).filter(([, d]) => d <= reach).map(([i]) => i);
    return { e, UA: n(e.v.UA, 5), f: Math.min(1, Math.max(0, n(e.v.f, 0.5))), near };
  });
  // state: body T (blocks) or specific enthalpy (water), rod slices, then Q to air, W by engines, E from heaters
  const nr = rods.reduce((a, r) => a + r.N, 0), iQ = nb + nr, iW = iQ + 1, iE = iQ + 2;
  const temp = (y: number[], i: number) => (bodies[i].water ? TOf(y[i]) : y[i]);
  const cap = (i: number) => bodies[i].m * (bodies[i].water ? 1 : bodies[i].c); // dy/dt = q / cap
  const lossTo = (T: number, A: number, eps: number) => hc * A * (T - Ta) + (rad ? eps * SB * A * ((T + 273.15) ** 4 - (Ta + 273.15) ** 4) : 0);
  const flows = { pair: pairs.map(() => 0), eng: engines.map(() => ({ Qh: 0, W: 0, hot: -1, cold: -1 })) };
  const f = (t: number, y: number[]) => {
    const d = new Array(y.length).fill(0), q = new Array(nb).fill(0);
    const T = bodies.map((_, i) => temp(y, i));
    pairs.forEach(([i, j, G], k) => { const Q = G * (T[i] - T[j]); q[i] -= Q; q[j] += Q; flows.pair[k] = Q; });
    let loss = 0;
    bodies.forEach((b, i) => { const L = lossTo(T[i], 6 * b.a * b.a, b.eps); q[i] -= L; loss += L; });
    let Ein = 0;
    for (const h of heaters) if (t < h.on) { if (h.b >= 0) q[h.b] += h.P; else loss += 0; Ein += h.b >= 0 ? h.P : 0; }
    let Wout = 0;
    engines.forEach((en, k) => {
      if (en.near.length < 2) return;
      const hot = en.near.reduce((a, i) => (T[i] > T[a] ? i : a)), cold = en.near.reduce((a, i) => (T[i] < T[a] ? i : a));
      const Th = T[hot] + 273.15, Tc = T[cold] + 273.15;
      if (Th <= Tc) return;
      const Qh = en.UA * (Th - Tc), W = en.f * (1 - Tc / Th) * Qh;
      q[hot] -= Qh; q[cold] += Qh - W; Wout += W;
      flows.eng[k] = { Qh, W, hot, cold };
    });
    let o = nb;
    for (const r of rods) {
      const G = (r.k * r.A) / r.dx;
      for (let s = 0; s < r.N; s++) {
        const Ts = y[o + s];
        let qs = -lossTo(Ts, r.per * r.dx, r.eps);
        loss += -qs;
        if (s > 0) qs += G * (y[o + s - 1] - Ts);
        if (s < r.N - 1) qs += G * (y[o + s + 1] - Ts);
        [0, r.N - 1].forEach((se, side) => {
          if (s !== se || r.ends[side] < 0) return;
          const b = bodies[r.ends[side]], Ge = 1 / (r.dx / 2 / (r.k * r.A) + 1 / (hContact * r.A) + b.a / 2 / (b.k * r.A));
          const Q = Ge * (T[r.ends[side]] - Ts);
          qs += Q; q[r.ends[side]] -= Q;
        });
        d[o + s] = qs / r.C;
      }
      o += r.N;
    }
    bodies.forEach((_, i) => (d[i] = q[i] / cap(i)));
    d[iQ] = loss; d[iW] = Wout; d[iE] = Ein;
    return d;
  };
  const y0 = [...bodies.map((b) => (b.water ? hOf(n(b.e.v.T0, 20)) : n(b.e.v.T0, 20))), ...rods.flatMap((r) => new Array(r.N).fill(n(r.e.v.T0, Ta))), 0, 0, 0];
  const U = (y: number[]) => bodies.reduce((a, b, i) => a + cap(i) * y[i], 0) + rods.reduce((a, r, ri) => { const o = nb + rods.slice(0, ri).reduce((z, q) => z + q.N, 0); let s = 0; for (let k = 0; k < r.N; k++) s += r.C * y[o + k]; return a + s; }, 0);
  const cols = ['t', ...bodies.map((b) => `${b.e.name} T (C)`), ...rods.flatMap((r) => [`${r.e.name} left T (C)`, `${r.e.name} middle T (C)`, `${r.e.name} right T (C)`]), 'heat lost to air (J)', 'engine work (J)', 'heater energy (J)', ...bodies.filter((b) => b.water).map((b) => `${b.e.name} liquid fraction`)];
  const rows: number[][] = [], frames: { T: number[]; rod: number[][]; ph: string[]; pair: number[]; eng: { Qh: number; W: number; hot: number; cold: number }[] }[] = [];
  const U0 = U(y0);
  const yEnd = simulate(f, y0, st, (t, y) => {
    f(t, y);
    let o = nb;
    const rodT = rods.map((r) => { const a = y.slice(o, o + r.N); o += r.N; return a; });
    const liq = bodies.filter((b) => b.water).map((b) => { const h = y[bodies.indexOf(b)]; return h < LF ? Math.max(0, h) / LF : h <= HB ? 1 : Math.max(0, 1 - (h - HB) / LV); });
    rows.push([t, ...bodies.map((_, i) => temp(y, i)), ...rodT.flatMap((a) => [a[0], a[a.length >> 1], a[a.length - 1]]), y[iQ], y[iW], y[iE], ...liq]);
    frames.push({ T: bodies.map((_, i) => temp(y, i)), rod: rodT, ph: bodies.map((b, i) => (b.water ? phase(y[i]) : '')), pair: flows.pair.slice(), eng: flows.eng.map((q) => ({ ...q })) });
  });
  const dU = U(yEnd) - U0;
  const tEnd = st.dt * st.steps;
  const scaleE = Math.max(Math.abs(dU), yEnd[iQ], yEnd[iE], 1e-3 * Math.abs(U0), 1);
  const checks: Check[] = [energyCheck('energy: ΔU = heater input − heat to air − engine work', yEnd[iE] - yEnd[iQ] - yEnd[iW], dU, scaleE, st.method, 1e-6)];
  // exact references: a lone block cooling by convection only; an isolated touching pair
  const alone = (i: number) => !pairs.some(([a, b]) => a === i || b === i) && !rods.some((r) => r.ends.includes(i)) && !heaters.some((h) => h.b === i) && !engines.some((en) => en.near.includes(i));
  bodies.forEach((b, i) => {
    if (b.water || !alone(i)) return;
    const tau = (b.m * b.c) / (hc * 6 * b.a * b.a), T0 = n(b.e.v.T0, 20);
    checks.push({ l: `${b.e.name}: Newton cooling T_air + ΔT·e^(−t/τ)`, exp: Ta + (T0 - Ta) * Math.exp(-tEnd / tau), act: temp(yEnd, i), u: 'C', abs: 1e-6 * Math.max(1, Math.abs(T0 - Ta)), ref: rad || st.method !== 'rk4' });
  });
  pairs.forEach(([i, j, G]) => {
    const B1 = bodies[i], B2 = bodies[j];
    const only = pairs.filter(([a, b]) => [a, b].some((z) => z === i || z === j)).length === 1 && [i, j].every((z) => !rods.some((r) => r.ends.includes(z)) && !heaters.some((h) => h.b === z) && !engines.some((en) => en.near.includes(z)));
    if (!only || B1.water || B2.water) return;
    const C1 = B1.m * B1.c, C2 = B2.m * B2.c, T1 = n(B1.e.v.T0, 20), T2 = n(B2.e.v.T0, 20), Tm = (C1 * T1 + C2 * T2) / (C1 + C2);
    const exact = hc === 0 && !rad;
    checks.push({ l: `${B1.e.name} ↔ ${B2.e.name}: difference decays as e^(−G(1/C₁+1/C₂)t)`, exp: (T1 - T2) * Math.exp(-G * (1 / C1 + 1 / C2) * tEnd), act: temp(yEnd, i) - temp(yEnd, j), u: 'C', abs: 1e-6 * Math.max(1, Math.abs(T1 - T2)), ref: !exact || st.method !== 'rk4' });
    checks.push({ l: `${B1.e.name} ↔ ${B2.e.name}: common temperature Σ C T / Σ C`, exp: Tm, act: (C1 * temp(yEnd, i) + C2 * temp(yEnd, j)) / (C1 + C2), u: 'C', abs: 1e-6 * Math.max(1, Math.abs(T1 - T2)), ref: !exact || st.method !== 'rk4' });
  });
  const notes = [`objects closer than ${reach} cells touch · contact conductance ${hContact} W/m²K · bodies are cubes sized from their mass`];
  if (!rad || hc === 0) notes.push(`${hc === 0 ? 'no convection' : ''}${!rad ? ' no radiation' : ''}: the exact single-body / pair formulas apply`);
  heaters.forEach((h) => { if (h.b < 0) notes.push(`${h.e.name} touches nothing: it is not heating anything`); });
  engines.forEach((en) => { if (en.near.length < 2) notes.push(`${en.e.name} needs to touch two things (a hot and a cold one)`); });
  const allT = rows.flatMap((r) => r.slice(1, 1 + nb + 3 * rods.length)), Tlo = Math.min(Ta, ...allT), Thi = Math.max(Ta + 1, ...allT);
  const px = (e: Ent) => [e.x * scale, (SCENE_H - e.y) * scale];
  return {
    cols, rows, checks, notes,
    scalars: [
      ...bodies.map((b, i) => ({ l: `${b.e.name}: final temperature`, v: temp(yEnd, i), u: 'C' })),
      ...bodies.filter((b) => b.water).map((b) => ({ l: `${b.e.name}: final state = ${phase(yEnd[bodies.indexOf(b)])}`, v: temp(yEnd, bodies.indexOf(b)), u: 'C' })),
      { l: 'heat lost to the room', v: yEnd[iQ] / 1e3, u: 'kJ' }, { l: 'engine work', v: yEnd[iW] / 1e3, u: 'kJ' }, { l: 'heater energy', v: yEnd[iE] / 1e3, u: 'kJ' },
      ...engines.map((en) => ({ l: `${en.e.name}: Carnot limit now`, v: (() => { const q = frames[frames.length - 1].eng[engines.indexOf(en)]; return q.hot < 0 ? 0 : 1 - (frames[frames.length - 1].T[q.cold] + 273.15) / (frames[frames.length - 1].T[q.hot] + 273.15); })() })),
    ],
    charts: [
      tchart(cols, rows, 'temp', 'temperatures', [...bodies.map((b) => `${b.e.name} T (C)`), ...rods.flatMap((r) => [`${r.e.name} left T (C)`, `${r.e.name} right T (C)`])], 'C'),
      tchart(cols, rows, 'energy', 'energy flows', ['heat lost to air (J)', 'engine work (J)', 'heater energy (J)'], 'J'),
      ...(rods.length ? [{ id: 'rod', title: 'rod temperature profile (end of run)', xl: 'x along rod (m)', yl: 'C', series: rods.map((r, i) => ({ name: r.e.name, x: [...Array(r.N).keys()].map((k) => (k + 0.5) * r.dx), y: frames[frames.length - 1].rod[i] })) }] : []),
    ],
    draw(G: Gfx, k: number) {
      const fr = frames[Math.min(k, frames.length - 1)], t = rows[Math.min(k, rows.length - 1)][0];
      G.view(0, 64 * scale, 0, SCENE_H * scale, 14);
      const col = (T: number) => heatCol((T - Tlo) / (Thi - Tlo));
      pairs.forEach(([i, j], q) => { const [x1, y1] = px(bodies[i].e), [x2, y2] = px(bodies[j].e); G.line(x1, y1, x2, y2, Math.abs(fr.pair[q]) > 1e-9 ? COL.f : COL.dim, 1 + Math.min(5, Math.log10(1 + Math.abs(fr.pair[q])))); });
      rods.forEach((r, ri) => {
        const [cx, cy] = px(r.e), L = r.N * r.dx;
        fr.rod[ri].forEach((T, s) => G.rect(cx - L / 2 + s * r.dx, cy - 0.2 * scale, r.dx, 0.4 * scale, col(T), true));
        label(G, `${r.e.name} ${fr.rod[ri][0].toFixed(0)}…${fr.rod[ri][r.N - 1].toFixed(0)} °C`, cx - L / 2, cy, COL.dim, -8);
      });
      bodies.forEach((b, i) => {
        const [x, y] = px(b.e), s = Math.max(b.a, 0.6 * scale);
        G.rect(x - s / 2, y - s / 2, s, s, col(fr.T[i]), true);
        spriteC(G, b.e.sprite, x, y, 2);
        label(G, `${b.e.name} ${fr.T[i].toFixed(1)} °C${b.water ? ` ${fr.ph[i]}` : ''}`, x, y, COL.fg, -14);
      });
      heaters.forEach((h) => { const [x, y] = px(h.e); spriteC(G, h.e.sprite, x, y, 2, t < h.on ? 1 : 0.4); label(G, `${h.P} W`, x, y, t < h.on ? COL.b : COL.dim, 16); });
      engines.forEach((en, q) => { const [x, y] = px(en.e); spriteC(G, en.e.sprite, x, y, 2); const e2 = fr.eng[q]; label(G, `${en.e.name} ${e2.W.toFixed(1)} W out`, x, y, COL.c, 16); });
      G.hud([`t=${t.toFixed(1)} s  room ${Ta} °C  ${bodies.length} bodies · ${pairs.length} contacts · ${rods.length} rods`, 'yellow lines = heat flowing through a contact']);
    },
  };
}

export const thermoScene: Catalog = {
  env: [], engine: 'scene', run,
  desc: 'blocks, water/ice, rods, heaters and heat engines in one room: contact conduction, melting & boiling, losses to the air',
  settings: { dt: 1, steps: 1800, method: 'rk4' }, timeBased: true,
  envDefs: [
    { k: 'Tair', l: 'room air temperature', u: 'C', v: 20, s: 1, d: 'Everything exchanges heat with the room air at this temperature.' },
    { k: 'hconv', l: 'air convection coeff h', u: 'W/m2K', v: 10, min: 0, s: 1, d: 'Still air ≈ 5–10, a breeze ≈ 25, 0 = perfectly insulated.' },
    { k: 'rad', l: 'thermal radiation', v: 'on', o: ['on', 'off'], d: 'Radiative exchange εσA(T⁴ − T_air⁴) with the room.' },
  ],
  globals: [
    { k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.05, min: 0.001, s: 0.01, d: 'Size of one editor grid cell.' },
    { k: 'reach', l: 'contact reach', u: 'cells', v: 3, min: 0, s: 0.5, d: 'Objects whose centres are this close touch each other.' },
  ],
  where: 'objects touch when they are within 3 cells of each other: put things together to let heat flow between them',
  kinds: [
    { kind: 'block', name: 'block', sprite: 'brick', desc: 'a solid block', custom: [
      { k: 'mat', l: 'material', v: 'copper', o: Object.keys(MAT), d: 'Sets conductivity, density, heat capacity and emissivity.' },
      { k: 'm', l: 'mass', u: 'kg', v: 1, min: 1e-6, s: 0.1, d: 'Mass: a cube of this much material.' },
      { k: 'T0', l: 'start temperature', u: 'C', v: 200, s: 10, d: 'Temperature when the run starts.' },
    ] },
    { kind: 'water', name: 'water / ice', sprite: 'icecube', desc: 'water that can freeze, melt and boil', custom: [
      { k: 'm', l: 'mass', u: 'kg', v: 0.03, min: 1e-6, s: 0.01, d: 'Mass of water (or ice).' },
      { k: 'T0', l: 'start temperature', u: 'C', v: -18, s: 5, d: 'Below 0 it starts as ice; latent heats are included.' },
    ] },
    { kind: 'heater', name: 'heater', sprite: 'element', desc: 'heats whatever it touches', custom: [
      { k: 'P', l: 'power', u: 'W', v: 2000, min: 0, s: 100, d: 'Electrical power turned into heat in the object it touches.' },
      { k: 'ton', l: 'switch off after', u: 's', v: 1e9, min: 0, s: 60, d: 'Time when it switches off.' },
    ] },
    { kind: 'rod', name: 'metal rod', sprite: 'rod', desc: 'a bar conducting heat between the things at its ends', custom: [
      { k: 'mat', l: 'material', v: 'copper', o: Object.keys(MAT), d: 'Rod material.' },
      { k: 'L', l: 'length', u: 'm', v: 0.5, min: 0.01, s: 0.05, d: 'Rod length (it lies left-right, centred where you put it).' },
      { k: 'A', l: 'cross-section', u: 'cm2', v: 1, min: 1e-3, s: 0.2, d: 'Cross-section area.' },
      { k: 'T0', l: 'start temperature', u: 'C', v: 20, s: 5, d: 'Initial temperature of the whole rod.' },
    ] },
    { kind: 'engine', name: 'heat engine', sprite: 'engine', desc: 'runs between the hottest and coldest things it touches', custom: [
      { k: 'UA', l: 'heat intake conductance', u: 'W/K', v: 5, min: 0, s: 1, d: 'Heat taken from the hot side = UA·(T_hot − T_cold).' },
      { k: 'f', l: 'fraction of Carnot', v: 0.5, min: 0, max: 1, s: 0.05, d: 'Efficiency = f·(1 − T_cold/T_hot); 1 = ideal Carnot engine.' },
    ] },
  ],
  presets: [
    { name: 'kettle water', kind: 'water', sprite: 'kettle', desc: '1.5 L at 20 °C', v: { m: 1.5, T0: 20 } },
    { name: 'kettle element', kind: 'heater', sprite: 'element', desc: '2 kW', v: { P: 2000 } },
    { name: 'ice cube', kind: 'water', sprite: 'icecube', desc: '30 g at −18 °C', v: { m: 0.03, T0: -18 } },
    { name: 'cup of tea', kind: 'water', sprite: 'coffee', desc: '250 g at 90 °C', v: { m: 0.25, T0: 90 } },
    { name: 'hot copper block', kind: 'block', sprite: 'brick', desc: '1 kg at 300 °C', v: { mat: 'copper', m: 1, T0: 300 } },
    { name: 'granite slab', kind: 'block', sprite: 'stoneblock', desc: '5 kg at 20 °C', v: { mat: 'stone', m: 5, T0: 20 } },
    { name: 'copper rod', kind: 'rod', sprite: 'rod', desc: '0.5 m, 1 cm²', v: { mat: 'copper', L: 0.5, A: 1, T0: 20 } },
    { name: 'Stirling engine', kind: 'engine', sprite: 'engine', desc: '60% of Carnot', v: { UA: 3, f: 0.6 } },
  ],
  start: [['kettle water', 12, 20], ['kettle element', 12, 23], ['hot copper block', 36, 20], ['ice cube', 38, 20], ['granite slab', 54, 20]],
  tests: [
    { name: 'insulated pair (exact)', list: [['block', 20, 18, { mat: 'copper', m: 1, T0: 200 }], ['block', 22, 18, { mat: 'iron', m: 2, T0: 20 }]], p: { hconv: 0, rad: 'off' } },
    { name: 'lone block, convection only (exact)', list: [['block', 30, 18, { mat: 'aluminium', m: 0.5, T0: 150 }]], p: { rad: 'off' } },
    { name: 'rod between hot and cold', list: [['block', 20, 18, { mat: 'copper', m: 2, T0: 300 }], ['rod', 25, 18], ['block', 30, 18, { mat: 'stone', m: 5, T0: 0 }]] },
    { name: 'engine between hot and cold', list: [['hot copper block', 28, 18], ['Stirling engine', 30, 18], ['granite slab', 32, 18]] },
  ],
  guide(g, X, Y, cp, p, ents) {
    const r = n(p.reach, 3);
    g.strokeStyle = '#2b3036';
    for (const e of ents) { g.beginPath(); g.arc(X(e.x), Y(e.y), r * cp, 0, 2 * Math.PI); g.stroke(); }
  },
};
