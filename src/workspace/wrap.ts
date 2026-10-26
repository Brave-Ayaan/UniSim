// Turns a module into a workspace simulation. Its ENVIRONMENT parameters (things nobody can change by hand:
// gravity, air, drag, the road...) stay in the outside list; every other parameter belongs to the objects
// in the scene, which are placed and aimed in EDIT. The default scene holds one object with the module's
// old defaults, so a freshly opened simulation behaves exactly as before.
import type { SimModule, ParamDef, Params, Result, Settings, Chart, Check, Method } from '../core/types';
import { Gfx, COL } from '../core/gfx';
import { CATALOG, GROUND, type Catalog, type Kind, type Preset } from './catalog';
import { pendulumScene, ballScene, nbodyScene, SCENE_W, spriteColor, type Ent } from './engines';
import { SPRITES, drawSprite } from './sprites';

export interface RawEnt { id: number; k: string; n: string; x: number; y: number; sp: string }

export function parseEnts(p: Params): RawEnt[] {
  try { const a = JSON.parse(String(p._ents ?? '[]')); return Array.isArray(a) ? a : []; } catch { return []; }
}
const key = (id: number, f: string) => `e${id}_${f}`;
const defaultsOf = (mod: SimModule): Params => Object.fromEntries(mod.params.map((d) => [d.k, d.v]));

/** fields an object of this kind owns: its own defs, a listed subset, or every non-environment parameter */
export function kindFields(mod: SimModule, kind: Kind, cat: Catalog = CATALOG[mod.id]): ParamDef[] {
  if (kind.custom) return kind.custom;
  if (kind.fields) return kind.fields.map((f) => mod.params.find((d) => d.k === f)).filter((d): d is ParamDef => !!d);
  return mod.params.filter((d) => !cat.env.includes(d.k) && !(cat.envDefs ?? []).some((e) => e.k === d.k) && !d.k.startsWith('_'));
}
const ownNumerics = (cat: Catalog, kind: Kind) => !cat.engine && !kind.custom;
const objSettings = (mod: SimModule, mode: string, s?: Settings, extra?: Partial<Settings>): Settings =>
  ({ ...(s ?? mod.settings), ...(mod.modeSettings?.[mode] ?? {}), ...(extra ?? {}) });

/** add a preset (or a bare kind) at scene cell (x, y); returns the new parameter set */
export function placeObject(mod: SimModule, p: Params, what: { preset?: Preset; kind?: Kind }, x: number, y: number, s?: Settings, over?: Params): Params {
  const cat = CATALOG[mod.id];
  if (!cat) return p;
  const ents = parseEnts(p);
  const out: Params = { ...p };
  let id = ents.reduce((a, e) => Math.max(a, e.id), 0);
  const kind = what.kind ?? cat.kinds.find((k) => k.kind === what.preset!.kind)!;
  const base: Params = { ...(kind.init ?? {}), ...(what.preset?.v ?? {}), ...(over ?? {}) };
  const group = what.preset?.group ?? [{ dx: 0 }];
  const fields = kindFields(mod, kind, cat);
  const mdef = defaultsOf(mod);
  group.forEach((gm, gi) => {
    id++;
    const name0 = (what.preset?.name ?? kind.name).replace(/ \(.*\)$/, '');
    const name = `${group.length > 1 ? `${name0} ${gi + 1}` : name0}`.slice(0, 22);
    const nm = ents.some((e) => e.n === name) ? `${name} #${id}` : name;
    ents.push({ id, k: kind.kind, n: nm, x: x + (gm.dx ?? 0), y: y + (gm.dy ?? 0), sp: what.preset?.sprite ?? kind.sprite });
    // own (custom) fields default to their own value; module-backed fields to the module's default
    for (const f of fields) out[key(id, f.k)] = gm.v?.[f.k] ?? base[f.k] ?? (kind.custom ? f.v : mdef[f.k] ?? f.v);
    if (ownNumerics(cat, kind)) {
      const es = objSettings(mod, String(base.mode ?? mdef.mode ?? ''), s, what.preset?.s);
      out[key(id, '$method')] = es.method; out[key(id, '$dt')] = es.dt; out[key(id, '$steps')] = es.steps;
    }
  });
  out._ents = JSON.stringify(ents);
  return out;
}
export function removeObject(p: Params, id: number): Params {
  const out: Params = { ...p, _ents: JSON.stringify(parseEnts(p).filter((e) => e.id !== id)) };
  for (const k of Object.keys(out)) if (k.startsWith(`e${id}_`)) delete out[k];
  return out;
}
export function moveObject(p: Params, id: number, x: number, y: number): Params {
  return { ...p, _ents: JSON.stringify(parseEnts(p).map((e) => (e.id === id ? { ...e, x, y } : e))) };
}

