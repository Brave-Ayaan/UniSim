// Rockets, one sky: every rocket lifts off from its own pad — standing higher (on a mountain) starts it in
// thinner air — and they all fly on the same clock, drawn side by side against one altitude scale.
import type { Catalog } from '../catalog';
import { rocket } from '../../modules/rocket';
import { n, emptyScene, label, COL, GROUND, SCENE_W, type Ent, type Gfx, type Result, type Params, type Settings, type Check, type ParamDef } from './kit';

const ENV = ['grav', 'drag'];

function run(p: Params, s: Settings, ents: Ent[]): Result {
  const scale = n(p.ws_scale, 100);
  const R = ents.filter((e) => e.kind === 'rocket');
  if (!R.length) return emptyScene('no rockets: press E and add one on a pad');
  const res = R.map((e) => ({ e, h0: Math.max(0, (GROUND - e.y) * scale), r: rocket.run({ ...e.v, grav: p.grav ?? 'inverse square', drag: p.drag ?? 'on', h0: Math.max(0, (GROUND - e.y) * scale) }, s) }));
  // one clock: the longest flight sets the time axis; each rocket holds its last state after it stops
  const master = res.reduce((a, q) => (q.r.rows[q.r.rows.length - 1][0] > a.r.rows[a.r.rows.length - 1][0] ? q : a), res[0]);
  const T = master.r.rows.map((r) => r[0]), stride = Math.max(1, Math.ceil(T.length / 800)), times = T.filter((_, i) => i % stride === 0 || i === T.length - 1);
  const at = (rows: number[][], t: number) => { let lo = 0, hi = rows.length - 1; if (t >= rows[hi][0]) return rows[hi]; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m][0] <= t) lo = m; else hi = m; } const a = rows[lo], b = rows[hi], f = (t - a[0]) / (b[0] - a[0] || 1); return a.map((v, j) => v + f * (b[j] - v)); };
  const cols = ['t', ...res.flatMap((q) => [`${q.e.name} altitude (km)`, `${q.e.name} speed (m/s)`, `${q.e.name} stage`])];
  const rows = times.map((t) => [t, ...res.flatMap((q) => { const r = at(q.r.rows, t); return [r[1], r[2], Math.round(r[9])]; })]);
  const pre = <T extends { l: string }>(q: (typeof res)[number], a: T[] | undefined) => (a ?? []).map((x) => ({ ...x, l: `${q.e.name} · ${x.l}` }));
  const checks: Check[] = res.flatMap((q) => pre(q, q.r.checks));
  const apo = res.map((q) => Math.max(...q.r.rows.map((r) => r[1])));
  const H = Math.max(...apo, ...res.map((q) => n(q.e.v.ht, 0))) * 1.1 || 1;
  return {
    cols, rows, checks,
    notes: ['every rocket launches straight up from its pad: a pad higher up starts in thinner air · all fly on the same clock', ...res.flatMap((q) => (q.r.notes ?? []).map((x) => `${q.e.name}: ${x}`))],
    targets: res.flatMap((q) => pre(q, q.r.targets)),
    scalars: res.flatMap((q) => pre(q, q.r.scalars.filter((x) => /apogee|Δv|burn|T\/W|dynamic|burnout/.test(x.l)))),
    charts: [
      { id: 'h', title: 'altitude', xl: 't', yl: 'km', tAxis: true, series: res.map((q, i) => ({ name: q.e.name, x: rows.map((r) => r[0]), y: rows.map((r) => r[1 + 3 * i]) })) },
      { id: 'v', title: 'speed', xl: 't', yl: 'm/s', tAxis: true, series: res.map((q, i) => ({ name: q.e.name, x: rows.map((r) => r[0]), y: rows.map((r) => r[2 + 3 * i]) })) },
    ],
    draw(G: Gfx, k: number) {
      const rw = rows[Math.min(k, rows.length - 1)];
      G.view(0, SCENE_W, -0.03 * H, H, 18, false);
      G.ground(0, SCENE_W, 0);
      res.forEach((q, i) => {
        const x = q.e.x, h = rw[1 + 3 * i], ht = n(q.e.v.ht, 0);
        if (q.h0 > 0) G.line(x, 0, x, q.h0 / 1000, COL.dim, 4);
        if (ht > 0) { G.line(x - 2, ht, x + 2, ht, COL.c, 1, [3, 3]); }
        G.path(rows.slice(0, k + 1).map(() => x), rows.slice(0, k + 1).map((r) => r[1 + 3 * i]), COL.grid);
        G.rect(x - 0.4, h, 0.8, H * 0.03, COL.fg, true);
        if (rw[3 + 3 * i] > 0) G.line(x, h, x, h - H * 0.025, COL.b, 3);
        label(G, `${q.e.name} ${h.toFixed(1)} km ${rw[2 + 3 * i].toFixed(0)} m/s`, x, h, COL.dim, -10);
      });
      G.hud([`t=${rw[0].toFixed(1)} s  ${res.length} rocket${res.length > 1 ? 's' : ''} in one sky · gravity ${p.grav ?? 'inverse square'} · drag ${p.drag ?? 'on'}`, 'dashed = each rocket\'s target apogee']);
    },
  };
}

