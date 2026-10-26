// EDIT: per-module scene editor. Place the module's objects (and real, pixel-art ones), then set what a
// person could set by hand: drag from an object to throw / launch / pull it back (the arrow is its
// velocity), shift-drag or g to move it. Environment values (gravity, air...) stay in the outside list.
import type { Params, SimModule, Settings } from '../core/types';
import { COL } from '../core/gfx';
import { CATALOG, GROUND, type Aim, type Kind, type Preset } from '../workspace/catalog';
import { parseEnts, placeObject, removeObject, moveObject, kindFields, type RawEnt } from '../workspace/wrap';
import { SPRITES, drawSprite } from '../workspace/sprites';
import { SCENE_W, SCENE_H, spriteColor } from '../workspace/engines';

export interface EditState {
  mod: SimModule; p: Params; s: Settings;
  cx: number; cy: number; pal: number; grab: number | null;
  /** object being aimed with the keyboard (v): the cursor is the arrow tip */
  aim: number | null;
  undo: Params[]; redo: Params[];
}
type PalItem = { kind?: Kind; preset?: Preset; label: string; sprite: string; desc: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const DEG = Math.PI / 180;

export function palette(mod: SimModule): PalItem[] {
  const cat = CATALOG[mod.id];
  if (!cat) return [];
  return [
    ...cat.kinds.map((k) => ({ kind: k, label: `+ new ${k.name}`, sprite: k.sprite, desc: k.desc })),
    ...cat.presets.map((pr) => ({ preset: pr, label: pr.name, sprite: pr.sprite, desc: pr.desc })),
  ];
}
export function newEdit(mod: SimModule, p: Params, s: Settings): EditState {
  // fill in object values that are still at their defaults so the editor can show and change them
  const q: Params = { ...p };
  for (const d of mod.dynParams?.(p) ?? []) if (q[d.k] === undefined) q[d.k] = d.v;
  const eng = CATALOG[mod.id]?.engine;
  return { mod, p: q, s, cx: Math.floor(SCENE_W / 2), cy: eng === 'pendulums' ? 2 : eng === 'projectiles' ? GROUND : Math.floor(SCENE_H / 2), pal: 0, grab: null, aim: null, undo: [], redo: [] };
}
const snap = (ed: EditState) => { ed.undo.push({ ...ed.p }); if (ed.undo.length > 100) ed.undo.shift(); ed.redo = []; };
const num = (v: unknown, d: number) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const fv = (ed: EditState, e: RawEnt, f: string, d: number) => num(ed.p[`e${e.id}_${f}`], d);
const kindOf = (ed: EditState, e: RawEnt) => CATALOG[ed.mod.id]?.kinds.find((k) => k.kind === e.k);
const r4 = (x: number) => +x.toPrecision(4);
const grounded = (mod: SimModule) => CATALOG[mod.id]?.engine === 'projectiles' || !!CATALOG[mod.id]?.ground;

/** object nearest the cursor (within 3 cells of where it is drawn) */
function under(ed: EditState, x = ed.cx, y = ed.cy): RawEnt | undefined {
  let best: RawEnt | undefined, bd = 3;
  for (const e of parseEnts(ed.p)) {
    const [ax, ay] = anchor(ed, e);
    const d = Math.hypot(ax - x, ay - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
/** where an object is drawn in the scene (pendulum bobs hang below their pivot) */
function anchor(ed: EditState, e: RawEnt): [number, number] {
  if (CATALOG[ed.mod.id]?.engine === 'pendulums') {
    const sc = num(ed.p.ws_scale, 0.1), L = fv(ed, e, 'L', 1) / sc, th = fv(ed, e, 'th', 0) * DEG;
    return [e.x + L * Math.sin(th), 1 + L * Math.cos(th)];
  }
  return [e.x, e.y];
}

/** tip of an object's aim arrow, in scene cells (screen y grows downwards) */
function aimTip(ed: EditState, e: RawEnt, a: Aim): [number, number] {
  const [ax, ay] = anchor(ed, e);
  switch (a.kind) {
    case 'vel': return [ax + fv(ed, e, a.fx, 0) / a.per, ay - fv(ed, e, a.fy, 0) / a.per];
    case 'polar': { const L = fv(ed, e, a.speed, 0) / a.per, th = fv(ed, e, a.angle, 0) * DEG; return [ax + L * Math.cos(th), ay - L * Math.sin(th)]; }
    case 'len': return [ax + fv(ed, e, a.field, 0) / a.per, ay];
    case 'pull': return [ax, ay];
  }
}
/** set an object's hand-set values from an arrow ending at (tx, ty) */
function applyAim(ed: EditState, e: RawEnt, a: Aim, tx: number, ty: number) {
  const [ax, ay] = anchor(ed, e), k = (f: string) => `e${e.id}_${f}`;
  const p: Params = { ...ed.p };
  const kind = kindOf(ed, e);
  const minOf = (f: string) => (kind ? kindFields(ed.mod, kind).find((d) => d.k === f)?.min : undefined) ?? -Infinity;
  switch (a.kind) {
    case 'vel':
      p[k(a.fx)] = r4((tx - ax) * a.per); p[k(a.fy)] = r4(-(ty - ay) * a.per);
      for (const [f, v] of Object.entries(a.set ?? {})) p[k(f)] = v;
      break;
    case 'polar':
      p[k(a.speed)] = r4(Math.hypot(tx - ax, ty - ay) * a.per);
      p[k(a.angle)] = r4(Math.atan2(-(ty - ay), tx - ax) / DEG);
      break;
    case 'len': p[k(a.field)] = r4(Math.max(minOf(a.field), (tx - ax) * a.per)); break;
    case 'pull': {
      // the bob goes where it is dragged: rope length and pull-back angle follow
      const sc = num(ed.p.ws_scale, 0.1), dx = tx - e.x, dy = Math.max(0.2, ty - 1);
      p[k('L')] = r4(Math.max(0.01, Math.hypot(dx, dy) * sc));
      p[k('th')] = r4(Math.atan2(dx, dy) / DEG);
      break;
    }
  }
  ed.p = p;
}
/** short description of what the aim currently says */
function aimText(ed: EditState, e: RawEnt, a: Aim): string {
  const kind = kindOf(ed, e);
  const u = (f: string) => (kind ? kindFields(ed.mod, kind).find((d) => d.k === f)?.u : '') ?? '';
  switch (a.kind) {
    case 'vel': { const vx = fv(ed, e, a.fx, 0), vy = fv(ed, e, a.fy, 0); return `${r4(Math.hypot(vx, vy))} ${u(a.fx)} at ${r4(Math.atan2(vy, vx) / DEG)}°`; }
    case 'polar': return `${fv(ed, e, a.speed, 0)} ${u(a.speed)} at ${fv(ed, e, a.angle, 0)}°`;
    case 'len': return `${a.field} = ${fv(ed, e, a.field, 0)} ${u(a.field)}`;
    case 'pull': return `L = ${fv(ed, e, 'L', 1)} m · ${fv(ed, e, 'th', 0)}°`;
  }
}

// the field + / - and < / > change on the object under the cursor
const SIZE: Record<string, [string, number]> = { pendulums: ['r', 1.15], balls: ['r', 1.15], nbody: ['R', 1.3] };

export const EDIT_KEYS: [string, string][] = [
  ['h j k l', 'move cursor (count: 5l) · H J K L move 5'],
  ['[ ] or click', 'choose what to add'],
  ['space / a / click', 'add it at the cursor'],
  ['drag  or  v', 'aim: drag from an object (or v, then hjkl) to throw / launch / pull it back'],
  ['shift-drag / g', 'move an object (where it starts)'],
  ['x / right-click', 'delete the object under the cursor'],
  ['y', 'duplicate the object under the cursor'],
  ['Tab', 'jump to the next object'],
  ['+ / -', 'bigger / smaller (ball size, planet radius)'],
  ['< / >', 'shorter / longer rope (pendulums)'],
  ['u / Ctrl-r', 'undo / redo'],
  ['Enter or q', 'done → each object\'s values are in the list'],
];

export interface EditView { el: HTMLElement; refresh(): void; cursor(): void; layout(): void }

export function editView(ed: EditState, onChange: () => void): EditView {
  const el = document.createElement('div');
  el.className = 'editor';
  el.innerHTML = `<div class="ecanvas"><canvas></canvas></div><div class="eside"></div>`;
  const cv = el.querySelector('canvas') as HTMLCanvasElement;
  const side = el.querySelector('.eside') as HTMLElement;
  let cp = 8, ox = 0, oy = 0;
  const pal = palette(ed.mod);
  const cat = CATALOG[ed.mod.id];

  const arrow = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, c: string) => {
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 2) return;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 8 * ux + 4 * uy, y1 - 8 * uy - 4 * ux); g.lineTo(x1 - 8 * ux - 4 * uy, y1 - 8 * uy + 4 * ux); g.fill();
    g.lineWidth = 1;
  };

  const draw = () => {
    const box = cv.parentElement!;
    const W = box.clientWidth, H = box.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
    cp = Math.max(4, Math.floor(Math.min((W - 16) / SCENE_W, (H - 16) / SCENE_H)));
    ox = Math.floor((W - cp * SCENE_W) / 2); oy = Math.floor((H - cp * SCENE_H) / 2);
    const eng = cat?.engine;
    g.fillStyle = eng === 'balls' ? '#123322' : eng === 'nbody' ? '#06070a' : '#15181c';
    g.fillRect(ox, oy, cp * SCENE_W, cp * SCENE_H);
    g.fillStyle = '#23272d';
    for (let y = 0; y <= SCENE_H; y += 4) for (let x = 0; x <= SCENE_W; x += 4) g.fillRect(ox + x * cp, oy + y * cp, 1, 1);
    const X = (x: number) => ox + x * cp, Y = (y: number) => oy + y * cp;
    if (eng === 'pendulums') { g.fillStyle = COL.fg; g.fillRect(ox, oy + cp - 2, cp * SCENE_W, 3); }
    if (eng === 'balls' && ed.p.ws_walls !== 'off') { g.strokeStyle = '#8b5a2b'; g.lineWidth = 3; g.strokeRect(ox, oy, cp * SCENE_W, cp * SCENE_H); g.lineWidth = 1; }
    if (grounded(ed.mod)) {
      g.fillStyle = '#2a2219'; g.fillRect(ox, Y(GROUND), cp * SCENE_W, cp * (SCENE_H - GROUND));
      g.fillStyle = '#8b5a2b'; g.fillRect(ox, Y(GROUND) - 1, cp * SCENE_W, 2);
    }
    const ents = parseEnts(ed.p);
    // scene guides: tracks, ramps, walls, rails, optical axes … drawn from the objects' current values
    try { cat?.guide?.(g, X, Y, cp, ed.p, ents); } catch (err) { console.error(err); }
    const sel = under(ed);
    g.font = '13px VT323, monospace';
    for (const e of ents) {
      const v = (f: string, d: number) => fv(ed, e, f, d);
      const isSel = sel?.id === e.id || ed.grab === e.id || ed.aim === e.id;
      const kind = kindOf(ed, e);
      if (eng === 'pendulums') {
        const sc = num(ed.p.ws_scale, 0.1), r = Math.max(0.3, v('r', 0.1) / sc);
        const [bx, by] = anchor(ed, e);
        g.strokeStyle = isSel ? COL.f : COL.dim; g.beginPath(); g.moveTo(X(e.x), Y(1)); g.lineTo(X(bx), Y(by)); g.stroke();
        g.fillStyle = spriteColor(e.sp); g.beginPath(); g.arc(X(bx), Y(by), r * cp, 0, 2 * Math.PI); g.fill();
        if (isSel) { g.strokeStyle = COL.f; g.stroke(); }
      } else if (eng === 'balls') {
        const sc = num(ed.p.ws_scale, 0.05), r = Math.max(0.25, v('r', 0.03) / sc);
        g.fillStyle = spriteColor(e.sp); g.beginPath(); g.arc(X(e.x), Y(e.y), r * cp, 0, 2 * Math.PI); g.fill();
        if (isSel) { g.strokeStyle = COL.f; g.beginPath(); g.arc(X(e.x), Y(e.y), r * cp + 2, 0, 2 * Math.PI); g.stroke(); }
      } else {
        const rows = SPRITES[e.sp] ?? ['s'];
        const px = Math.max(2, Math.floor(cp / 2));
        // launchers stand on a post: their height above the ground is the launch height
        if (grounded(ed.mod) && e.y < GROUND) { g.strokeStyle = COL.dim; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(e.x), Y(e.y)); g.lineTo(X(e.x), Y(GROUND)); g.stroke(); g.setLineDash([]); }
        drawSprite(g, rows, X(e.x), Y(e.y) + (rows.length * px) / 2, px, ed.grab === e.id ? 0.6 : 1);
        if (isSel) { g.strokeStyle = COL.f; const w = Math.max(...rows.map((q) => q.length)) * px; g.strokeRect(X(e.x) - w / 2 - 2, Y(e.y) - (rows.length * px) / 2 - 2, w + 4, rows.length * px + 4); }
      }
      // the aim arrow: what the object is thrown / launched with
      const a = kind?.aim;
      if (a && a.kind !== 'pull') {
        const [ax, ay] = anchor(ed, e), [tx, ty] = aimTip(ed, e, a);
        if (!(a.kind === 'vel' && a.set && ed.p[`e${e.id}_orbit`] === 'circular')) arrow(g, X(ax), Y(ay), X(tx), Y(ty), isSel ? COL.f : COL.a);
      }
      // object numbers keep close objects readable; the selected one shows its name and aim
      g.fillStyle = isSel ? COL.f : COL.dim;
      g.textAlign = 'center';
      const [ax, ay] = anchor(ed, e);
      let label = isSel ? `${ents.indexOf(e) + 1}. ${e.n}` : String(ents.indexOf(e) + 1);
      if (isSel && a) label += ` · ${aimText(ed, e, a)}`;
      if (isSel && grounded(ed.mod) && e.y < GROUND && e.k !== 'target') label += ` · h ${r4((GROUND - e.y) * num(ed.p.ws_scale, 5))} m`;
      g.fillText(label, X(ax), Y(ay) - (eng ? 10 : 14));
      g.textAlign = 'left';
    }
    // cursor (with a ghost of what space will add)
    const it = pal[ed.pal];
    if (it && ed.grab === null && ed.aim === null) drawSprite(g, SPRITES[it.sprite] ?? ['s'], X(ed.cx), Y(ed.cy) + 6, Math.max(2, Math.floor(cp / 3)), 0.35);
    g.strokeStyle = ed.aim !== null ? COL.a : ed.grab !== null ? COL.c : '#ffffff';
    g.lineWidth = 2;
    g.strokeRect(X(ed.cx) - cp / 2, Y(ed.cy) - cp / 2, cp, cp);
    g.lineWidth = 1;
  };

  const sidebar = () => {
    const ents = parseEnts(ed.p);
    const sel = under(ed);
    const it = pal[ed.pal];
    const fieldsOf = (e: RawEnt) => Object.keys(ed.p).filter((k) => k.startsWith(`e${e.id}_`) && !k.includes('$')).map((k) => `${k.slice(`e${e.id}_`.length)} ${ed.p[k]}`).join(' · ');
    const mode = ed.aim !== null ? ' · <b class="acc">aiming (hjkl, v to finish)</b>' : ed.grab !== null ? ' · <b class="acc">moving</b>' : '';
    side.innerHTML = `<div class="etitle">EDIT · ${esc(ed.mod.name)}</div>
      <div class="dim">${esc(cat?.where ?? '')} · cursor ${ed.cx},${ed.cy}${mode}</div>
      <div class="dim">gravity, air and other surroundings are in the outside list, not here</div>
      <div class="esec">add ( [ ] or click )</div>
      <div class="epal2">${pal.map((q, i) => `<div class="pm${i === ed.pal ? ' sel' : ''}" data-i="${i}"><canvas width="44" height="30" data-sp="${esc(q.sprite)}"></canvas><span>${esc(q.label)}</span></div>`).join('')}</div>
      ${it ? `<div class="pinfo"><b>${esc(it.label)}</b> — ${esc(it.desc)}</div>` : ''}
      <div class="esec">objects (${ents.length})</div>
      <div class="eobj">${ents.length ? ents.map((e, i) => `<div class="${sel?.id === e.id ? 'acc' : ''}">${i + 1}. <b>${esc(e.n)}</b> <span class="dim">${esc(fieldsOf(e))}</span></div>`).join('') : '<span class="dim">nothing here yet — move the cursor and press space</span>'}</div>
      <div class="esec">keys</div>
      <div class="ekeys">${EDIT_KEYS.filter(([k]) => (k !== '< / >' || cat?.engine === 'pendulums') && (k !== '+ / -' || (!!cat?.engine && !!SIZE[cat.engine])) && (k !== 'drag  or  v' || cat?.kinds.some((q) => q.aim))).map(([k, d]) => `<span class="k">${esc(k)}</span><span>${esc(d)}</span>`).join('')}</div>`;
    side.querySelectorAll('canvas[data-sp]').forEach((c) => {
      const cc = c as HTMLCanvasElement, rows = SPRITES[cc.dataset.sp!] ?? ['s'];
      const px = Math.max(1, Math.floor(Math.min(40 / Math.max(...rows.map((q) => q.length)), 26 / rows.length)));
      drawSprite(cc.getContext('2d')!, rows, 22, 28, px);
    });
  };

  // mouse: click empty space = add · drag from an object = aim it · shift-drag = move it · right-click = delete
  let drag: { id: number; mode: 'aim' | 'move' } | null = null;
  const cell = (e: MouseEvent): [number, number] => {
    const r = cv.getBoundingClientRect();
    return [Math.max(0, Math.min(SCENE_W - 1, (e.clientX - r.left - ox) / cp)), Math.max(0, Math.min(SCENE_H - 1, (e.clientY - r.top - oy) / cp))];
  };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('mousedown', (e) => {
    const [fx, fy] = cell(e);
    ed.cx = Math.round(fx); ed.cy = Math.round(fy);
    const u = under(ed, fx, fy);
    if (e.button === 2) { if (u) { snap(ed); ed.p = removeObject(ed.p, u.id); } }
    else if (u) {
      snap(ed);
      drag = { id: u.id, mode: e.shiftKey || !kindOf(ed, u)?.aim ? 'move' : 'aim' };
    } else add(ed);
    draw(); sidebar(); onChange();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag || !el.isConnected) return;
    const [fx, fy] = cell(e);
    const u = parseEnts(ed.p).find((q) => q.id === drag!.id);
    if (!u) { drag = null; return; }
    ed.cx = Math.round(fx); ed.cy = Math.round(fy);
    if (drag.mode === 'move') ed.p = moveObject(ed.p, u.id, ed.cx, CATALOG[ed.mod.id]?.engine === 'pendulums' ? u.y : ed.cy);
    else applyAim(ed, u, kindOf(ed, u)!.aim!, fx, fy);
    draw(); sidebar();
  });
  window.addEventListener('mouseup', () => { if (drag) { drag = null; onChange(); } });
  side.addEventListener('click', (e) => { const q = (e.target as HTMLElement).closest('.pm') as HTMLElement | null; if (q) { ed.pal = Number(q.dataset.i); draw(); sidebar(); } });
  return { el, refresh: () => { draw(); sidebar(); }, cursor: () => { draw(); sidebar(); }, layout: () => { draw(); sidebar(); } };
}