/** a scene from a list of [preset or kind name, x, y, overrides] */
export function buildScene(mod: SimModule, list: [string, number, number, Params?][]): Params {
  const cat = CATALOG[mod.id];
  let p: Params = { _ents: '[]' };
  for (const [name, x, y, over] of list) {
    const preset = cat.presets.find((q) => q.name === name);
    const kind = cat.kinds.find((k) => k.kind === name);
    if (preset || kind) p = placeObject(mod, p, preset ? { preset } : { kind }, x, y, mod.settings, over);
  }
  return p;
}

type REnt = Ent & { s: Partial<Settings>; def: Kind };

export function wrap(mod: SimModule): SimModule {
  const cat = CATALOG[mod.id];
  if (!cat) return mod;
  const mdef = defaultsOf(mod);
  const p0 = buildScene(mod, cat.start);
  const envDefs = cat.envDefs ?? mod.params.filter((d) => cat.env.includes(d.k));
  const val = (p: Params, k: string, f: ParamDef) => p[k] ?? p0[k] ?? f.v;
  /** an object's full parameter view: module defaults <- environment <- its own values */
  const view = (p: Params, e: RawEnt, kind: Kind): Params => {
    const v: Params = cat.engine === 'scene' ? {} : { ...mdef };
    for (const d of envDefs) v[d.k] = p[d.k] ?? d.v;
    for (const f of kindFields(mod, kind, cat)) v[f.k] = val(p, key(e.id, f.k), f);
    return v;
  };
  const resolve = (p: Params): REnt[] => parseEnts(p).flatMap((e) => {
    const kind = cat.kinds.find((k) => k.kind === e.k);
    if (!kind) return [];
    const v = view(p, e, kind);
    const s: Partial<Settings> = {};
    if (ownNumerics(cat, kind)) {
      const d = objSettings(mod, String(v.mode ?? ''));
      s.method = String(p[key(e.id, '$method')] ?? p0[key(e.id, '$method')] ?? d.method) as Method;
      s.dt = Number(p[key(e.id, '$dt')] ?? p0[key(e.id, '$dt')] ?? d.dt);
      s.steps = Math.max(1, Math.round(Number(p[key(e.id, '$steps')] ?? p0[key(e.id, '$steps')] ?? d.steps)));
    }
    return [{ id: e.id, kind: e.k, name: e.n, x: e.x, y: e.y, sprite: e.sp, v, s, def: kind }];
  });

  const dyn = (p: Params): ParamDef[] => {
    const out: ParamDef[] = [];
    (cat.globals ?? []).forEach((g, i) => out.push({ ...g, sec: i === 0 ? 'scene' : undefined }));
    parseEnts(p).forEach((e, idx) => {
      const kind = cat.kinds.find((k) => k.kind === e.k);
      if (!kind) return;
      const v = view(p, e, kind);
      kindFields(mod, kind, cat).forEach((f, fi) => out.push({
        ...f, k: key(e.id, f.k), v: val(p, key(e.id, f.k), f),
        // a field shows when it matters for THIS object (its own mode / type)
        when: f.when ? () => f.when!(v) : undefined,
        sec: fi === 0 ? `+ ${idx + 1} · ${e.n} (${kind.name})` : undefined,
      }));
      if (ownNumerics(cat, kind)) {
        const d = objSettings(mod, String(v.mode ?? ''));
        if (mod.timeBased) {
          out.push({ k: key(e.id, '$method'), l: 'integrator', v: p0[key(e.id, '$method')] ?? d.method, o: ['euler', 'semi', 'rk4'], d: 'Integration method for this object.' });
          out.push({ k: key(e.id, '$dt'), l: 'timestep dt', u: 's', v: p0[key(e.id, '$dt')] ?? d.dt, min: 1e-15, s: d.dt, d: 'Timestep for this object only; preset objects come with one that resolves their motion.' });
        }
        out.push({ k: key(e.id, '$steps'), l: mod.timeBased ? 'iterations' : 'resolution', v: p0[key(e.id, '$steps')] ?? d.steps, min: 1, s: 100, d: 'Number of steps (or resolution) for this object.' });
      }
    });
    return out;
  };

  // self-test scenes: every option of the main kind's mode, every other kind and preset alone, showcases
  const tests: NonNullable<SimModule['selftests']> = [];
  const yAt = cat.engine === 'pendulums' ? 1 : cat.engine === 'projectiles' || mod.id === 'vehicle' ? GROUND : 18;
  const k0 = cat.kinds[0];
  const modeField = kindFields(mod, k0, cat).find((f) => f.o && (f.k === 'mode' || f.k === 'type' || f.k === 'plant'));
  if (modeField && cat.engine !== 'scene') for (const o of modeField.o!) tests.push({ name: `+ ${k0.name}: ${o}`, p: buildScene(mod, [[k0.kind, 32, yAt, { [modeField.k]: o }]]) });
  if (!cat.engine) for (const k of cat.kinds.slice(1)) tests.push({ name: `+ ${k.name}`, p: buildScene(mod, [[k.kind, 32, yAt]]) });
  if (cat.engine === 'scene') {
    // scenes: each preset takes the place of the first start object of its kind (or joins the start scene)
    for (const pr of cat.presets) {
      let done = false;
      const list = cat.start.map((q): [string, number, number, Params?] => { const k = cat.kinds.find((kk) => kk.kind === q[0]); if (!done && k?.kind === pr.kind) { done = true; return [pr.name, q[1], q[2]]; } return q; });
      if (!done) list.push([pr.name, 32, 18]);
      tests.push({ name: `+ ${pr.name}`, p: buildScene(mod, list) });
    }
    for (const t of cat.tests ?? []) tests.push({ name: `+ ${t.name}`, p: { ...buildScene(mod, t.list), ...(t.p ?? {}) }, s: t.s });
  } else for (const pr of cat.presets) tests.push({ name: `+ ${pr.name}`, p: buildScene(mod, [[pr.name, 32, yAt]]) });
  if (cat.engine === 'pendulums') tests.push({ name: '+ cradle & wrecking ball', p: buildScene(mod, [["Newton's cradle (5 balls)", 32, 1], ['wrecking ball', 12, 1]]), s: { steps: 4000 } });
  if (cat.engine === 'balls') {
    const brk = buildScene(mod, [['billiard rack (6 balls)', 40, 18], ['cue ball (struck)', 12, 18]]);
    tests.push({ name: '+ billiard break', p: { ...brk, ws_scale: 0.05 } }, { name: '+ break, no cushions', p: { ...brk, ws_scale: 0.05, ws_walls: 'off', ws_T: 1 } });
  }
  if (cat.engine === 'projectiles') tests.push({ name: '+ 3 launchers & a target on a hill', p: buildScene(mod, [['proj', 4, GROUND], ['proj', 10, 28, { v0: 40, ang: 30 }], ['proj', 2, 20, { v0: 25, ang: 10 }], ['target', 50, 30]]) });

  return {
    ...mod,
    desc: cat.desc ?? mod.desc,
    settings: cat.settings ?? mod.settings,
    timeBased: cat.timeBased ?? mod.timeBased,
    modeSettings: cat.engine === 'scene' ? undefined : mod.modeSettings,
    // outside list = environment only; a field that depends on objects (their mode) shows if any object needs it
    params: [
      ...envDefs.map((d, i) => ({
        ...d, sec: i === 0 ? 'environment (affects every object)' : d.sec,
        when: d.when ? (p: Params) => { const objs = resolve(p); return objs.length ? objs.some((o) => d.when!({ ...o.v, ...p })) : d.when!({ ...mdef, ...p }); } : undefined,
      })),
      { k: '_ents', l: 'scene objects', v: p0._ents, when: () => false },
    ],
    dynParams: dyn,
    selftests: tests,
    run(p: Params, s: Settings): Result {
      const ents = resolve(p);
      const items: Item[] = [];
      if (cat.engine === 'pendulums') {
        const simple = ents.filter((e) => String(e.v.type ?? 'simple') === 'simple');
        if (simple.length) items.push({ tag: simple.length > 1 ? 'pendulums' : simple[0].name, name: simple.length > 1 ? 'pendulums' : simple[0].name, res: pendulumScene(p, s, simple), sprite: simple[0].sprite });
        // compound / double pendulums run the original model, hanging from the same ceiling on the same clock
        const others = ents.filter((q) => String(q.v.type ?? 'simple') !== 'simple');
        for (const e of others) {
          const v = e.v;
          items.push({ tag: e.name, name: e.name, sprite: e.sprite, res: mod.run({ ...mdef, g: p.g ?? mdef.g, c: p.c ?? mdef.c, mode: v.type, L1: v.L, m1: v.m, th1: v.th, w1: v.w, L2: v.L2, m2: v.m2, th2: v.th2, w2: v.w2 }, s) });
        }
        if (others.length && items.length > 1) return pendulumFrame(merge(items, true), items, simple, others, Number(p.ws_scale ?? 0.1));
      } else if (cat.engine === 'balls') { if (ents.length) items.push({ tag: 'table', name: 'table', res: ballScene(p, s, ents), sprite: ents[0].sprite }); }
      else if (cat.engine === 'nbody') { if (ents.length) items.push({ tag: 'bodies', name: 'bodies', res: nbodyScene(p, s, ents), sprite: ents[0].sprite }); }
      else if (cat.engine === 'projectiles') return projectileScene(mod, p, s, ents);
      else if (cat.engine === 'scene') return ents.length ? cat.run!(p, s, ents) : emptyResult('the scene is empty: press E to add objects');
      else for (const e of ents) items.push({ tag: e.name, name: e.name, res: mod.run(e.v, { ...s, ...e.s }), sprite: e.sprite });
      if (!items.length) return emptyResult('the scene is empty: press E to add objects');
      if (items.length === 1) return items[0].res;
      return merge(items, mod.timeBased);
    },
  };
}

