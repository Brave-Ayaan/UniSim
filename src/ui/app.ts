import type { Params, Result, Settings, SimModule, Method, ParamDef, Chart } from '../core/types';
import { MODULES, findModule } from '../modules';
import { docFor } from '../modules/docs';
import { STEPS, type CoachCtx } from './tutorial';
import { editView, editKey, editAdd, newEdit, type EditState, type EditView } from './edit';
import { CATALOG } from '../workspace/catalog';
import { parseEnts } from '../workspace/wrap';
import { Gfx, PALETTE, COL } from '../core/gfx';
import { fmt, interp, maxOf, evalExpr } from '../core/num';
import { drawChart, revealChart, type ChartMap } from './chart';
import { checkPass, defaults, settingsFor, type CaseResult } from '../core/selftest';
import { pool } from '../core/pool';
import { saveText, openText } from './native';
import { watchView, watchKey, advance, canTimeSync, rowAt as rowAtRun, type WatchTab, type WatchRun } from './watch';

// ---------- state ----------
interface Goal { q: string; v: number; tol: number }
interface RunTab {
  kind: 'run'; id: number; title: string; mod: SimModule; p: Params; s: Settings;
  res?: Result; err?: string; ms: number; sel: number; focus: 'params' | 'table'; row: number;
  goals: Goal[]; undo: [Params, Settings][]; redo: [Params, Settings][]; playing: boolean; ran: boolean; fails: number;
  /** live playback: data revealed up to this row (null = complete result shown) */
  reveal: number | null;
  /** EDIT: per-module scene editor open */
  editing?: boolean;
  sed?: EditState;
  /** each simulation remembers its own setup when you switch between them */
  memory?: Record<string, { p: Params; s: Settings }>;
}
interface CmpRun { name: string; mod: SimModule; p: Params; s: Settings; res: Result }
interface CmpTab { kind: 'cmp'; id: number; title: string; runs: CmpRun[]; sweep?: { key: string; vals: number[] } }
interface PageTab { kind: 'index' | 'help' | 'selftest'; id: number; title: string; sel: number; filter: string; data?: CaseResult[] }
type Tab = RunTab | CmpTab | PageTab | WatchTab;

const S = {
  tabs: [] as Tab[],
  panes: [] as number[],
  ap: 0,
  mode: 'normal' as 'normal' | 'insert' | 'command' | 'search',
  msg: '',
  err: false,
  nextId: 1,
  speed: 1,
  lastSearch: '',
  /** playback streams data into charts/table (true) or only moves the cursor (false) */
  live: true,
  /** playback at exactly 1 simulated second per wall-clock second (×speed) */
  realtime: false,
  /** interactive tutorial state (null = guide closed) */
  coach: null as null | { step: number; tutId: number; seenLive: boolean; doneAt: number },
};
const views = new Map<number, View>();
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MAX_STEPS = 400000;

const cur = (): Tab | undefined => S.tabs.find((t) => t.id === S.panes[S.ap]);
const tabIndex = (id: number) => S.tabs.findIndex((t) => t.id === id);

function say(m: string, err = false) { S.msg = m; S.err = err; renderStatus(); }

// ---------- number formatting / parsing ----------
function fmtP(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(4).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(7)));
}
// safe parser (no eval): also keeps the app compatible with a strict desktop CSP
const evalNum = (s: string): number => evalExpr(s);

// ---------- param rows ----------
interface PRow { k: string; l: string; u?: string; def?: ParamDef; set?: 'method' | 'dt' | 'steps' }
/** environment parameters plus the per-object blocks of the scene */
const paramsOf = (t: { mod: SimModule; p: Params }): ParamDef[] => (t.mod.dynParams ? [...t.mod.params, ...t.mod.dynParams(t.p)] : t.mod.params);
function prows(t: RunTab): PRow[] {
  const r: PRow[] = paramsOf(t).filter((d) => !d.when || d.when(t.p)).map((d) => ({ k: d.k, l: d.l, u: d.u, def: d }));
  r.push({ k: '$method', l: 'integrator', set: 'method' }, { k: '$dt', l: 'timestep dt', set: 'dt', u: t.mod.id === 'fracture' ? 'cycles' : 's' }, { k: '$steps', l: t.mod.stepsLabel ?? 'iterations', set: 'steps' });
  return r;
}
const METHODS: Method[] = ['euler', 'semi', 'rk4'];

function pval(t: RunTab, r: PRow): string {
  if (r.set === 'method') return t.s.method;
  if (r.set === 'dt') return fmtP(t.s.dt);
  if (r.set === 'steps') return String(t.s.steps);
  const v = t.p[r.k] ?? r.def?.v;
  return typeof v === 'number' ? fmtP(v) : String(v ?? '');
}

function pushUndo(t: RunTab) { t.undo.push([{ ...t.p }, { ...t.s }]); if (t.undo.length > 200) t.undo.shift(); t.redo = []; }

function setParam(t: RunTab, k: string, raw: string | number, opts: { nudge?: number } = {}): boolean {
  if (k === '$method' || k === 'method') {
    let m: Method | undefined;
    if (opts.nudge) m = METHODS[(METHODS.indexOf(t.s.method) + opts.nudge + 3) % 3];
    else m = METHODS.find((x) => x.startsWith(String(raw).toLowerCase()));
    if (!m) { say(`unknown method ${raw} (euler|semi|rk4)`, true); return false; }
    pushUndo(t); t.s.method = m; return true;
  }
  if (k === '$dt' || k === 'dt' || k === '$steps' || k === 'steps') {
    const isDt = k.endsWith('dt');
    let v = typeof raw === 'number' ? raw : evalNum(raw);
    if (opts.nudge) v = isDt ? t.s.dt * (opts.nudge > 0 ? 2 : 0.5) ** Math.abs(opts.nudge) : Math.round(t.s.steps * (opts.nudge > 0 ? 1.25 : 0.8) ** Math.abs(opts.nudge));
    if (!(v > 0)) { say(`${k.replace('$', '')} must be > 0`, true); return false; }
    pushUndo(t);
    if (isDt) t.s.dt = v; else t.s.steps = Math.min(MAX_STEPS, Math.max(1, Math.round(v)));
    return true;
  }
  const d = paramsOf(t).find((q) => q.k === k || q.l.toLowerCase() === String(k).toLowerCase());
  if (!d) { say(`no parameter '${k}'`, true); return false; }
  if (d.o) {
    let v: string | undefined;
    if (opts.nudge) v = d.o[(d.o.indexOf(String(t.p[d.k] ?? d.v)) + opts.nudge + d.o.length * 10) % d.o.length];
    else v = d.o.find((x) => x.toLowerCase() === String(raw).toLowerCase()) ?? d.o.find((x) => x.toLowerCase().startsWith(String(raw).toLowerCase()));
    if (v === undefined) { say(`options: ${d.o.join(' | ')}`, true); return false; }
    pushUndo(t);
    t.p[d.k] = v;
    if (d.k === 'mode' && t.mod.modeSettings?.[v]) t.s = { ...t.s, ...t.mod.modeSettings[v] };
    return true;
  }
  let v = typeof raw === 'number' ? raw : evalNum(String(raw));
  if (opts.nudge) {
    const st = d.s ?? (Math.abs(Number(t.p[d.k] ?? d.v)) * 0.1 || 0.1);
    v = Number(t.p[d.k] ?? d.v) + opts.nudge * st;
    v = Number(v.toPrecision(12));
  }
  if (!Number.isFinite(v)) { say(`not a number: ${raw}`, true); return false; }
  if (d.min !== undefined && v < d.min) { say(`${d.l}: clamped to min ${d.min}`); v = d.min; }
  if (d.max !== undefined && v > d.max) { say(`${d.l}: clamped to max ${d.max}`); v = d.max; }
  pushUndo(t);
  t.p[d.k] = v;
  return true;
}

// ---------- tabs ----------
function newRun(mod: SimModule, p?: Params, s?: Settings, title?: string): RunTab {
  const pp = p ? { ...defaults(mod), ...p } : defaults(mod);
  const t: RunTab = { kind: 'run', id: S.nextId++, title: title ?? mod.id, mod, p: pp, s: s ? { ...s } : settingsFor(mod, pp), ms: 0, sel: 0, focus: 'params', row: 0, goals: [], undo: [], redo: [], playing: false, ran: false, fails: 0, reveal: null };
  const same = S.tabs.filter((q) => q.kind === 'run' && q.mod === mod).length;
  if (!title && same) t.title = `${mod.id}#${same + 1}`;
  return t;
}
function addTab(t: Tab, show = true) {
  S.tabs.push(t);
  if (show) showTab(t.id);
  if (t.kind === 'run') runTab(t);
  save();
}
function showTab(id: number) {
  const other = S.panes.indexOf(id);
  if (other >= 0) { S.ap = other; } else { if (!S.panes.length) S.panes.push(id); else S.panes[S.ap] = id; }
  layout();
}
function closeTab(id: number) {
  const i = tabIndex(id);
  if (i < 0) return;
  const t = S.tabs[i];
  if (t.kind === 'run' || t.kind === 'watch') t.playing = false;
  S.tabs.splice(i, 1);
  views.get(id)?.el.remove();
  views.delete(id);
  const pi = S.panes.indexOf(id);
  if (pi >= 0) {
    const vis = new Set(S.panes);
    const repl = S.tabs.find((q) => !vis.has(q.id));
    if (repl) S.panes[pi] = repl.id;
    else if (S.panes.length > 1) { S.panes.splice(pi, 1); S.ap = Math.min(S.ap, S.panes.length - 1); }
    else { const w = newRun(findModule('projectile')!); w.title = 'workspace'; S.tabs.push(w); S.panes[pi] = w.id; runTab(w); }
  }
  layout();
  save();
}
function cycleTab(d: number) {
  if (!S.tabs.length) return;
  const vis = new Set(S.panes.filter((_, i) => i !== S.ap));
  let i = tabIndex(S.panes[S.ap]);
  for (let k = 0; k < S.tabs.length; k++) {
    i = (i + d + S.tabs.length) % S.tabs.length;
    if (!vis.has(S.tabs[i].id)) break;
  }
  showTab(S.tabs[i].id);
}
function mkPage(kind: PageTab['kind'], data?: CaseResult[]): PageTab {
  return { kind, id: S.nextId++, title: kind === 'index' ? 'modules' : kind, sel: 0, filter: '', data };
}