function add(ed: EditState) {
  const it = palette(ed.mod)[ed.pal];
  if (!it) return;
  snap(ed);
  ed.p = placeObject(ed.mod, ed.p, { preset: it.preset, kind: it.kind }, ed.cx, ed.cy, ed.s);
}

export function editKey(ed: EditState, k: string, n: number): 'done' | 'handled' | 'pass' {
  const pal = palette(ed.mod);
  const eng = CATALOG[ed.mod.id]?.engine;
  const mv = (dx: number, dy: number) => {
    ed.cx = Math.max(0, Math.min(SCENE_W - 1, ed.cx + dx * n));
    ed.cy = Math.max(0, Math.min(SCENE_H - 1, ed.cy + dy * n));
    const e = parseEnts(ed.p).find((q) => q.id === (ed.aim ?? ed.grab));
    if (!e) return;
    // aiming: the cursor is the arrow tip; moving: pendulums move by their pivot along the ceiling
    if (ed.aim !== null) applyAim(ed, e, kindOf(ed, e)!.aim!, ed.cx, ed.cy);
    else ed.p = moveObject(ed.p, e.id, ed.cx, eng === 'pendulums' ? e.y : ed.cy);
  };
  switch (k) {
    case 'h': case 'ArrowLeft': mv(-1, 0); return 'handled';
    case 'l': case 'ArrowRight': mv(1, 0); return 'handled';
    case 'k': case 'ArrowUp': mv(0, -1); return 'handled';
    case 'j': case 'ArrowDown': mv(0, 1); return 'handled';
    case 'H': n *= 5; mv(-1, 0); return 'handled';
    case 'L': n *= 5; mv(1, 0); return 'handled';
    case 'K': n *= 5; mv(0, -1); return 'handled';
    case 'J': n *= 5; mv(0, 1); return 'handled';
    case '[': ed.pal = (ed.pal - 1 + pal.length) % pal.length; return 'handled';
    case ']': ed.pal = (ed.pal + 1) % pal.length; return 'handled';
    case ' ': case 'a':
      if (ed.grab !== null || ed.aim !== null) { ed.grab = ed.aim = null; return 'handled'; }
      add(ed); return 'handled';
    case 'v': {
      if (ed.aim !== null) { ed.aim = null; return 'handled'; }
      const u = under(ed), a = u && kindOf(ed, u)?.aim;
      if (!u || !a) return 'handled';
      snap(ed);
      ed.grab = null; ed.aim = u.id;
      const [tx, ty] = aimTip(ed, u, a);
      ed.cx = Math.max(0, Math.min(SCENE_W - 1, Math.round(tx))); ed.cy = Math.max(0, Math.min(SCENE_H - 1, Math.round(ty)));
      return 'handled';
    }
    case 'x': case 'Delete': { const u = under(ed); if (u) { snap(ed); ed.p = removeObject(ed.p, u.id); } return 'handled'; }
    case 'g': {
      if (ed.grab !== null) { ed.grab = null; return 'handled'; }
      const u = under(ed);
      if (u) { snap(ed); ed.aim = null; ed.grab = u.id; ed.cx = Math.round(u.x); if (eng !== 'pendulums') ed.cy = Math.round(u.y); }
      return 'handled';
    }
    case 'y': {
      const u = under(ed);
      if (!u) return 'handled';
      snap(ed);
      const before = parseEnts(ed.p);
      const maxId = before.reduce((a, e) => Math.max(a, e.id), 0) + 1;
      const copy: RawEnt = { ...u, id: maxId, n: `${u.n.replace(/ #\d+$/, '')} #${maxId}`, x: u.x + 3 };
      const out: Params = { ...ed.p, _ents: JSON.stringify([...before, copy]) };
      for (const key of Object.keys(ed.p)) if (key.startsWith(`e${u.id}_`)) out[`e${maxId}_${key.slice(`e${u.id}_`.length)}`] = ed.p[key];
      ed.p = out;
      return 'handled';
    }
    case 'Tab': {
      const ents = parseEnts(ed.p);
      if (!ents.length) return 'handled';
      ed.aim = ed.grab = null;
      const cur = under(ed);
      const i = cur ? (ents.findIndex((e) => e.id === cur.id) + 1) % ents.length : 0;
      const [x, y] = anchor(ed, ents[i]);
      ed.cx = Math.round(x); ed.cy = Math.round(y);
      return 'handled';
    }
    case '+': case '=': case '-': {
      const u = under(ed);
      const sz = eng ? SIZE[eng] : undefined;
      if (!u || !sz) return 'handled';
      snap(ed);
      const key = `e${u.id}_${sz[0]}`;
      const f = k === '-' ? 1 / sz[1] : sz[1];
      ed.p = { ...ed.p, [key]: r4(num(ed.p[key], 0.1) * f) };
      return 'handled';
    }
    case '<': case '>': {
      const u = under(ed);
      if (!u || eng !== 'pendulums') return 'handled';
      snap(ed);
      const key = `e${u.id}_L`;
      ed.p = { ...ed.p, [key]: r4(Math.max(0.05, num(ed.p[key], 1) + (k === '>' ? 0.1 : -0.1) * n)) };
      return 'handled';
    }
    case 'u': { const s = ed.undo.pop(); if (s) { ed.redo.push(ed.p); ed.p = s; } return 'handled'; }
    case 'C-r': { const s = ed.redo.pop(); if (s) { ed.undo.push(ed.p); ed.p = s; } return 'handled'; }
    case 'Escape': ed.grab = ed.aim = null; return 'handled';
    case 'Enter': if (ed.aim !== null || ed.grab !== null) { ed.aim = ed.grab = null; return 'handled'; } return 'done';
    case 'q': return 'done';
    default: return 'pass';
  }
}

/** :add <name> — add a preset or kind by (partial) name at the cursor */
export function editAdd(ed: EditState, name: string): string {
  const q = name.toLowerCase();
  const pal = palette(ed.mod);
  const i = pal.findIndex((it) => it.label.toLowerCase().includes(q));
  if (i < 0) throw new Error(`can add: ${pal.map((it) => it.label).join(', ')}`);
  ed.pal = i;
  add(ed);
  return `added ${pal[i].label}`;
}