function emptyResult(note: string): Result {
  return { cols: ['t'], rows: [[0]], scalars: [], checks: [], charts: [], notes: [note], draw: (G) => G.hud([note]) };
}

// ---------------------------------------------------------------- projectiles: one shared world
function projectileScene(mod: SimModule, p: Params, s: Settings, ents: REnt[]): Result {
  const scale = Number(p.ws_scale ?? 5);
  const launchers = ents.filter((e) => e.kind === 'proj'), targets = ents.filter((e) => e.kind === 'target');
  if (!launchers.length) return emptyResult('no launcher in the scene: press E and add one (a target alone does nothing)');
  const items = launchers.map((e) => {
    // launch height = how far above the ground it stands; it aims at the nearest target
    const h0 = Math.max(0, (GROUND - e.y) * scale), x0 = e.x * scale;
    const tgt = targets.slice().sort((a, b) => Math.abs(a.x - e.x) - Math.abs(b.x - e.x))[0];
    const pp: Params = { ...e.v, h0, tx: tgt ? (tgt.x - e.x) * scale : 0, ty: tgt ? Math.max(0, (GROUND - tgt.y) * scale) : 0, tol: tgt ? Number(tgt.v.tol ?? 2) : 1 };
    const res = mod.run(pp, s);
    if (!tgt) { res.targets = []; res.scalars = res.scalars.filter((q) => !/target|hit/i.test(q.l)); }
    return { tag: e.name, name: e.name, res, sprite: e.sprite, x0, h0, tgt };
  });
  const out: Result = items.length === 1 ? { ...items[0].res } : merge(items, true);
  const W = SCENE_W * scale;
  let ymax = 10;
  for (const it of items) { const Y = it.res.cols.indexOf('y'); for (const rw of it.res.rows) ymax = Math.max(ymax, rw[Y] * 1.1); }
  for (const t of targets) ymax = Math.max(ymax, (GROUND - t.y) * scale * 1.15);
  const tOf = (k: number) => out.rows[Math.min(k, out.rows.length - 1)][0];
  const rowAt = (r: Result, t: number) => { const R = r.rows; let lo = 0, hi = R.length - 1; if (t >= R[hi][0]) return hi; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m][0] <= t) lo = m; else hi = m; } return lo; };
  out.draw = (G: Gfx, k: number) => {
    const t = tOf(k);
    G.view(0, W, -0.04 * ymax, ymax, 18, false);
    G.ground(0, W, 0);
    for (const tg of targets) {
      const tx = tg.x * scale, ty = Math.max(0, (GROUND - tg.y) * scale), tol = Number(tg.v.tol ?? 2);
      const hit = items.some((it) => it.tgt === tg && it.res.targets?.[0]?.hit);
      if (ty > 0) G.line(tx, 0, tx, ty, COL.dim, 1, [2, 3]);
      G.circle(tx, ty, Math.max(5, tol * G.sx), hit ? COL.c : COL.d, false, true);
      G.circle(tx, ty, 2, hit ? COL.c : COL.d, true, true);
      G.textPx(hit ? 'HIT' : tg.name, G.X(tx) + 8, G.Y(ty) - 8, hit ? COL.c : COL.dim);
    }
    for (const it of items) {
      const r = it.res, X = r.cols.indexOf('x'), Y = r.cols.indexOf('y'), j = rowAt(r, t);
      if (it.h0 > 0) G.line(it.x0, 0, it.x0, it.h0, COL.dim, 3);
      G.path(r.rows.map((q) => it.x0 + q[X]), r.rows.map((q) => q[Y]), COL.grid);
      G.path(r.rows.slice(0, j + 1).map((q) => it.x0 + q[X]), r.rows.slice(0, j + 1).map((q) => q[Y]), spriteColor(it.sprite));
      const q = r.rows[j];
      drawSprite(G.ctx, SPRITES[it.sprite] ?? SPRITES.cannonball, G.X(it.x0 + q[X]), G.Y(q[Y]) + 6, 2);
    }
    G.hud([`t=${t.toFixed(3)} s   ${items.length} launcher${items.length > 1 ? 's' : ''} · ${targets.length} target${targets.length === 1 ? '' : 's'} · ${scale} m per cell`,
      items.map((it) => `${it.name}: ${it.res.targets?.[0] ? (it.res.targets[0].hit ? 'HIT' : `miss ${it.res.targets[0].err.toFixed(2)} m`) : 'no target'}`).join('  ·  ')]);
  };
  out.notes = [`launch height = where each launcher stands above the ground (${scale} m per grid cell)`, ...(out.notes ?? [])];
  return out;
}