// ---------- running ----------
function runTab(t: RunTab) {
  const frac = t.res && t.res.rows.length > 1 ? t.row / (t.res.rows.length - 1) : -1;
  const t0 = performance.now();
  try {
    t.res = t.mod.run(t.p, t.s);
    t.err = undefined;
  } catch (e: any) {
    t.res = undefined;
    t.err = String(e?.message ?? e);
  }
  t.ms = performance.now() - t0;
  const n = t.res?.rows.length ?? 1;
  t.row = frac < 0 ? (t.mod.timeBased ? n - 1 : 0) : Math.round(frac * (n - 1));
  t.row = Math.max(0, Math.min(n - 1, t.row));
  t.ran = true;
  t.reveal = null;
  t.playing = false;
  t.fails = t.res ? t.res.checks.reduce((a, c) => a + (checkPass(c) === false ? 1 : 0), 0) : 0;
  views.get(t.id)?.refresh();
  // theaters watching this tab pick up the new result immediately
  for (const w of S.tabs) if (w.kind === 'watch' && t.res) {
    let hit = false;
    w.runs.forEach((r) => { if (r.tabId === t.id) { r.res = t.res!; r.p = { ...t.p }; r.s = { ...t.s }; r.name = t.title; hit = true; } });
    if (hit && S.panes.includes(w.id)) views.get(w.id)?.refresh();
  }
  if (t.err) say(`error: ${t.err}`, true);
  else {
    const c = t.res!.checks.map(checkPass);
    const f = c.filter((x) => x === false).length;
    say(`ran ${t.title} in ${t.ms.toFixed(1)} ms · ${t.res!.rows.length} rows · checks ${c.filter((x) => x === true).length} pass${f ? ` / ${f} FAIL` : ''}`, f > 0);
  }
  renderTabbar();
}
// coalesce: holding a nudge key used to queue one full re-run per keypress; now at most one is pending per tab
const pendingRuns = new Set<number>();
function runSoon(t: RunTab) {
  say(`running ${t.title} …`);
  if (pendingRuns.has(t.id)) return;
  pendingRuns.add(t.id);
  setTimeout(() => { pendingRuns.delete(t.id); if (tabIndex(t.id) >= 0) { runTab(t); save(); } }, 0);
}

/** run tabs one after another, yielding to the UI between runs so progress stays visible */
function runSequential(tabs: RunTab[], done: () => void) {
  let i = 0;
  const next = () => {
    if (i >= tabs.length) { renderTabbar(); done(); return; }
    const t = tabs[i++];
    say(`running ${i}/${tabs.length}: ${t.title} …`);
    setTimeout(() => { if (tabIndex(t.id) >= 0) runTab(t); next(); }, 0);
  };
  next();
}

// ---------- theater ----------
type WatchSrc = { name: string; tabId?: number; mod: SimModule; p: Params; s: Settings; res?: Result };
const fromTab = (t: RunTab): WatchSrc => ({ name: t.title, tabId: t.id, mod: t.mod, p: { ...t.p }, s: { ...t.s }, res: t.res });

function openWatch(src: WatchSrc[]) {
  if (!src.length) { say('nothing to watch (run something first)', true); return; }
  if (src.length > 9) { say(`theater shows 9 runs; watching the first 9 of ${src.length}`); src = src.slice(0, 9); }
  // results computed in workers carry no draw closures: re-run those on the UI thread (one per frame)
  const runs: WatchRun[] = [];
  let i = 0;
  const step = () => {
    if (i < src.length) {
      const q = src[i++];
      let res = q.res;
      if (!res || !res.draw) {
        say(`preparing visualisation ${i}/${src.length} …`);
        try { res = q.mod.run(q.p, q.s); } catch (e: any) { say(String(e?.message ?? e), true); }
      }
      if (res) runs.push({ name: q.name, tabId: q.tabId, mod: q.mod, p: q.p, s: q.s, res });
      setTimeout(step, 0);
      return;
    }
    if (!runs.length) return;
    const w: WatchTab = { kind: 'watch', id: S.nextId++, title: `watch:${runs.length === 1 ? runs[0].name : runs.length + ' runs'}`, runs, clock: 0, playing: true, speed: 1, sync: 'time', loop: false, col: 0, trail: true };
    if (!canTimeSync(w)) w.sync = 'progress';
    lastFrame = performance.now();
    addTab(w);
    say(`theater: ${runs.length} run${runs.length > 1 ? 's' : ''} · ${w.sync} sync · space pause · +/- speed · j/k variable`);
  };
  step();
}

function refreshWatch(w: WatchTab) {
  w.runs.forEach((r) => {
    const t = r.tabId !== undefined ? S.tabs[tabIndex(r.tabId)] : undefined;
    if (t?.kind === 'run' && t.res) { r.res = t.res; r.p = { ...t.p }; r.s = { ...t.s }; r.name = t.title; }
  });
  getView(w).refresh();
  say('theater refreshed from source tabs');
}

// ---------- views ----------
interface View { el: HTMLElement; refresh(): void; cursor(): void; layout(): void; params?(): void; scroll?(d: number): void; charts?(): void }

const sceneEditors = new Map<number, EditView>();
function getView(t: Tab): View {
  if (t.kind === 'run' && t.editing && t.sed) {
    let e = sceneEditors.get(t.id);
    if (!e) { e = editView(t.sed, () => renderStatus()); sceneEditors.set(t.id, e); }
    return e;
  }
  let v = views.get(t.id);
  if (!v) { v = t.kind === 'run' ? runView(t) : t.kind === 'cmp' ? cmpView(t) : t.kind === 'watch' ? watchView(t) : pageView(t); views.set(t.id, v); }
  return v;
}

function checkRow(c: Result['checks'][0]) {
  const ok = checkPass(c);
  const err = Math.abs(c.act - c.exp);
  const rel = c.exp !== 0 ? err / Math.abs(c.exp) : NaN;
  const st = ok === null ? '<span class="ref">REF</span>' : ok ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>';
  return `<tr><td title="${esc(c.l)}">${esc(c.l)}</td><td>${fmt(c.exp)}</td><td>${fmt(c.act)}</td><td>${fmt(err)}</td><td>${Number.isFinite(rel) ? rel.toExponential(2) : '—'}</td><td class="dim">${esc(c.u ?? '')}</td><td>${st}</td></tr>`;
}

function goalEval(t: RunTab, g: Goal) {
  const q = g.q.toLowerCase();
  const sc = t.res?.scalars.find((s) => s.l.toLowerCase().includes(q));
  const ck = sc ? undefined : t.res?.checks.find((c) => c.l.toLowerCase().includes(q));
  const v = sc ? sc.v : ck ? ck.act : NaN;
  return { label: sc?.l ?? ck?.l ?? `?${g.q}`, v, err: v - g.v, hit: Math.abs(v - g.v) <= g.tol };
}