const own: ParamDef[] = rocket.params.filter((d) => !ENV.includes(d.k) && d.k !== 'h0').map((d) => (d.k === 'Cd' || d.k === 'dia' ? { ...d, when: undefined } : d));
export const rocketScene: Catalog = {
  env: [], engine: 'scene', run, ground: true,
  desc: 'rockets on their own pads in one sky: staging, Δv, gravity & drag losses, apogee',
  settings: rocket.settings, timeBased: true,
  envDefs: rocket.params.filter((d) => ENV.includes(d.k)),
  globals: [{ k: 'ws_scale', l: 'scene: metres per cell (pad heights)', u: 'm', v: 100, min: 1e-3, s: 50, d: 'Size of one editor grid cell vertically: a pad placed higher stands on a mountain.' }],
  where: 'each rocket launches straight up from where you put it (height above the ground = pad altitude)',
  kinds: [{ kind: 'rocket', name: 'rocket', sprite: 'modelrocket', desc: 'a launch vehicle on its pad', custom: own }],
  presets: [
    { name: 'Saturn V', kind: 'rocket', sprite: 'saturnv', desc: '3 stages, 45 t payload', v: { ns: 3, pay: 45, mp1: 2077, md1: 131, isp1: 263, T1: 34000, mp2: 444, md2: 36, isp2: 421, T2: 5141, mp3: 109, md3: 11, isp3: 421, T3: 1033, Cd: 0.5, dia: 10.1 } },
    { name: 'Falcon 9', kind: 'rocket', sprite: 'falcon9', desc: '2 stages, 15 t', v: { ns: 2, pay: 15, mp1: 411, md1: 22, isp1: 282, T1: 7607, mp2: 107.5, md2: 4, isp2: 348, T2: 934, Cd: 0.3, dia: 3.7 } },
    { name: 'V-2', kind: 'rocket', sprite: 'v2', desc: '1 stage, 1 t warhead', v: { ns: 1, pay: 1, mp1: 8.8, md1: 4, isp1: 239, T1: 270, Cd: 0.3, dia: 1.65, ht: 80, htol: 10 } },
    { name: 'model rocket', kind: 'rocket', sprite: 'modelrocket', desc: 'C6 motor, 100 g', v: { ns: 1, pay: 0.00005, mp1: 0.0000108, md1: 0.00004, isp1: 94, T1: 0.006, ht: 0.3, htol: 0.05, Cd: 0.75, dia: 0.025 } },
  ],
  start: [['Falcon 9', 20, GROUND], ['V-2', 44, 24]],
  tests: [{ name: 'no drag, constant g', list: [['V-2', 32, GROUND]], p: { drag: 'off', grav: 'constant' } }],
  guide(g, X, Y, cp) { g.fillStyle = '#8b5a2b'; g.fillRect(X(0), Y(GROUND) - 1, cp * SCENE_W, 2); },
};