interface Item { tag: string; name: string; res: Result; sprite?: string }

/** simple, compound and double pendulums drawn together from one ceiling (the merged result keeps the data) */
function pendulumFrame(out: Result, items: Item[], simple: REnt[], others: REnt[], scale: number): Result {
  const px = (e: REnt) => (e.x - SCENE_W / 2) * scale;
  const rowAt = (r: Result, t: number) => { const R = r.rows; let lo = 0, hi = R.length - 1; if (t >= R[hi][0]) return R[hi]; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m][0] <= t) lo = m; else hi = m; } return R[lo]; };
  const reach = (e: REnt) => Number(e.v.L ?? 1) + (e.v.type === 'double' ? Number(e.v.L2 ?? 1) : 0) + Number(e.v.r ?? 0.1);
  const all = [...simple, ...others], extent = Math.max(...all.map(reach)) * 1.1;
  const xs = [Math.min(...all.map(px)) - extent, Math.max(...all.map(px)) + extent];
  const simpleRes = simple.length ? items[0].res : null, otherRes = items.slice(simple.length ? 1 : 0).map((it) => it.res);
  out.draw = (G: Gfx, k: number) => {
    const t = out.rows[Math.min(k, out.rows.length - 1)][0];
    G.view(xs[0], xs[1], -extent, extent * 0.15);
    G.line(xs[0], 0, xs[1], 0, COL.fg, 3);
    if (simpleRes) {
      const rw = rowAt(simpleRes, t);
      simple.forEach((q, i) => { const bx = rw[3 + 4 * i], by = rw[4 + 4 * i], r = Number(q.v.r ?? 0.1); G.line(px(q), 0, bx, by, COL.dim, 1); G.circle(bx, by, r, spriteColor(q.sprite), true); G.circle(bx, by, r, COL.bg); });
    }
    others.forEach((q, i) => {
      const r = otherRes[i], rw = rowAt(r, t), x0 = px(q), col = spriteColor(q.sprite);
      if (q.v.type === 'double') {
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((c) => rw[r.cols.indexOf(c)]);
        G.line(x0, 0, x0 + x1, y1, COL.dim, 1); G.line(x0 + x1, y1, x0 + x2, y2, COL.dim, 1);
        G.circle(x0 + x1, y1, 4, col, true, true); G.circle(x0 + x2, y2, 4, col, true, true);
      } else {
        const th = rw[r.cols.indexOf('theta')], L = Number(q.v.L ?? 1);
        G.line(x0, 0, x0 + L * Math.sin(th), -L * Math.cos(th), col, 4);
      }
    });
    G.hud([`t=${t.toFixed(3)} s  ${all.length} pendulums from one ceiling`, 'simple pendulums can hit each other; compound and double ones swing on their own']);
  };
  return out;
}