function runView(t: RunTab): View {
  const el = document.createElement('div');
  el.className = 'run';
  el.innerHTML = `<div class="left"></div><div class="right"><div class="viz"><canvas></canvas><pre class="fbd"></pre></div><div class="now"></div><div class="notes"></div><div class="out"><div class="res"></div><div class="chk"></div></div><div class="charts"></div><div class="data"><div class="bar"></div><div class="scroll"><table class="t"></table></div></div></div>`;
  const left = el.querySelector('.left') as HTMLElement;
  const right = el.querySelector('.right') as HTMLElement;
  const viz = el.querySelector('.viz canvas') as HTMLCanvasElement;
  const fbd = el.querySelector('.fbd') as HTMLElement;
  const notes = el.querySelector('.notes') as HTMLElement;
  const now = el.querySelector('.now') as HTMLElement;
  const out = el.querySelector('.out') as HTMLElement;
  const res = el.querySelector('.res') as HTMLElement;
  const chk = el.querySelector('.chk') as HTMLElement;
  const charts = el.querySelector('.charts') as HTMLElement;
  const data = el.querySelector('.data') as HTMLElement;
  const bar = data.querySelector('.bar') as HTMLElement;
  const table = data.querySelector('table') as HTMLElement;
  let maps: { map: ChartMap; cur: HTMLElement; ch: Chart }[] = [];
  const WIN = 22;

  const params = () => {
    const rows = prows(t);
    t.sel = Math.max(0, Math.min(rows.length - 1, t.sel));
    const nAdded = parseEnts(t.p).length;
    let h = `<div class="hdr"><div class="simrow"><span class="dim">SIMULATION</span> ${esc(t.mod.name)}</div><div class="btns"><button data-act="pick" title="choose another simulation (M)">change · M</button><button data-act="edit" class="edit" title="add & arrange objects (E)">EDIT · E</button></div><div class="d">${esc(t.mod.desc)}${CATALOG[t.mod.id] ? ` · <span class="acc">${nAdded || 'no'} object${nAdded === 1 ? '' : 's'} in the scene</span> · E to place, aim or add more` : ''}</div></div>`;
    rows.forEach((r, i) => {
      if (r.def?.sec) h += `<div class="sec">${esc(r.def.sec)}</div>`;
      if (r.set === 'method') h += `<div class="sec">numerics${t.mod.timeBased ? '' : ' (static solver)'}</div>`;
      const muted = r.set && !t.mod.timeBased && r.set !== 'steps';
      h += `<div class="prow${i === t.sel ? ' sel' : ''}${muted ? ' muted' : ''}${coachHl(r.k) ? ' coach-hl' : ''}" data-i="${i}" data-k="${esc(r.k)}"><span class="lab" title="${esc(r.k)}">${esc(r.l)}</span><span class="val">${esc(pval(t, r))}${r.def?.o ? ' ▸' : ''}${r.u ? `<span class="u">${esc(r.u)}</span>` : ''}</span></div>`;
    });
    // what the selected value means and how to change it
    const sr = rows[t.sel];
    if (sr) {
      const doc = sr.def?.d ?? docFor(t.mod.id, sr.k.replace(/^e\d+_/, '')) ?? sr.l;
      const how = sr.def?.o || sr.set === 'method' ? `options: ${(sr.def?.o ?? METHODS).join(' / ')} · h/l cycles` : `h/l nudge${sr.def?.s ? ` by ${fmtP(sr.def.s)}` : ''} · i type a value${sr.def?.min !== undefined ? ` · min ${fmtP(sr.def.min)}` : ''}${sr.def?.max !== undefined ? ` · max ${fmtP(sr.def.max)}` : ''}`;
      h += `<div class="pinfo"><b>${esc(sr.l)}</b>${sr.u ? ` <span class="dim" style="display:inline">[${esc(sr.u)}]</span>` : ''} — ${esc(doc)}<span class="dim">${esc(how)}</span></div>`;
    }
    if (t.goals.length || t.res?.targets?.length) {
      h += '<div class="sec">targets</div>';
      t.res?.targets?.forEach((g) => (h += `<div class="prow"><span class="lab">${esc(g.l)}</span><span class="val ${g.hit ? 'hit' : 'miss'}">${g.hit ? 'HIT' : 'MISS'} ${fmt(g.err)}${g.u ? `<span class="u">${esc(g.u)}</span>` : ''}</span></div>`));
      t.goals.forEach((g) => { const r = goalEval(t, g); h += `<div class="prow"><span class="lab" title="${esc(r.label)}">goal ${esc(r.label)} = ${fmtP(g.v)}±${fmtP(g.tol)}</span><span class="val ${r.hit ? 'hit' : 'miss'}">${r.hit ? 'HIT' : 'MISS'} Δ${fmt(r.err)}</span></div>`; });
    }
    h += `<div class="sec">run</div><div class="prow"><span class="lab">compute time</span><span class="val">${t.ms.toFixed(1)}<span class="u">ms</span></span></div>`;
    left.innerHTML = h;
    left.classList.toggle('focus', t.focus === 'params');
    const se = left.querySelector('.prow.sel') as HTMLElement | null;
    se?.scrollIntoView({ block: 'nearest' });
  };

  const outputs = () => {
    const r = t.res;
    if (!r) { res.innerHTML = `<span class="fail">${esc(t.err ?? 'not run')}</span>`; chk.innerHTML = ''; charts.innerHTML = ''; table.innerHTML = ''; notes.innerHTML = ''; return; }
    notes.innerHTML = (r.notes ?? []).map((n) => `<div>${esc(n)}</div>`).join('');
    res.innerHTML = `<div class="dim">results</div><div class="kv">${r.scalars.map((s) => `<span class="k" title="${esc(s.l)}">${esc(s.l)}</span><span class="v">${fmt(s.v)}${s.u ? `<span class="u">${esc(s.u)}</span>` : ''}</span>`).join('')}</div>`;
    const cs = r.checks.map(checkPass);
    const rels = r.checks.filter((c, i) => cs[i] !== null && c.exp !== 0).map((c) => Math.abs(c.act - c.exp) / Math.abs(c.exp));
    const loss = rels.length ? rels.reduce((a, b) => a + b, 0) / rels.length : NaN;
    chk.innerHTML = `<div class="dim">expected vs actual · ${cs.filter((x) => x === true).length} pass · ${cs.filter((x) => x === false).length} fail · ${cs.filter((x) => x === null).length} ref · loss(mean rel err) ${Number.isFinite(loss) ? loss.toExponential(3) : '—'}</div><table class="t"><tr><th>check</th><th>expected</th><th>actual</th><th>|err|</th><th>rel</th><th></th><th></th></tr>${r.checks.map(checkRow).join('')}</table>`;
    charts.innerHTML = r.charts.map(() => '<div class="chart"><canvas></canvas><div class="cur"></div></div>').join('');
    drawCharts();
  };

  const drawCharts = () => {
    const r = t.res;
    if (!r) return;
    const nodes = [...charts.querySelectorAll('.chart')];
    const n = r.rows.length;
    maps = r.charts.map((c, i) => {
      const cv = nodes[i].querySelector('canvas') as HTMLCanvasElement;
      // live playback: only rows up to the playhead are drawn, axes stay fixed to the full result
      const map = t.reveal === null ? drawChart(cv, c) : drawChart(cv, revealChart(c, t.reveal + 1, n), { rangeFrom: c });
      return { map, cur: nodes[i].querySelector('.cur') as HTMLElement, ch: c };
    });
    lastChartDraw = performance.now();
  };
  let lastChartDraw = 0;

  const renderTable = () => {
    const r = t.res;
    if (!r) return;
    const n = r.rows.length;
    const top = t.reveal !== null ? Math.max(0, t.row - WIN + 1) : Math.max(0, Math.min(n - WIN, t.row - Math.floor(WIN / 2)));
    let h = `<tr><th>#</th>${r.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
    for (let i = top; i < Math.min(n, top + WIN); i++) h += `<tr class="${i === t.row ? 'cur' : ''}" data-i="${i}"><td>${i}</td>${r.rows[i].map((v) => `<td>${fmt(v)}</td>`).join('')}</tr>`;
    table.innerHTML = h;
    const mode = t.playing ? (t.reveal !== null ? '▶ LIVE — data streaming in' : '▶ playing') : t.reveal !== null ? '❚❚ paused (live) · G = full result' : '[space] play live  [tab] focus  :export csv|json';
    bar.innerHTML = `<span>data · row ${t.row + 1}/${n} · ${r.cols.length} cols</span><span>${mode}</span>`;
    data.classList.toggle('focus', t.focus === 'table');
  };

  const cursor = () => {
    const r = t.res;
    if (!r) return;
    t.row = Math.max(0, Math.min(r.rows.length - 1, t.row));
    try {
      const g = new Gfx(viz);
      r.draw?.(g, t.row);
    } catch (e) { console.error(e); }
    fbd.textContent = r.fbd ? r.fbd(t.row).join('\n') : '(no free-body diagram for this module)';
    // live readout of every column at the playhead
    const q = r.rows[t.row];
    now.innerHTML = `<span class="tag${t.reveal !== null ? ' live' : ''}">${t.reveal !== null ? (t.playing ? '● LIVE' : '❚❚ LIVE') : 'AT CURSOR'}</span>` + r.cols.map((c, j) => `<span class="nv"><span class="k">${esc(c)}</span> ${fmt(q[j])}</span>`).join('');
    out.classList.toggle('pending', t.reveal !== null && t.reveal < r.rows.length - 1);
    if (t.reveal !== null && performance.now() - lastChartDraw > 45) drawCharts();
    const x0 = r.rows[t.row]?.[0];
    for (const m of maps) {
      const show = !m.ch.equal && (m.ch.tAxis || m.ch.xl === r.cols[0]) && Number.isFinite(x0);
      m.cur.style.display = show ? 'block' : 'none';
      if (show) {
        const px = m.map.xToPx(x0);
        m.cur.style.display = px >= m.map.left && px <= m.map.right ? 'block' : 'none';
        m.cur.style.left = `${px}px`;
        m.cur.style.top = `${m.map.top}px`;
        m.cur.style.height = `${m.map.bottom - m.map.top}px`;
      }
    }
    renderTable();
  };

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button[data-act]') as HTMLElement | null;
    if (act) { activatePaneOf(t.id); exec(act.dataset.act === 'edit' ? 'edit' : 'sim'); return; }
    const pr = (e.target as HTMLElement).closest('.prow[data-i]') as HTMLElement | null;
    if (pr) { t.sel = Number(pr.dataset.i); t.focus = 'params'; params(); renderTable(); }
    const tr = (e.target as HTMLElement).closest('tr[data-i]') as HTMLElement | null;
    if (tr) { t.row = Number(tr.dataset.i); t.focus = 'table'; if (!t.playing) endReveal(t); params(); cursor(); }
    activatePaneOf(t.id);
  });
  el.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest('.prow[data-i]')) startInsert(t); });
  data.addEventListener('wheel', (e) => { if (!t.res) return; e.preventDefault(); if (!t.playing) endReveal(t); t.row += Math.sign(e.deltaY) * 3; cursor(); }, { passive: false });
  void right;
  return {
    el,
    params,
    refresh() { params(); outputs(); cursor(); },
    charts: drawCharts,
    cursor,
    layout() { drawCharts(); cursor(); },
  };
}

// ---------- interactive tutorial ----------
function tutTab(): RunTab | undefined {
  const c = S.coach;
  const t = c ? S.tabs[tabIndex(c.tutId)] : undefined;
  return t?.kind === 'run' ? t : undefined;
}
function coachHl(key: string) {
  const c = S.coach;
  return !!c && cur()?.id === c.tutId && STEPS[c.step]?.hl === key;
}
function startTutorial() {
  const m = findModule('projectile')!;
  const t = newRun(m, {}, undefined, 'tutorial');
  S.coach = { step: 0, tutId: t.id, seenLive: false, doneAt: 0 };
  addTab(t);
  renderCoach();
  say('tutorial started — follow the yellow guide at the bottom');
}
function stopTutorial() {
  S.coach = null;
  renderCoach();
  const t = cur();
  if (t?.kind === 'run') getView(t).params?.();
  say('guide closed · :help to start it again · ? for the key list');
}
function coachGo(d: number) {
  const c = S.coach;
  if (!c) return;
  if (c.step + d >= STEPS.length) { stopTutorial(); return; }
  c.step = Math.max(0, c.step + d);
  c.doneAt = 0;
  renderCoach();
  const t = tutTab();
  if (t) views.get(t.id)?.params?.();
}
function coachCtx(): CoachCtx {
  return { tut: tutTab(), cur: cur(), tabs: S.tabs, selKey: (t: RunTab) => prows(t)[t.sel]?.k, seenLive: S.coach?.seenLive ?? false };
}
/** evaluated after every state change: completes the current step when its task is satisfied */
function coachCheck() {
  const c = S.coach;
  if (!c) return;
  const t = tutTab();
  if (!t) { stopTutorial(); return; }
  if (t.playing && t.reveal !== null) c.seenLive = true;
  const st = STEPS[c.step];
  if (!c.doneAt && st.done && st.done(coachCtx())) {
    c.doneAt = performance.now();
    renderCoach();
    const at = c.doneAt, step = c.step;
    setTimeout(() => { if (S.coach && S.coach.step === step && S.coach.doneAt === at) coachGo(1); }, 1100);
  }
}
function renderCoach() {
  const el = $('coach');
  const c = S.coach;
  el.classList.toggle('on', !!c);
  if (!c) { el.innerHTML = ''; return; }
  const st = STEPS[c.step];
  const dots = STEPS.map((_, i) => (i < c.step ? '<b>■</b>' : i === c.step ? '<b>▣</b>' : '□')).join('');
  el.innerHTML = `<div class="ch"><span>GUIDE · ${esc(st.title)}</span><span class="st">step ${c.step + 1} / ${STEPS.length}</span><span class="dots">${dots}</span></div>
    <div class="cb">${st.body}</div>
    ${st.task ? `<div class="task${c.doneAt ? ' done' : ''}">${c.doneAt ? '✓ done — moving on…' : st.task}</div>` : ''}
    <div class="cf">N next · B back · :help stop closes the guide · ? key list</div>`;
  // the guide takes space from the panes: let canvases re-measure
  requestAnimationFrame(() => S.panes.forEach((id) => { const t = S.tabs[tabIndex(id)]; if (t) getView(t).layout(); }));
}

// ---------- workspace: one screen, pick a simulation, EDIT adds objects ----------
let lastWs = 0;
/** the workspace the picker / commands act on: current run tab, else the last one used */
function workspace(): RunTab | undefined {
  const c = cur();
  if (c?.kind === 'run') { lastWs = c.id; return c; }
  const w = S.tabs.find((q) => q.id === lastWs && q.kind === 'run') ?? S.tabs.find((q) => q.kind === 'run');
  return w?.kind === 'run' ? w : undefined;
}
function openPicker() {
  const w = workspace();
  if (w) lastWs = w.id;
  const ix = S.tabs.find((q) => q.kind === 'index') ?? mkPage('index');
  if (!S.tabs.includes(ix)) S.tabs.push(ix);
  if (ix.kind === 'index') ix.sel = Math.max(0, MODULES.findIndex((m) => m.id === w?.mod.id));
  showTab(ix.id);
  say('choose a simulation: j/k · Enter loads it into the workspace · Esc back');
}
function pickSim(m: SimModule) {
  let w = workspace();
  if (!w) { w = newRun(m); w.title = 'workspace'; addTab(w); }
  else switchSim(w, m);
  const ix = S.tabs.find((q) => q.kind === 'index');
  if (ix) closeTab(ix.id);
  showTab(w.id);
  say(`${m.name} loaded · its values are the environment · press E to add objects${CATALOG[m.id]?.presets.length ? ` (e.g. ${CATALOG[m.id].presets.slice(0, 3).map((q) => q.name).join(', ')})` : ''}`);
}
function switchSim(t: RunTab, m: SimModule) {
  if (t.mod === m) return;
  t.memory = { ...(t.memory ?? {}), [t.mod.id]: { p: { ...t.p }, s: { ...t.s } } };
  const mem = t.memory[m.id];
  t.mod = m;
  t.p = mem ? { ...mem.p } : defaults(m);
  t.s = mem ? { ...mem.s } : settingsFor(m, t.p);
  t.sel = 0; t.row = 0; t.res = undefined; t.reveal = null; t.playing = false; t.undo = []; t.redo = [];
  t.editing = false;
  if (t.title !== 'tutorial') t.title = `ws:${m.id}`;
  views.get(t.id)?.el.remove();
  views.delete(t.id);
  runTab(t);
  layout();
  save();
}
function startEdit(t: RunTab) {
  if (!CATALOG[t.mod.id]) { say('this simulation has no objects to add', true); return; }
  t.sed = newEdit(t.mod, t.p, t.s);
  t.editing = true;
  t.playing = false;
  sceneEditors.delete(t.id);
  layout();
  say(`EDIT ${t.mod.name}: [ ] choose · space add${CATALOG[t.mod.id].kinds.some((k) => k.aim) ? ' · drag or v aim' : ''} · shift-drag or g move · x delete · y copy · Enter done`);
}
function finishEdit(t: RunTab) {
  if (!t.sed) return;
  pushUndo(t);
  t.p = { ...t.sed.p };
  t.editing = false;
  sceneEditors.get(t.id)?.el.remove();
  sceneEditors.delete(t.id);
  layout();
  runSoon(t);
  const n = parseEnts(t.p).length;
  // put the cursor on the first added object's values
  const i = prows(t).findIndex((r) => r.def?.sec?.startsWith('+ 1'));
  if (i >= 0) { t.sel = i; t.focus = 'params'; }
  setTimeout(() => say(n ? `${n} object${n === 1 ? '' : 's'} in the scene · their values are under "+ 1 · …" in the list (same keys: h/l, i) · the environment above applies to all of them · space to watch` : 'the scene is empty: press E to add something'), 50);
}

/** leave live mode: charts/table show the complete result again */
function endReveal(t: RunTab) {
  if (t.reveal === null) return;
  t.reveal = null;
  views.get(t.id)?.charts?.();
}

function activatePaneOf(id: number) {
  const i = S.panes.indexOf(id);
  if (i >= 0 && i !== S.ap) { S.ap = i; renderPaneFocus(); renderTabbar(); renderStatus(); }
}

// ---------- compare view ----------
function cmpView(t: CmpTab): View {
  const el = document.createElement('div');
  el.className = 'page';
  const colors = t.runs.map((_, i) => PALETTE[i % PALETTE.length]);
  const build = () => {
    const R = t.runs;
    const base = R[0];
    let h = `<h1>${t.sweep ? 'SWEEP' : 'COMPARE'} · ${R.length} runs</h1>`;
    h += `<h2>runs</h2><table class="t"><tr><th>run</th><th>module</th>`;
    // parameters that differ
    const keys = new Set<string>();
    R.forEach((r) => Object.keys(r.p).forEach((k) => keys.add(k)));
    const diffKeys = [...keys].filter((k) => !k.startsWith('_') && R.some((r) => String(r.p[k]) !== String(base.p[k])));
    const sdiff = (['method', 'dt', 'steps'] as const).filter((k) => R.some((r) => r.s[k] !== base.s[k]));
    h += diffKeys.map((k) => `<th>${esc(k)}</th>`).join('') + sdiff.map((k) => `<th>${k}</th>`).join('') + '</tr>';
    R.forEach((r, i) => {
      h += `<tr><td><span class="swatch" style="background:${colors[i]}"></span>${esc(r.name)}</td><td>${r.mod.id}</td>${diffKeys.map((k) => `<td>${esc(typeof r.p[k] === 'number' ? fmtP(r.p[k] as number) : String(r.p[k] ?? ''))}</td>`).join('')}${sdiff.map((k) => `<td>${esc(String(r.s[k]))}</td>`).join('')}</tr>`;
    });
    h += '</table>';
    if (t.sweep) {
      h += `<h2>sweep table · ${esc(t.sweep.key)}</h2><table class="t"><tr><th>${esc(t.sweep.key)}</th>${base.res.scalars.map((s) => `<th>${esc(s.l)}</th>`).join('')}<th>fail</th></tr>`;
      R.forEach((r, i) => (h += `<tr><td>${fmtP(t.sweep!.vals[i])}</td>${r.res.scalars.map((s) => `<td>${fmt(s.v)}</td>`).join('')}<td>${r.res.checks.map(checkPass).filter((x) => x === false).length}</td></tr>`));
      h += '</table>';
    }
    // scalar diff vs R1
    h += `<h2>diff · scalars (Δ vs ${esc(base.name)})</h2><table class="t"><tr><th>quantity</th>${R.map((r, i) => `<th style="color:${colors[i]}">${esc(r.name)}</th>${i ? '<th>Δ</th><th>Δ%</th>' : ''}`).join('')}<th>unit</th></tr>`;
    const labels = [...new Set(R.flatMap((r) => r.res.scalars.map((s) => s.l)))];
    labels.forEach((l) => {
      const vals = R.map((r) => r.res.scalars.find((s) => s.l === l)?.v ?? NaN);
      const u = R.map((r) => r.res.scalars.find((s) => s.l === l)?.u).find(Boolean) ?? '';
      h += `<tr><td>${esc(l)}</td>${vals.map((v, i) => `<td>${fmt(v)}</td>${i ? `<td>${fmt(v - vals[0])}</td><td>${vals[0] ? (((v - vals[0]) / Math.abs(vals[0])) * 100).toFixed(3) : '—'}</td>` : ''}`).join('')}<td class="dim">${esc(u)}</td></tr>`;
    });
    h += '</table>';
    // checks: error margin / loss per run
    h += `<h2>expected vs actual · error per run</h2><table class="t"><tr><th>check</th>${R.map((r, i) => `<th style="color:${colors[i]}">${esc(r.name)} actual</th><th>rel err</th>`).join('')}</tr>`;
    const cl = [...new Set(R.flatMap((r) => r.res.checks.map((c) => c.l)))];
    cl.forEach((l) => {
      h += `<tr><td>${esc(l)}</td>`;
      R.forEach((r) => {
        const c = r.res.checks.find((q) => q.l === l);
        if (!c) { h += '<td>—</td><td>—</td>'; return; }
        const ok = checkPass(c);
        const rel = c.exp !== 0 ? Math.abs(c.act - c.exp) / Math.abs(c.exp) : Math.abs(c.act - c.exp);
        h += `<td>${fmt(c.act)}</td><td class="${ok === null ? 'ref' : ok ? 'pass' : 'fail'}">${rel.toExponential(2)}</td>`;
      });
      h += '</tr>';
    });
    h += `<tr><td class="dim">loss = mean rel err</td>${R.map((r) => { const e = r.res.checks.filter((c) => checkPass(c) !== null && c.exp !== 0).map((c) => Math.abs(c.act - c.exp) / Math.abs(c.exp)); return `<td></td><td>${e.length ? (e.reduce((a, b) => a + b, 0) / e.length).toExponential(3) : '—'}</td>`; }).join('')}</tr></table>`;
    // series deltas
    const sameMod = R.every((r) => r.mod === base.mod);
    if (sameMod && R.length > 1) {
      h += `<h2>diff · time series vs ${esc(base.name)} (interpolated on ${esc(base.res.cols[0])})</h2><table class="t"><tr><th>column</th>${R.slice(1).map((r, i) => `<th style="color:${colors[i + 1]}">${esc(r.name)} max|Δ|</th><th>RMS Δ</th><th>rel</th>`).join('')}</tr>`;
      const bx = base.res.rows.map((q) => q[0]);
      const mono = bx.every((v, i) => i === 0 || v >= bx[i - 1]);
      base.res.cols.slice(1).forEach((c, ci) => {
        const j0 = ci + 1;
        const by = base.res.rows.map((q) => q[j0]);
        const scale = Math.max(1e-300, maxOf(by.map(Math.abs).filter(Number.isFinite)));
        h += `<tr><td>${esc(c)}</td>`;
        R.slice(1).forEach((r) => {
          const j = r.res.cols.indexOf(c);
          if (j < 0 || r.res.cols[0] !== base.res.cols[0]) { h += '<td>—</td><td>—</td><td>—</td>'; return; }
          const rx = r.res.rows.map((q) => q[0]), ry = r.res.rows.map((q) => q[j]);
          let mx = 0, ss = 0, n = 0;
          for (let i = 0; i < by.length; i++) {
            if (mono && (bx[i] < rx[0] || bx[i] > rx[rx.length - 1])) continue;
            const v = mono ? interp(rx, ry, bx[i]) : ry[i];
            if (v === undefined || !Number.isFinite(v) || !Number.isFinite(by[i])) continue;
            const d = Math.abs(v - by[i]);
            mx = Math.max(mx, d); ss += d * d; n++;
          }
          h += `<td>${fmt(mx)}</td><td>${fmt(Math.sqrt(ss / Math.max(1, n)))}</td><td>${(mx / scale).toExponential(2)}</td>`;
        });
        h += '</tr>';
      });
      h += '</table>';
    }
    h += '<h2>overlay</h2><div class="charts"></div>';
    el.innerHTML = h;
    const box = el.querySelector('.charts') as HTMLElement;
    const ids = [...new Set(R.flatMap((r) => r.res.charts.map((c) => c.id + '|' + c.title)))];
    const sweepCharts: Chart[] = [];
    if (t.sweep) {
      base.res.scalars.forEach((s, si) => {
        const y = R.map((r) => r.res.scalars[si]?.v ?? NaN);
        if (y.some(Number.isFinite)) sweepCharts.push({ id: 'sw' + si, title: `${s.l} vs ${t.sweep!.key}`, xl: t.sweep!.key, yl: s.u ?? '', series: [{ name: s.l, x: t.sweep!.vals, y, pts: true }, { name: '', x: t.sweep!.vals, y }] });
      });
    }
    const all: { c: Chart; colors?: string[]; dashes?: boolean[] }[] = sweepCharts.map((c) => ({ c, colors: [COL.f, COL.a] }));
    ids.forEach((key) => {
      const [id, title] = key.split('|');
      const series: Chart['series'] = [], cols: string[] = [], dashes: boolean[] = [];
      let tmpl: Chart | undefined;
      R.forEach((r, ri) => {
        const c = r.res.charts.find((q) => q.id === id && q.title === title);
        if (!c) return;
        tmpl ??= c;
        c.series.forEach((s, si) => { series.push({ ...s, name: `${r.name}:${s.name}` }); cols.push(colors[ri]); dashes.push(si > 0); });
      });
      if (tmpl) all.push({ c: { ...tmpl, series }, colors: cols, dashes });
    });
    box.innerHTML = all.map(() => '<div class="chart"><canvas></canvas></div>').join('');
    const nodes = [...box.querySelectorAll('canvas')];
    all.forEach((a, i) => drawChart(nodes[i] as HTMLCanvasElement, a.c, { colors: a.colors, dashes: a.dashes }));
  };
  return { el, refresh: build, cursor() {}, layout: build, scroll(d) { el.scrollTop += d; } };
}

// ---------- index / help / selftest ----------
const HELP: [string, string][] = [
  ['GETTING STARTED', ''],
  [':help', 'interactive guided tour on a live simulation (N next · B back · :help stop)'],
  ['?  /  :keys', 'this key reference'],
  ['NAVIGATION', ''],
  ['gt / gT  or  L / H', 'next / previous tab ({n}gt jumps to tab n)'],
  ['j k  (↓ ↑)', 'move parameter cursor / table row (counts: 5j)'],
  ['Tab', 'toggle focus: parameters ↔ data table'],
  ['gg / G', 'first / last item ({n}G = row n)'],
  ['Ctrl-d / Ctrl-u', 'half-page down / up in data table'],
  ['[ ]  { }', 'step playback frame ±1 / ±10%'],
  ['space', 'replay LIVE: animation plays while graphs draw and data rows stream in'],
  ['G (after a replay)', 'jump to the complete result with every graph filled in'],
  [':live on|off', 'live streaming replay (default) vs cursor-only playback over the full result'],
  [':realtime on|off', 'play at exactly 1 simulated second per real second (× :speed)'],
  ['EDITING', ''],
  ['i a c Enter', 'edit parameter (expressions ok: 2*pi, 9.81/6, 1e-3)'],
  ['h l (← →)', 'nudge value by its step / cycle option; < > = ×10'],
  ['u / Ctrl-r', 'undo / redo parameter change'],
  ['r / R', 're-run / reset parameters to defaults'],
  ['/text  n', 'jump to parameter (or filter module list); next match'],
  ['THEATER (live watch)', ''],
  ['W  /  :watch', 'watch the current run full-size, or all runs of a compare/sweep tab'],
  [':watch all | n n…', 'watch several tabs at once on one synchronized clock (max 9)'],
  [':multi k v1 v2 …', 'run one variant per value and watch them all together'],
  ['space [ ] { } 0 G', 'play/pause · step · ±5% · start · end (in theater)'],
  ['+ / -', 'theater speed ×2 / ÷2'],
  ['s / o / j k', 'time ↔ progress sync · loop · choose compared variable'],
  ['r (theater)', 're-pull results from source tabs (also automatic on re-run)'],
  [':runall', 're-run every simulation tab'],
  ['WINDOWS', ''],
  ['wv', 'split: open another tab side-by-side (max 4 panes)'],
  ['wh wl ww', 'focus left / right / next pane'],
  ['wo / wc', 'only this pane / close pane'],
  ['yy', 'duplicate current run into a new tab'],
  ['x', 'close tab'],
  ['COMMANDS', ''],
  [':sim <name>  /  M', 'switch the workspace to another simulation (picker; each keeps its own setup)'],
  ['E  /  :edit', 'EDIT: place, aim and add objects (the list above them is the environment: gravity, air…)'],
  ['in EDIT', 'hjkl move · [ ] choose · space add · drag or v aim · shift-drag or g move · x delete · y copy · Tab next · +/- size · </> rope · u undo · Enter done'],
  [':add <name>', 'add an object by name while editing (e.g. :add saturn)'],
  [':run  :reset', 'run / reset current tab'],
  [':set k=v [k=v]', 'set parameters; also dt=, steps=, method=euler|semi|rk4'],
  [':compare [n n…]', 'overlay + diff of tabs (default: all runs of this module)'],
  [':sweep k a b n', 'batch parameter sweep (k may be dt or steps for convergence)'],
  [':goal <qty> <v> [tol]', 'custom target on any result/check; :goal clear'],
  [':export csv|json', 'download data of current tab (compare tab: diff tables)'],
  [':preset save|load|rm <name>', 'named presets (saved with the app); :presets lists'],
  [':dup  :name <t>', 'duplicate run / rename tab'],
  [':vs [n]  :only  :close', 'split / single pane / close pane'],
  [':q  :qa', 'close tab / close all'],
  [':speed x', 'playback speed multiplier'],
  [':selftest', 'run every module & mode, verify all analytic checks'],
  [':ls  :b n', 'list tabs / go to tab n'],
  [':session save | load', 'write / read every tab (+ presets) to a .json file (native dialog in the app)'],
];

function pageView(t: PageTab): View {
  const el = document.createElement('div');
  el.className = 'page';
  const list = () => MODULES.map((m, i) => ({ m, i })).filter(({ m }) => !t.filter || (m.name + ' ' + m.id + ' ' + m.desc).toLowerCase().includes(t.filter.toLowerCase()));
  const build = () => {
    if (t.kind === 'index') {
      const L = list();
      t.sel = Math.max(0, Math.min(L.length - 1, t.sel));
      el.innerHTML = `<h1>CHOOSE A SIMULATION</h1><div class="dim">loads into the workspace · its values become the environment · then press E (EDIT) to add objects · j/k select · Enter load · / filter · Esc back${t.filter ? ` · filter "${esc(t.filter)}"` : ''}</div><h2>simulations</h2><div class="mods">${L.map(({ m, i }, k) => `<div class="m${k === t.sel ? ' sel' : ''}" data-i="${i}"><span class="i">${String(i + 1).padStart(2, '0')}</span><span>${esc(m.name)}</span><span class="dsc">${esc(m.desc)}</span></div>`).join('')}</div>`;
      el.querySelector('.m.sel')?.scrollIntoView({ block: 'nearest' });
    } else if (t.kind === 'help') {
      el.innerHTML = `<h1>KEYS</h1><div class="keys">${HELP.map(([k, d]) => (d ? `<span class="k">${esc(k)}</span><span>${esc(d)}</span>` : `<span class="dim" style="grid-column:1/3;margin-top:8px">${k}</span>`)).join('')}</div><h2>method</h2><div class="dim">Every module integrates its governing equations numerically with the chosen integrator (explicit Euler, semi-implicit/symplectic Euler, classical RK4) or solves the static problem directly, then compares against closed-form or independently derived results. "expected vs actual" lists each check with absolute and relative error; FAIL means the numeric result is outside tolerance for the current dt/resolution — refine dt or switch method and re-run. REF rows are reference values that are not expected to match exactly (e.g. vacuum range with drag on).</div>`;
    } else {
      const d = t.data ?? [];
      const P = d.reduce((a, c) => a + c.pass, 0), F = d.reduce((a, c) => a + c.fail, 0), Rf = d.reduce((a, c) => a + c.ref, 0);
      el.innerHTML = `<h1>SELF-TEST</h1><div class="${F ? 'fail' : 'pass'}">${P} checks pass · ${F} fail · ${Rf} reference-only · ${d.length} module/mode cases</div><h2>cases</h2><table class="t"><tr><th>module</th><th>variant</th><th>ms</th><th>pass</th><th>fail</th><th>ref</th><th>failures</th></tr>${d.map((c) => `<tr><td>${c.mod}</td><td>${esc(c.variant)}</td><td>${c.ms.toFixed(0)}</td><td class="pass">${c.pass}</td><td class="${c.fail ? 'fail' : 'dim'}">${c.fail}</td><td class="ref">${c.ref}</td><td class="fail" style="text-align:left">${esc([...c.failures, c.error ?? ''].filter(Boolean).join(' · '))}</td></tr>`).join('')}</table>`;
    }
  };
  el.addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).closest('.m') as HTMLElement | null;
    activatePaneOf(t.id);
    if (m) pickSim(MODULES[Number(m.dataset.i)]);
  });
  return { el, refresh: build, cursor: build, layout: build, scroll(d) { el.scrollTop += d; } };
}

// ---------- layout / chrome ----------
function layout() {
  const box = $('panes');
  S.panes = S.panes.filter((id) => tabIndex(id) >= 0);
  if (!S.panes.length && S.tabs.length) S.panes = [S.tabs[0].id];
  S.ap = Math.max(0, Math.min(S.panes.length - 1, S.ap));
  while (box.children.length < S.panes.length) { const p = document.createElement('div'); p.className = 'pane'; p.innerHTML = '<div class="view"></div>'; box.appendChild(p); }
  while (box.children.length > S.panes.length) box.lastElementChild!.remove();
  S.panes.forEach((id, i) => {
    const holder = (box.children[i] as HTMLElement).firstElementChild as HTMLElement;
    const v = getView(S.tabs[tabIndex(id)]);
    if (holder.firstElementChild !== v.el) { holder.innerHTML = ''; holder.appendChild(v.el); }
  });
  renderPaneFocus();
  renderTabbar();
  renderStatus();
  // canvases need their final size before drawing
  requestAnimationFrame(() => S.panes.forEach((id) => { const t = S.tabs[tabIndex(id)]; if (t) getView(t).refresh(); }));
}
function renderPaneFocus() { [...$('panes').children].forEach((p, i) => p.classList.toggle('act', i === S.ap)); }
function renderTabbar() {
  const vis = new Set(S.panes);
  $('tabbar').innerHTML = `<span class="logo">UNISIM</span>` + S.tabs.map((t, i) => {
    const bad = t.kind === 'run' && t.fails > 0;
    return `<span class="tab${vis.has(t.id) ? ' vis' : ''}${t.id === S.panes[S.ap] ? ' act' : ''}" data-id="${t.id}"><span class="n">${i + 1}</span>${esc(t.title)}${bad ? ' !' : ''}</span>`;
  }).join('');
}
function renderStatus() {
  coachCheck();
  const t = cur();
  const flags = `${S.live ? '' : ' · cursor-only'}${S.realtime ? ' · REALTIME' : ''}`;
  const info = t?.kind === 'run' ? `${t.mod.id} · ${t.s.method} dt=${fmtP(t.s.dt)} n=${t.s.steps}${t.playing ? (t.reveal !== null ? ' · ● LIVE' : ' · ▶') : ''}${flags}` : t?.kind === 'watch' ? `theater · ${t.runs.length} run${t.runs.length > 1 ? 's' : ''} · ×${t.speed}${t.playing ? ' · ▶' : ''}` : t?.title ?? '';
  const jobs = pool.busy;
  const modeLbl = S.mode === 'normal' && t?.kind === 'run' && t.editing ? 'edit' : S.mode;
  $('status').innerHTML = `<span class="mode ${modeLbl}">${modeLbl.toUpperCase()}</span><span class="msg${S.err ? ' err' : ''}">${esc(S.msg)}</span><span class="right">${jobs ? `⚙ ${jobs} job${jobs > 1 ? 's' : ''}  ` : ''}${esc(pend + count)}  ${esc(info)}  [${S.ap + 1}/${S.panes.length}]</span>`;
}

// ---------- insert mode ----------
function startInsert(t: RunTab) {
  const rows = prows(t);
  const r = rows[t.sel];
  if (!r) return;
  t.focus = 'params';
  const v = getView(t);
  v.params?.();
  const row = v.el.querySelector(`.prow[data-i="${t.sel}"] .val`) as HTMLElement;
  if (!row) return;
  const opts = r.def?.o ?? (r.set === 'method' ? METHODS : undefined);
  row.innerHTML = `<input value="${esc(pval(t, r))}" title="${opts ? esc(opts.join(' | ')) : 'number or expression'}">`;
  const inp = row.querySelector('input') as HTMLInputElement;
  S.mode = 'insert';
  say(opts ? `options: ${opts.join(' | ')}` : `${r.l}${r.u ? ` [${r.u}]` : ''} — Enter commit · Esc cancel · Tab next`);
  inp.focus();
  inp.select();
  const done = (commit: boolean, next = 0) => {
    S.mode = 'normal';
    inp.onkeydown = null;
    inp.onblur = null;
    if (commit && setParam(t, r.k, inp.value)) { runSoon(t); }
    t.sel = Math.max(0, Math.min(prows(t).length - 1, t.sel + next));
    v.params?.();
    renderStatus();
  };
  inp.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    else if (e.key === 'Tab') { e.preventDefault(); done(true, e.shiftKey ? -1 : 1); if (e.ctrlKey) return; setTimeout(() => startInsert(t), 0); }
  };
  inp.onblur = () => { if (S.mode === 'insert') done(false); };
}

// ---------- command line ----------
const hist: string[] = [];
let hi = -1;
function openCmd(prefix: ':' | '/') {
  S.mode = prefix === ':' ? 'command' : 'search';
  $('cmdline').classList.add('on');
  $('cmdprefix').textContent = prefix;
  const inp = $('cmdinput') as HTMLInputElement;
  inp.value = '';
  hi = hist.length;
  inp.focus();
  renderStatus();
}
function closeCmd() {
  S.mode = 'normal';
  $('cmdline').classList.remove('on');
  ($('cmdinput') as HTMLInputElement).blur();
  renderStatus();
}
const CMDS = ['run', 'reset', 'set', 'new', 'e', 'tabnew', 'compare', 'diff', 'sweep', 'export', 'preset', 'presets', 'goal', 'dup', 'name', 'vs', 'vsplit', 'sp', 'only', 'close', 'q', 'qa', 'speed', 'selftest', 'help', 'ls', 'b', 'tabn', 'tabp', 'method', 'dt', 'steps', 'w', 'watch', 'multi', 'runall', 'theater', 'session', 'live', 'realtime', 'keys', 'next', 'back', 'draw', 'sim', 'add', 'edit', 'done'];
function complete(inp: HTMLInputElement) {
  const v = inp.value;
  const parts = v.split(/\s+/);
  let pool: string[] = [];
  if (parts.length <= 1) pool = CMDS;
  else if (['new', 'e', 'tabnew'].includes(parts[0])) pool = MODULES.map((m) => m.id);
  else if (['set', 'sweep'].includes(parts[0])) { const t = cur(); pool = t?.kind === 'run' ? [...prows(t).map((r) => r.k.replace('$', ''))] : []; }
  else if (parts[0] === 'preset' && parts.length === 2) pool = ['save', 'load', 'rm'];
  else if (parts[0] === 'preset') pool = Object.keys(loadPresets());
  else if (parts[0] === 'export') pool = ['csv', 'json'];
  else if (parts[0] === 'method') pool = METHODS;
  const last = parts[parts.length - 1];
  const m = pool.filter((x) => x.startsWith(last));
  if (m.length === 1) { parts[parts.length - 1] = m[0] + (parts[0] === 'set' ? '=' : ' '); inp.value = parts.join(' '); }
  else if (m.length > 1) say(m.join('  '));
}

function exec(line: string) {
  line = line.trim();
  if (!line) return;
  hist.push(line);
  say('');
  const [cmd, ...args] = line.split(/\s+/);
  const t = cur();
  const run = t?.kind === 'run' ? t : undefined;
  // inside a theater, run-level commands act on the first watched run's source tab
  const need = () => {
    if (run) return run;
    if (t?.kind === 'watch') { const src = t.runs.map((r) => (r.tabId !== undefined ? S.tabs[tabIndex(r.tabId)] : undefined)).find((q): q is RunTab => q?.kind === 'run'); if (src) return src; }
    throw new Error('not a simulation tab');
  };
  try {
    switch (cmd) {
      case 'run': case 'r': runSoon(need()); break;
      case 'reset': { const r = need(); pushUndo(r); r.p = defaults(r.mod); r.s = settingsFor(r.mod, r.p); runSoon(r); break; }
      case 'set': {
        const r = need();
        const pairs = args.join(' ').includes('=') ? args.join(' ').split(/\s+(?=[\w$]+=)/).map((x) => x.split('=')) : [[args[0], args.slice(1).join(' ')]];
        let ok = true;
        for (const [k, v] of pairs) ok = setParam(r, k.trim(), (v ?? '').trim()) && ok;
        if (ok) runSoon(r);
        break;
      }
      case 'method': case 'dt': case 'steps': { const r = need(); if (setParam(r, cmd, args.join(' '))) runSoon(r); break; }
      case 'sim': case 'new': case 'tabnew': case 'module': {
        // switch the workspace to another simulation (or open the picker)
        if (!args.length) { openPicker(); break; }
        const m = findModule(args.join(' '));
        if (!m) throw new Error(`no simulation '${args.join(' ')}'`);
        pickSim(m);
        break;
      }
      case 'edit': case 'e': case 'draw': {
        const r = run ?? workspace();
        if (!r) throw new Error('no workspace');
        startEdit(r);
        break;
      }
      case 'add': {
        const r = need();
        if (!r.editing || !r.sed) throw new Error(':add works in EDIT (press E)');
        say(editAdd(r.sed, args.join(' ')));
        getView(r).cursor();
        break;
      }
      case 'dup': { const r = need(); const c = newRun(r.mod, { ...r.p }, { ...r.s }); c.goals = r.goals.map((g) => ({ ...g })); addTab(c); break; }
      case 'name': { if (!t) break; t.title = args.join(' ') || t.title; renderTabbar(); save(); break; }
      case 'compare': case 'diff': {
        let ts: RunTab[];
        if (args.length) ts = args.map((a) => S.tabs[Number(a) - 1]).filter((q): q is RunTab => q?.kind === 'run');
        else { const r = need(); ts = S.tabs.filter((q): q is RunTab => q.kind === 'run' && q.mod === r.mod); }
        ts = ts.filter((q) => q.res);
        if (ts.length < 2) throw new Error('need ≥ 2 run tabs with results (try yy to duplicate, change a parameter, then :compare)');
        const c: CmpTab = { kind: 'cmp', id: S.nextId++, title: `cmp:${ts.map((q) => tabIndex(q.id) + 1).join(',')}`, runs: ts.map((q) => ({ name: q.title, mod: q.mod, p: { ...q.p }, s: { ...q.s }, res: q.res! })) };
        addTab(c);
        break;
      }
      case 'sweep': {
        const r = need();
        const [k, a, b, n] = [args[0], evalNum(args[1] ?? ''), evalNum(args[2] ?? ''), Math.round(evalNum(args[3] ?? '5'))];
        if (!k || !Number.isFinite(a) || !Number.isFinite(b) || !(n >= 2)) throw new Error('usage: :sweep <param> <from> <to> <n>');
        if (n > 200) throw new Error('n ≤ 200');
        const isSet = ['dt', 'steps', '$dt', '$steps'].includes(k);
        const d = paramsOf(r).find((q) => q.k === k);
        if (!isSet && (!d || d.o)) throw new Error(`'${k}' is not a numeric parameter`);
        const vals = Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
        // fan the sweep out across the worker pool: runs execute in parallel and the UI stays live
        const t0 = performance.now();
        let done = 0;
        say(`sweeping ${k}: 0/${n} on ${pool.size} workers …`);
        Promise.all(vals.map((v) => {
          const p = { ...r.p }, s = { ...r.s };
          if (isSet) { if (k.endsWith('dt')) s.dt = v; else s.steps = Math.min(MAX_STEPS, Math.max(1, Math.round(v))); } else p[k] = v;
          return pool.submit<Result>({ kind: 'run', mod: r.mod.id, p: p as any, s }).then((o) => { say(`sweeping ${k}: ${++done}/${n} …`); return { name: `${k}=${fmtP(v)}`, mod: r.mod, p, s, res: o.res } as CmpRun; });
        })).then((runs) => {
          addTab({ kind: 'cmp', id: S.nextId++, title: `sweep:${k}`, runs, sweep: { key: k.replace('$', ''), vals } });
          say(`sweep of ${n} runs in ${(performance.now() - t0).toFixed(0)} ms (parallel) · W to watch them`);
        }).catch((e) => say(String(e?.message ?? e), true));
        break;
      }
      case 'goal': {
        const r = need();
        if (args[0] === 'clear') { r.goals = []; getView(r).params?.(); save(); break; }
        const tol = args.length >= 3 ? evalNum(args[args.length - 1]) : NaN;
        const hasTol = args.length >= 3 && Number.isFinite(tol) && Number.isFinite(evalNum(args[args.length - 2]));
        const v = evalNum(args[args.length - (hasTol ? 2 : 1)]);
        const q = args.slice(0, args.length - (hasTol ? 2 : 1)).join(' ');
        if (!q || !Number.isFinite(v)) throw new Error('usage: :goal <quantity text> <value> [tolerance]');
        r.goals.push({ q, v, tol: hasTol ? tol : Math.abs(v) * 0.01 || 1e-3 });
        getView(r).params?.();
        const ge = goalEval(r, r.goals[r.goals.length - 1]);
        say(`goal on '${ge.label}': ${ge.hit ? 'HIT' : 'MISS'} (Δ ${fmt(ge.err)})`, !ge.hit);
        save();
        break;
      }
      case 'export': exportTab(t, (args[0] ?? 'csv').toLowerCase()); break;
      case 'preset': case 'presets': {
        const P = loadPresets();
        const sub = cmd === 'presets' ? 'ls' : args[0];
        const name = args.slice(1).join(' ');
        if (sub === 'save') { const r = need(); if (!name) throw new Error('usage: :preset save <name>'); P[name] = { mod: r.mod.id, p: r.p, s: r.s }; storePresets(P); say(`preset '${name}' saved`); }
        else if (sub === 'load') {
          const q = P[name];
          if (!q) throw new Error(`no preset '${name}'`);
          const m = findModule(q.mod)!;
          const r = run && run.mod === m ? run : undefined;
          if (r) { pushUndo(r); r.p = { ...defaults(m), ...q.p }; r.s = { ...q.s }; runSoon(r); }
          else addTab(newRun(m, q.p, q.s, name));
          say(`preset '${name}' loaded`);
        } else if (sub === 'rm') { delete P[name]; storePresets(P); say(`preset '${name}' removed`); }
        else say(Object.keys(P).length ? `presets: ${Object.entries(P).map(([k, v]) => `${k} (${v.mod})`).join(', ')}` : 'no presets — :preset save <name>');
        break;
      }
      case 'vs': case 'vsplit': case 'sp': split(args[0] ? S.tabs[Number(args[0]) - 1]?.id : undefined); break;
      case 'only': S.panes = [S.panes[S.ap]]; S.ap = 0; layout(); break;
      case 'close': closePane(); break;
      case 'q': case 'quit': if (t) closeTab(t.id); break;
      case 'q!': if (t) closeTab(t.id); break;
      case 'qa': case 'qa!': { S.tabs.forEach((q) => views.get(q.id)?.el.remove()); views.clear(); S.tabs = []; const w = newRun(findModule('projectile')!); w.title = 'workspace'; S.tabs.push(w); S.panes = [w.id]; S.ap = 0; runTab(w); layout(); save(); break; }
      case 'speed': { const v = evalNum(args[0] ?? ''); if (!(v > 0)) throw new Error('usage: :speed <multiplier>'); S.speed = v; say(`playback speed ×${v}`); break; }
      case 'selftest': {
        // one job per module, spread over the worker pool; results merged back in module order
        const t0 = performance.now();
        let done = 0;
        say(`self-test: 0/${MODULES.length} modules on ${pool.size} workers …`);
        Promise.all(MODULES.map((m) => pool.submit<CaseResult[]>({ kind: 'selftest', mods: [m.id] }).then((o) => { say(`self-test: ${++done}/${MODULES.length} modules …`); return o.res; })))
          .then((parts) => {
            const d = parts.flat();
            addTab(mkPage('selftest', d));
            const F = d.reduce((a, c) => a + c.fail, 0);
            say(`self-test: ${d.reduce((a, c) => a + c.pass, 0)} pass · ${F} fail · ${(performance.now() - t0).toFixed(0)} ms`, F > 0);
          }).catch((e) => say(String(e?.message ?? e), true));
        break;
      }
      case 'watch': case 'theater': {
        let src: { name: string; tabId?: number; mod: SimModule; p: Params; s: Settings; res?: Result }[] = [];
        if (args[0] === 'all') src = S.tabs.filter((q): q is RunTab => q.kind === 'run').map(fromTab);
        else if (args.length) src = args.map((a) => S.tabs[Number(a) - 1]).flatMap((q): WatchSrc[] => (q?.kind === 'run' ? [fromTab(q)] : q?.kind === 'cmp' ? q.runs : []));
        else if (t?.kind === 'run') src = [fromTab(t)];
        else if (t?.kind === 'cmp') src = t.runs;
        else if (t?.kind === 'watch') src = t.runs;
        else throw new Error('usage: :watch [all | tab numbers]  (from a run, compare or sweep tab)');
        openWatch(src.filter((q) => q.res || q.tabId !== undefined));
        break;
      }
      case 'multi': {
        // :multi <param> v1 v2 v3 … → one run per value, all opened together in the theater
        const r = need();
        const k = args[0];
        const vals = args.slice(1).map(evalNum);
        if (!k || vals.length < 1 || vals.some((v) => !Number.isFinite(v))) throw new Error('usage: :multi <param> <v1> <v2> …');
        if (vals.length > 9) throw new Error('theater shows at most 9 runs');
        const isSet = ['dt', 'steps'].includes(k);
        const d = paramsOf(r).find((q) => q.k === k);
        if (!isSet && (!d || d.o)) throw new Error(`'${k}' is not a numeric parameter`);
        const tabs = vals.map((v) => {
          const p = { ...r.p }, s = { ...r.s };
          if (isSet) { if (k === 'dt') s.dt = v; else s.steps = Math.max(1, Math.round(v)); } else p[k] = v;
          const nt = newRun(r.mod, p, s, `${r.mod.id}:${k}=${fmtP(v)}`);
          S.tabs.push(nt);
          return nt;
        });
        say(`running ${tabs.length} variants …`);
        runSequential(tabs, () => { openWatch(tabs.map(fromTab)); save(); });
        break;
      }
      case 'session': {
        // :session save → write all simulation tabs (params, settings, goals) to a .json file; :session load → restore
        if (args[0] === 'save') {
          const tabs = S.tabs.filter((q): q is RunTab => q.kind === 'run').map((q) => ({ mod: q.mod.id, p: q.p, s: q.s, title: q.title, goals: q.goals }));
          download(`unisim-session-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ unisim: 2, tabs, presets: loadPresets() }, null, 1), 'application/json');
        } else if (args[0] === 'load') {
          openText('json').then((f) => {
            if (!f) { say('load cancelled'); return; }
            const d = JSON.parse(f.text);
            if (!Array.isArray(d?.tabs)) throw new Error('not a UniSim session file');
            if (d.presets) storePresets({ ...loadPresets(), ...d.presets });
            const added: RunTab[] = [];
            for (const q of d.tabs) { const m = findModule(q.mod); if (!m) continue; const nt = newRun(m, q.p, q.s, q.title); nt.goals = q.goals ?? []; S.tabs.push(nt); added.push(nt); }
            runSequential(added, () => { if (added[0]) showTab(added[0].id); save(); say(`loaded ${added.length} tabs from ${f.name}`); });
          }).catch((e) => say(`load failed: ${e?.message ?? e}`, true));
        } else throw new Error('usage: :session save | load');
        break;
      }
      case 'live': {
        S.live = args[0] ? args[0] === 'on' : !S.live;
        say(`live playback ${S.live ? 'ON — space streams data into graphs and table' : 'OFF — space only moves the cursor over the full result'}`);
        break;
      }
      case 'realtime': case 'rt': {
        S.realtime = args[0] ? args[0] === 'on' : !S.realtime;
        say(`playback ${S.realtime ? 'in REAL TIME (1 simulated s per s, × :speed)' : 'compressed to 3–20 s per run'}`);
        break;
      }
      case 'done': { const r = need(); if (r.editing) finishEdit(r); else say('not editing (press E)'); break; }
      case 'runall': {
        const tabs = S.tabs.filter((q): q is RunTab => q.kind === 'run');
        say(`re-running ${tabs.length} tabs …`);
        runSequential(tabs, () => say(`re-ran ${tabs.length} tabs`));
        break;
      }
      case 'help': case 'h': case 'tutorial': {
        if (args[0] === 'stop' || args[0] === 'off') stopTutorial();
        else if (args[0] === 'keys') exec('keys');
        else startTutorial();
        break;
      }
      case 'keys': { const hp = S.tabs.find((q) => q.kind === 'help'); if (hp) showTab(hp.id); else addTab(mkPage('help')); break; }
      case 'next': coachGo(1); break;
      case 'back': coachGo(-1); break;
      case 'ls': say(S.tabs.map((q, i) => `${i + 1}:${q.title}`).join('  ')); break;
      case 'b': case 'buffer': { const q = S.tabs[Number(args[0]) - 1]; if (!q) throw new Error('no such tab'); showTab(q.id); break; }
      case 'tabn': case 'bn': cycleTab(1); break;
      case 'tabp': case 'bp': cycleTab(-1); break;
      case 'w': case 'wa': save(); say('session saved (it also autosaves on every change)'); break;
      default: throw new Error(`unknown command :${cmd}  (:help)`);
    }
  } catch (e: any) {
    say(String(e?.message ?? e), true);
  }
}

