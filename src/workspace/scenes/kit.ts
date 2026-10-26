// Shared helpers for the one-frame scenes: every object of a simulation lives in the same world, on the same
// clock, and acts on the others. Scene cell (x, y) maps to metres via the scene scale (y up from the ground).
import type { Check, Chart, Params, Result, Settings, ParamDef } from '../../core/types';
import { step, type F } from '../../core/num';
import { COL, type Gfx } from '../../core/gfx';
import { SPRITES, drawSprite } from '../sprites';
import { SCENE_W, SCENE_H, GROUND, type Ent } from '../engines';

export { GROUND, SCENE_W, SCENE_H, COL, SPRITES, drawSprite };
export type { Ent, Gfx, Check, Chart, Params, Result, Settings, ParamDef };

export const n = (v: unknown, d = 0) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
export const str = (v: unknown, d = '') => (v === undefined ? d : String(v));
/** record every k-th step so a run keeps ≤ ~800 rows */
export const every = (steps: number) => Math.max(1, Math.ceil(steps / 800));

/** world position of an object in metres: x from the left edge, y up from the ground line */
export const wx = (e: Ent, scale: number) => e.x * scale;
export const wy = (e: Ent, scale: number) => (GROUND - e.y) * scale;

/** scene scale parameter (metres per grid cell) */
export const scaleDef = (v: number, d = 'Size of one editor grid cell: sets how far apart objects really are.'): ParamDef =>
  ({ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v, min: 1e-6, s: v / 5, d });

export function energyCheck(l: string, exp: number, act: number, scale: number, method: string, rel = 2e-3): Check {
  return { l: `${l}${method === 'rk4' ? '' : ' (first-order method)'}`, exp, act, u: 'J', abs: rel * Math.max(Math.abs(scale), 1e-30), ref: method !== 'rk4' };
}

/** run y' = f over s.steps steps, calling rec at recorded steps; returns the final state */
export function simulate(f: F, y0: number[], s: Settings, rec: (t: number, y: number[]) => void, nq?: number, after?: (t: number, y: number[]) => number[]): number[] {
  let y = y0;
  rec(0, y);
  const ev = every(s.steps);
  for (let k = 1; k <= s.steps; k++) {
    y = step(f, (k - 1) * s.dt, y, s.dt, s.method, nq);
    if (after) y = after(k * s.dt, y);
    if (k % ev === 0 || k === s.steps) rec(k * s.dt, y);
  }
  return y;
}

/** time-series chart from table columns */
export function tchart(cols: string[], rows: number[][], id: string, title: string, names: string[], yl = ''): Chart {
  return { id, title, xl: cols[0], yl, tAxis: true, series: names.filter((nm) => cols.includes(nm)).map((nm) => ({ name: nm, x: rows.map((r) => r[0]), y: rows.map((r) => r[cols.indexOf(nm)]) })) };
}

/** a sprite drawn standing on world point (x, y) */
export function sprite(G: Gfx, name: string, x: number, y: number, px = 2, alpha = 1) {
  drawSprite(G.ctx, SPRITES[name] ?? ['s'], G.X(x), G.Y(y), px, alpha);
}
/** a sprite centred on world point (x, y) */
export function spriteC(G: Gfx, name: string, x: number, y: number, px = 2, alpha = 1) {
  const rows = SPRITES[name] ?? ['s'];
  drawSprite(G.ctx, rows, G.X(x), G.Y(y) + (rows.length * px) / 2, px, alpha);
}
export function label(G: Gfx, s: string, x: number, y: number, c = COL.dim, dy = -10) {
  G.textPx(s, G.X(x) + 4, G.Y(y) + dy, c);
}

/** the whole scene in view: SCENE_W cells wide, ground at y = 0 */
export function sceneView(G: Gfx, scale: number, below = SCENE_H - GROUND, pad = 14) {
  G.view(0, SCENE_W * scale, -below * scale, GROUND * scale, pad, true);
}

export const emptyScene = (note: string): Result => ({ cols: ['t'], rows: [[0]], scalars: [], checks: [], charts: [], notes: [note], draw: (G) => G.hud([note]) });

/** index of the nearest object (in cells) among a list */
export function nearest<T extends { x: number; y: number }>(list: T[], x: number, y: number): T | undefined {
  let best: T | undefined, bd = Infinity;
  for (const q of list) { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } }
  return best;
}
/** heat-map colour for a value in [0, 1] (cold blue → hot red) */
export function heatCol(f: number) {
  f = Math.max(0, Math.min(1, f));
  const r = Math.round(60 + 195 * f), g = Math.round(90 + 110 * (1 - Math.abs(f - 0.5) * 2)), b = Math.round(230 - 200 * f);
  return `rgb(${r},${g},${b})`;
}