/** combine several results into one: tiled drawing, prefixed columns/charts/results/checks */
export function merge(items: Item[], timeBased: boolean): Result {
  const c0 = items[0].res.cols[0];
  const shared = timeBased && items.every((it) => it.res.cols[0] === c0 && it.res.rows.length > 1);
  // master grid: the item reaching furthest in time (shared axis) or the longest table (progress)
  const master = items.reduce((a, it) => (shared ? (last(it.res)[0] > last(a.res)[0] ? it : a) : it.res.rows.length > a.res.rows.length ? it : a), items[0]);
  const M = master.res.rows;
  const rowOf = (it: Item, k: number) => {
    const R = it.res.rows;
    if (it === master) return Math.min(k, R.length - 1);
    if (shared) {
      const t = M[k][0];
      if (t >= R[R.length - 1][0]) return R.length - 1;
      let lo = 0, hi = R.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R[mid][0] <= t) lo = mid; else hi = mid; }
      return lo;
    }
    return Math.round((k / Math.max(1, M.length - 1)) * (R.length - 1));
  };
  const cols = [shared ? c0 : 'step', ...items.flatMap((it) => it.res.cols.slice(1).map((c) => `${it.tag} · ${c}`))];
  const rows = M.map((mr, k) => [shared ? mr[0] : k, ...items.flatMap((it) => it.res.rows[rowOf(it, k)].slice(1))]);
  const byId = new Map<string, Chart>();
  for (const it of items) for (const ch of it.res.charts) {
    const id = `${ch.id}|${ch.title}`;
    const ex = byId.get(id) ?? { ...ch, tAxis: ch.tAxis && shared, series: [] };
    ex.series = [...ex.series, ...ch.series.map((s) => ({ ...s, name: `${it.tag}:${s.name}` }))];
    byId.set(id, ex);
  }
  const pre = <T extends { l: string }>(it: Item, a: T[] | undefined) => (a ?? []).map((x) => ({ ...x, l: `${it.tag} · ${x.l}` }));
  const checks: Check[] = items.flatMap((it) => pre(it, it.res.checks));
  const notes = [...new Set(items.flatMap((it) => (it.res.notes ?? []).map((nt) => (it === items[0] ? nt : `${it.tag}: ${nt}`))))];
  if (cols.length > 40) notes.unshift(`⚠ ${cols.length - 1} data columns from ${items.length} simulations: the table will be wide`);
  return {
    cols, rows, checks, notes,
    charts: [...byId.values()].slice(0, 10),
    scalars: items.flatMap((it) => pre(it, it.res.scalars)),
    targets: items.flatMap((it) => pre(it, it.res.targets)),
    fbd: items[0].res.fbd ? (k) => items[0].res.fbd!(rowOf(items[0], k)) : undefined,
    draw(G: Gfx, k: number) {
      // one tile per simulation, all on the same clock
      const n = items.length, nc = Math.ceil(Math.sqrt(n * (G.W / Math.max(1, G.H)) / 1.6)) || 1, cc = Math.min(n, Math.max(1, nc)), rr = Math.ceil(n / cc);
      const tw = G.W / cc, th = G.H / rr;
      items.forEach((it, i) => {
        const x = (i % cc) * tw, y = Math.floor(i / cc) * th;
        const g = G.ctx;
        g.save();
        g.translate(x, y);
        g.beginPath(); g.rect(0, 0, tw, th); g.clip();
        try { const sub = new Gfx(G.cv, { ctx: g, W: tw, H: th }); it.res.draw?.(sub, rowOf(it, k)); } catch (e) { console.error(e); }
        // object badge in the tile corner: pixel-art sprite + name
        g.fillStyle = COL.bg;
        g.fillRect(tw - 150, 0, 150, 30);
        if (it.sprite && SPRITES[it.sprite]) drawSprite(g, SPRITES[it.sprite], tw - 132, 26, 2);
        g.fillStyle = it === items[0] ? COL.dim : COL.f;
        g.font = '14px VT323, monospace';
        g.textAlign = 'left';
        g.fillText(it.name.slice(0, 18), tw - 112, 18);
        g.strokeStyle = '#2b3036';
        g.strokeRect(0.5, 0.5, tw - 1, th - 1);
        g.restore();
      });
    },
  };
}
const last = (r: Result) => r.rows[r.rows.length - 1];