function split(id?: number) {
  if (S.panes.length >= 4) { say('max 4 panes', true); return; }
  const vis = new Set(S.panes);
  let tid = id;
  if (tid === undefined || vis.has(tid)) tid = S.tabs.find((q) => !vis.has(q.id))?.id;
  if (tid === undefined) { const ix = mkPage('index'); S.tabs.push(ix); tid = ix.id; }
  S.panes.splice(S.ap + 1, 0, tid);
  S.ap += 1;
  layout();
}
function closePane() {
  if (S.panes.length < 2) { say('last pane'); return; }
  S.panes.splice(S.ap, 1);
  S.ap = Math.max(0, S.ap - 1);
  layout();
}

// ---------- export ----------
// native "Save as" dialog; reports where the file went
function download(name: string, text: string, type: string) {
  saveText(name, text, type)
    .then((path) => say(path ? `saved ${path}` : 'save cancelled'))
    .catch((e) => say(`save failed: ${e?.message ?? e}`, true));
}
const csvCell = (v: unknown) => { const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function exportTab(t: Tab | undefined, kind: string) {
  if (!t) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  if (t.kind === 'run') {
    if (!t.res) throw new Error('nothing to export');
    const r = t.res;
    if (kind === 'json') {
      download(`${t.title}-${stamp}.json`, JSON.stringify({ module: t.mod.id, params: t.p, settings: t.s, scalars: r.scalars, checks: r.checks.map((c) => ({ ...c, pass: checkPass(c) })), targets: r.targets, goals: t.goals.map((g) => ({ ...g, ...goalEval(t, g) })), columns: r.cols, rows: r.rows }, null, 1), 'application/json');
    } else {
      const head = [`# unisim ${t.mod.id}`, `# params ${Object.entries(t.p).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k}=${v}`).join(' ')}`, `# method=${t.s.method} dt=${t.s.dt} steps=${t.s.steps}`];
      download(`${t.title}-${stamp}.csv`, [...head, r.cols.map(csvCell).join(','), ...r.rows.map((q) => q.map(csvCell).join(','))].join('\n'), 'text/csv');
    }
  } else if (t.kind === 'cmp') {
    if (kind === 'json') download(`${t.title}-${stamp}.json`, JSON.stringify({ sweep: t.sweep, runs: t.runs.map((r) => ({ name: r.name, module: r.mod.id, params: r.p, settings: r.s, scalars: r.res.scalars, checks: r.res.checks, columns: r.res.cols, rows: r.res.rows })) }, null, 1), 'application/json');
    else {
      const labels = [...new Set(t.runs.flatMap((r) => r.res.scalars.map((s) => s.l)))];
      const lines = [['run', ...(t.sweep ? [t.sweep.key] : []), ...labels].map(csvCell).join(',')];
      t.runs.forEach((r, i) => lines.push([r.name, ...(t.sweep ? [t.sweep.vals[i]] : []), ...labels.map((l) => r.res.scalars.find((s) => s.l === l)?.v ?? '')].map(csvCell).join(',')));
      download(`${t.title}-${stamp}.csv`, lines.join('\n'), 'text/csv');
    }
  } else if (t.kind === 'watch') {
    // snapshot of every watched run at the theater's current instant
    const rows = t.runs.map((r) => ({ r, i: rowAtRun(t, r) }));
    if (kind === 'json') download(`${t.title.replace(/[:\s]/g, '_')}-${stamp}.json`, JSON.stringify({ clock: t.clock, sync: t.sync, runs: rows.map(({ r, i }) => ({ name: r.name, module: r.mod.id, params: r.p, settings: r.s, row: i, columns: r.res.cols, values: r.res.rows[i] })) }, null, 1), 'application/json');
    else {
      const cols = [...new Set(rows.flatMap(({ r }) => r.res.cols))];
      const lines = [['run', 'row', ...cols].map(csvCell).join(',')];
      rows.forEach(({ r, i }) => lines.push([r.name, i, ...cols.map((c) => { const j = r.res.cols.indexOf(c); return j < 0 ? '' : r.res.rows[i][j]; })].map(csvCell).join(',')));
      download(`${t.title.replace(/[:\s]/g, '_')}-${stamp}.csv`, lines.join('\n'), 'text/csv');
    }
  } else throw new Error('nothing to export here');
}

// ---------- persistence ----------
type PresetMap = Record<string, { mod: string; p: Params; s: Settings }>;
function loadPresets(): PresetMap { try { return JSON.parse(localStorage.getItem('unisim.presets') ?? '{}'); } catch { return {}; } }
function storePresets(p: PresetMap) { try { localStorage.setItem('unisim.presets', JSON.stringify(p)); } catch { say('localStorage unavailable', true); } }
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = window.setTimeout(() => {
    try {
      const tabs = S.tabs.filter((t): t is RunTab => t.kind === 'run').map((t) => ({ mod: t.mod.id, p: t.p, s: t.s, title: t.title, goals: t.goals }));
      localStorage.setItem('unisim.session', JSON.stringify({ tabs }));
    } catch { /* storage unavailable: session is not persisted */ }
  }, 300);
}
function restore(): boolean {
  try {
    const d = JSON.parse(localStorage.getItem('unisim.session') ?? 'null');
    if (!d?.tabs?.length) return false;
    for (const q of d.tabs) {
      const m = findModule(q.mod);
      if (!m) continue;
      const t = newRun(m, q.p, q.s, q.title);
      t.goals = q.goals ?? [];
      S.tabs.push(t);
      runTab(t);
    }
    return S.tabs.length > 0;
  } catch { return false; }
}

// ---------- normal-mode keys ----------
let pend = '';
let count = '';
function moveSel(t: Tab, d: number, abs?: number) {
  if (t.kind === 'run') {
    if (t.focus === 'params') { const n = prows(t).length; t.sel = abs !== undefined ? abs : Math.max(0, Math.min(n - 1, t.sel + d)); getView(t).params?.(); }
    else if (t.res) { if (!t.playing) endReveal(t); const n = t.res.rows.length; t.row = abs !== undefined ? Math.max(0, Math.min(n - 1, abs)) : Math.max(0, Math.min(n - 1, t.row + d)); getView(t).cursor(); }
  } else if (t.kind === 'index') {
    const v = getView(t);
    const n = MODULES.filter((m) => !t.filter || (m.name + ' ' + m.id + ' ' + m.desc).toLowerCase().includes(t.filter.toLowerCase())).length;
    t.sel = abs !== undefined ? Math.max(0, Math.min(n - 1, abs)) : Math.max(0, Math.min(n - 1, t.sel + d));
    v.refresh();
  } else getView(t).scroll?.(abs !== undefined ? (abs === 0 ? -1e9 : 1e9) : d * 40);
}
function dispatch(k: string, n: number, hadCount: boolean) {
  const t = cur();
  if (!t) return;
  if (t.kind === 'run' && t.editing && t.sed) {
    const r = editKey(t.sed, k, n);
    if (r === 'done') { finishEdit(t); return; }
    if (r === 'handled') { getView(t).cursor(); return; }
    if (![':', '?', 'gt', 'gT', 'wv', 'wh', 'wl', 'ww', 'wo', 'wc'].includes(k)) return;
  }
  if (t.kind === 'watch') {
    if (k === 'r') { refreshWatch(t); return; }
    if (watchKey(t, k, n, getView(t), say)) { lastFrame = performance.now(); renderStatus(); return; }
  }
  if (k === 'W') { exec('watch'); return; }
  if (k === 'E' && t.kind === 'run') { exec('edit'); return; }
  if (k === 'M') { openPicker(); return; }
  if (t.kind === 'index' && k === 'Escape') { closeTab(t.id); const w = workspace(); if (w) showTab(w.id); return; }
  if (S.coach && (k === 'N' || k === 'B')) { coachGo(k === 'N' ? 1 : -1); return; }
  const run = t.kind === 'run' ? t : undefined;
  switch (k) {
    case 'gt': if (hadCount) { const q = S.tabs[n - 1]; if (q) showTab(q.id); } else cycleTab(1); return;
    case 'gT': case 'H': cycleTab(-n); return;
    case 'L': cycleTab(n); return;
    case 'j': case 'ArrowDown': moveSel(t, n); return;
    case 'k': case 'ArrowUp': moveSel(t, -n); return;
    case 'gg': moveSel(t, 0, hadCount ? n - 1 : 0); return;
    case 'G': moveSel(t, 0, hadCount ? n - 1 : 1e12); return;
    case 'C-d': case 'C-f': case 'PageDown': if (run) { run.focus = 'table'; getView(run).params?.(); } moveSel(t, (k === 'C-f' ? 22 : 11) * n); return;
    case 'C-u': case 'C-b': case 'PageUp': if (run) { run.focus = 'table'; getView(run).params?.(); } moveSel(t, -(k === 'C-b' ? 22 : 11) * n); return;
    case 'Tab': if (run) { run.focus = run.focus === 'params' ? 'table' : 'params'; const v = getView(run); v.params?.(); v.cursor(); } return;
    case ':': openCmd(':'); return;
    case '/': openCmd('/'); return;
    case '?': exec('keys'); return;
    case 'n': if (S.lastSearch) search(S.lastSearch, true); return;
    case 'x': closeTab(t.id); return;
    case 'wv': case 'ws': case 'C-v': split(); return;
    case 'wh': case 'wk': S.ap = Math.max(0, S.ap - 1); layoutFocus(); return;
    case 'wl': case 'wj': S.ap = Math.min(S.panes.length - 1, S.ap + 1); layoutFocus(); return;
    case 'ww': S.ap = (S.ap + 1) % S.panes.length; layoutFocus(); return;
    case 'wo': exec('only'); return;
    case 'wc': case 'wq': closePane(); return;
    case 'Escape': if (run) run.playing = false; say(''); return;
  }
  if (t.kind === 'index') {
    if (k === 'Enter' || k === 'o' || k === 'l') {
      const L = MODULES.filter((m) => !t.filter || (m.name + ' ' + m.id + ' ' + m.desc).toLowerCase().includes(t.filter.toLowerCase()));
      const m = L[t.sel];
      if (m) pickSim(m);
    }
    return;
  }
  if (!run) return;
  const v = getView(run);
  const rows = prows(run);
  switch (k) {
    case 'i': case 'a': case 'c': case 'Enter': if (run.focus === 'params') startInsert(run); return;
    case 'h': case 'ArrowLeft': case 'l': case 'ArrowRight': case '<': case '>': case '-': case '+': case '=': {
      if (run.focus !== 'params') { moveSel(run, (k === 'h' || k === 'ArrowLeft' || k === '<' || k === '-' ? -1 : 1) * n * (k === '<' || k === '>' ? 10 : 1)); return; }
      const sign = k === 'h' || k === 'ArrowLeft' || k === '<' || k === '-' ? -1 : 1;
      const mult = k === '<' || k === '>' ? 10 : 1;
      if (setParam(run, rows[run.sel].k, '', { nudge: sign * mult * n })) runSoon(run);
      v.params?.();
      return;
    }
    case ' ': {
      if (!run.res) return;
      run.playing = !run.playing;
      if (run.playing) {
        const n = run.res.rows.length;
        // starting from the finished view: replay from t=0 with data streaming in
        if (run.reveal === null && S.live) run.row = 0;
        else if (run.row >= n - 1) run.row = 0;
        if (S.live) run.reveal = run.row;
      }
      lastFrame = performance.now();
      v.charts?.();
      v.cursor();
      renderStatus();
      return;
    }
    case '[': moveRow(run, -n); return;
    case ']': moveRow(run, n); return;
    case '{': moveRow(run, -Math.max(1, Math.round((run.res?.rows.length ?? 0) / 10)) * n); return;
    case '}': moveRow(run, Math.max(1, Math.round((run.res?.rows.length ?? 0) / 10)) * n); return;
    case 'r': runSoon(run); return;
    case 'R': exec('reset'); return;
    case 'u': { const u = run.undo.pop(); if (!u) { say('already at oldest change'); return; } run.redo.push([{ ...run.p }, { ...run.s }]); [run.p, run.s] = [u[0], u[1]]; runSoon(run); return; }
    case 'C-r': { const u = run.redo.pop(); if (!u) { say('already at newest change'); return; } run.undo.push([{ ...run.p }, { ...run.s }]); [run.p, run.s] = [u[0], u[1]]; runSoon(run); return; }
    case 'yy': exec('dup'); return;
  }
}
function moveRow(t: RunTab, d: number) {
  if (!t.res) return;
  t.row = Math.max(0, Math.min(t.res.rows.length - 1, t.row + d));
  if (t.reveal !== null) t.reveal = t.row; // frame-stepping a live view keeps streaming semantics
  getView(t).cursor();
  if (t.reveal !== null) getView(t).charts?.();
}
function layoutFocus() { renderPaneFocus(); renderTabbar(); renderStatus(); }

function search(q: string, next = false) {
  const t = cur();
  if (!t) return;
  S.lastSearch = q;
  if (t.kind === 'index') { t.filter = q; t.sel = 0; getView(t).refresh(); return; }
  if (t.kind !== 'run') return;
  const rows = prows(t);
  const start = next ? t.sel + 1 : 0;
  for (let i = 0; i < rows.length; i++) {
    const j = (start + i) % rows.length;
    if ((rows[j].l + ' ' + rows[j].k).toLowerCase().includes(q.toLowerCase())) { t.sel = j; t.focus = 'params'; getView(t).params?.(); return; }
  }
  say(`pattern not found: ${q}`, true);
}

// ---------- playback ----------
let lastFrame = performance.now();
function tick(now: number) {
  const dtw = (now - lastFrame) / 1000;
  lastFrame = now;
  for (const id of S.panes) {
    const t = S.tabs[tabIndex(id)];
    if (t?.kind === 'watch') {
      if (!t.playing) continue;
      advance(t, dtw, S.realtime);
      getView(t).cursor();
      if (!t.playing) renderStatus();
      continue;
    }
    if (t?.kind !== 'run' || !t.playing || !t.res) continue;
    const R = t.res.rows;
    const n = R.length;
    if (t.mod.timeBased && t.res.cols[0] === 't' && n > 1) {
      // compressed: a whole run takes 3–20 s of wall time; realtime: 1 simulated s per wall s
      const T = R[n - 1][0] - R[0][0];
      const rate = (S.realtime ? 1 : T / Math.min(20, Math.max(3, T))) * S.speed;
      const target = R[t.row][0] + dtw * rate;
      let i = t.row;
      while (i < n - 1 && R[i + 1][0] <= target) i++;
      t.row = i === t.row && i < n - 1 && !S.realtime ? i + 1 : i;
    } else t.row += Math.max(1, Math.round((n / 300) * S.speed));
    if (t.reveal !== null) t.reveal = Math.min(t.row, n - 1);
    if (t.row >= n - 1) {
      t.row = n - 1; t.playing = false;
      // finished: hand back the complete result with every graph filled
      t.reveal = null;
      getView(t).charts?.();
      renderStatus();
    }
    getView(t).cursor();
  }
  requestAnimationFrame(tick);
}

// ---------- boot ----------
export function boot() {
  // desktop app: native feel — no webview context menu or page zoom/reload shortcuts stealing keys
  document.documentElement.classList.add('app');
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => { if (e.key === 'F5' || (e.ctrlKey && ['+', '-', '=', '0'].includes(e.key))) e.preventDefault(); }, true);
  document.addEventListener('keydown', (e) => {
    if (S.mode === 'insert' || S.mode === 'command' || S.mode === 'search') return;
    if (e.altKey || e.metaKey) return;
    let k = e.key;
    if (e.ctrlKey) {
      if (!['d', 'u', 'f', 'b', 'r', 'v'].includes(k.toLowerCase())) return;
      k = 'C-' + k.toLowerCase();
    }
    if (k === 'Shift' || k === 'Control') return;
    e.preventDefault();
    if (/^[0-9]$/.test(k) && !pend && !(k === '0' && !count)) { count += k; renderStatus(); return; }
    const seq = pend + k;
    // in EDIT, g (grab) and y (copy) act at once instead of starting gg / yy
    const ct = cur();
    const prefixes = ct?.kind === 'run' && ct.editing ? ['w', 'Z'] : ['g', 'w', 'y', 'Z'];
    if (prefixes.includes(seq)) { pend = seq; renderStatus(); return; }
    pend = '';
    const n = count ? parseInt(count, 10) : 1;
    const had = !!count;
    count = '';
    if (seq === 'ZZ' || seq === 'ZQ') { exec('q'); return; }
    dispatch(seq, n, had);
    renderStatus();
  });
  const inp = $('cmdinput') as HTMLInputElement;
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeCmd(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = inp.value, srch = S.mode === 'search';
      closeCmd();
      if (srch) search(v); else exec(v);
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); if (S.mode === 'command') complete(inp); return; }
    if (e.key === 'ArrowUp' && S.mode === 'command') { e.preventDefault(); hi = Math.max(0, hi - 1); inp.value = hist[hi] ?? ''; }
    if (e.key === 'ArrowDown' && S.mode === 'command') { e.preventDefault(); hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] ?? ''; }
    if (e.key === 'Backspace' && !inp.value) { e.preventDefault(); closeCmd(); }
  });
  inp.addEventListener('blur', () => { if (S.mode === 'command' || S.mode === 'search') closeCmd(); });
  $('tabbar').addEventListener('click', (e) => { const el = (e.target as HTMLElement).closest('.tab') as HTMLElement | null; if (el) showTab(Number(el.dataset.id)); });
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = window.setTimeout(() => S.panes.forEach((id) => { const t = S.tabs[tabIndex(id)]; if (t) getView(t).layout(); }), 120); });

  const restored = restore();
  if (!S.tabs.length) { const w = newRun(findModule('projectile')!); w.title = 'workspace'; S.tabs.push(w); runTab(w); }
  S.panes = [S.tabs[0].id];
  layout();
  if (restored) say('session restored · :help guided tour · ? key list');
  else startTutorial(); // first launch: open the guided tour straight away
  requestAnimationFrame(tick);
  // pre-spawn simulation workers once the UI is idle so the first sweep/self-test starts instantly
  const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200));
  idle(() => pool.warm());
}
