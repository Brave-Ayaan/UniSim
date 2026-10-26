// Theater: watch one or many simulations live on a shared clock, with a live comparison of their data.
import type { Params, Result, Settings, SimModule } from '../core/types';
import { Gfx, PALETTE, COL } from '../core/gfx';
import { fmt } from '../core/num';
import { drawChart, revealChart, type ChartMap } from './chart';

export interface WatchRun { name: string; tabId?: number; mod: SimModule; p: Params; s: Settings; res: Result }
export interface WatchTab {
  kind: 'watch'; id: number; title: string; runs: WatchRun[];
  clock: number; playing: boolean; speed: number; sync: 'time' | 'progress'; loop: boolean; col: number; trail: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** true when a run's first column is simulation time and can share a clock with other runs */
const timed = (r: WatchRun) => r.mod.timeBased && r.res.cols[0] === 't' && r.res.rows.length > 1;

export function canTimeSync(t: WatchTab) { return t.runs.every(timed); }

/** clock domain: seconds (time sync) or 0..1 (progress sync) */
export function clockMax(t: WatchTab) {
  if (t.sync === 'progress') return 1;
  let m = 0;
  for (const r of t.runs) m = Math.max(m, r.res.rows[r.res.rows.length - 1][0]);
  return m || 1;
}

/** row of a run at the current clock (binary search on the time column; clamps past the run's end) */
export function rowAt(t: WatchTab, r: WatchRun): number {
  const R = r.res.rows, n = R.length;
  if (n <= 1) return 0;
  if (t.sync === 'progress') return Math.round(Math.max(0, Math.min(1, t.clock)) * (n - 1));
  const c = t.clock;
  if (c <= R[0][0]) return 0;
  if (c >= R[n - 1][0]) return n - 1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m][0] <= c) lo = m; else hi = m; }
  return c - R[lo][0] < R[hi][0] - c ? lo : hi;
}

/** columns present in every run (by name, excluding the clock column), in run 1's order */
export function commonCols(t: WatchTab): string[] {
  const [a, ...rest] = t.runs;
  if (!a) return [];
  return a.res.cols.slice(1).filter((c) => rest.every((r) => r.res.cols.includes(c)));
}

export function advance(t: WatchTab, dtWall: number, realtime = false) {
  const T = clockMax(t);
  // ≥3 s and ≤20 s of wall time for a full pass at ×1 (real time when it fits); realtime: 1 sim s per s
  const rate = t.sync === 'progress' ? 1 / 8 : realtime ? 1 : T / Math.min(20, Math.max(3, T));
  t.clock += dtWall * rate * t.speed;
  if (t.clock >= T) {
    if (t.loop) t.clock = 0;
    else { t.clock = T; t.playing = false; }
  }
}

/** smallest clock increment that moves at least one run by one row */
export function stepSize(t: WatchTab) {
  if (t.sync === 'progress') return 1 / Math.max(2, ...t.runs.map((r) => r.res.rows.length - 1));
  let d = Infinity;
  for (const r of t.runs) { const R = r.res.rows; if (R.length > 1) d = Math.min(d, (R[R.length - 1][0] - R[0][0]) / (R.length - 1)); }
  return Number.isFinite(d) ? d : clockMax(t) / 100;
}

export interface WatchView { el: HTMLElement; refresh(): void; cursor(): void; layout(): void; scroll?(d: number): void }

export function watchView(t: WatchTab): WatchView {
  const el = document.createElement('div');
  el.className = 'watch';
  let canvases: HTMLCanvasElement[] = [], labels: HTMLElement[] = [], fbds: (HTMLElement | null)[] = [];
  let live: HTMLElement, chartCv: HTMLCanvasElement, chartCur: HTMLElement, bar: HTMLElement, prog: HTMLElement;
  let map: ChartMap | null = null;
  let lastTable = 0;

  const build = () => {
    const n = t.runs.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    const single = n === 1 && !!t.runs[0].res.fbd;
    el.innerHTML = `<div class="wgrid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${t.runs.map((r, i) => `<div class="wcell${single ? ' wide' : ''}"><div class="wlab" style="--c:${PALETTE[i % PALETTE.length]}"></div><div class="wbody"><canvas></canvas>${single ? '<pre class="fbd"></pre>' : ''}</div></div>`).join('')}</div>
      <div class="wbar"><span class="wplay"></span><div class="wprog"><div></div></div></div>
      <div class="wlow"><div class="wlive"></div><div class="chart"><canvas></canvas><div class="cur"></div></div></div>`;
    canvases = [...el.querySelectorAll('.wcell canvas')] as HTMLCanvasElement[];
    labels = [...el.querySelectorAll('.wlab')] as HTMLElement[];
    fbds = [...el.querySelectorAll('.wcell')].map((c) => c.querySelector('.fbd') as HTMLElement | null);
    live = el.querySelector('.wlive') as HTMLElement;
    chartCv = el.querySelector('.wlow canvas') as HTMLCanvasElement;
    chartCur = el.querySelector('.wlow .cur') as HTMLElement;
    bar = el.querySelector('.wplay') as HTMLElement;
    prog = el.querySelector('.wprog > div') as HTMLElement;
    el.querySelector('.wprog')!.addEventListener('click', (e) => {
      const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
      t.clock = ((e as MouseEvent).clientX - b.left) / b.width * clockMax(t);
      cursor(true);
    });
    drawLiveChart();
    cursor(true);
  };

  let lastChart = 0;
  const drawLiveChart = (rows?: number[]) => {
    const cc = commonCols(t);
    if (!cc.length) { map = null; chartCv.getContext('2d')?.clearRect(0, 0, chartCv.width, chartCv.height); return; }
    t.col = Math.max(0, Math.min(cc.length - 1, t.col));
    const name = cc[t.col];
    const prg = t.sync === 'progress';
    const full = {
      id: 'live', title: `live: ${name}  (j/k to change)`, xl: prg ? 'progress' : t.runs[0].res.cols[0], yl: '',
      series: t.runs.map((r) => {
        const j = r.res.cols.indexOf(name), R = r.res.rows, n = R.length;
        return { name: r.name, x: prg ? R.map((_, i) => i / Math.max(1, n - 1)) : R.map((q) => q[0]), y: R.map((q) => q[j]) };
      }),
    };
    // data streams in up to each run's playhead; axes fixed to the full runs
    const shown = rows ? { ...full, series: full.series.map((sr, i) => revealChart({ ...full, series: [sr] }, rows[i] + 1, sr.x.length).series[0]) } : full;
    map = drawChart(chartCv, shown, { colors: t.runs.map((_, i) => PALETTE[i % PALETTE.length]), rangeFrom: full });
    lastChart = performance.now();
  };

  const liveTable = (rows: number[]) => {
    const cc = commonCols(t);
    const base = t.runs[0];
    const idx = (r: WatchRun, c: string) => r.res.cols.indexOf(c);
    let h = `<table class="t"><tr><th>run</th><th>${esc(base.res.cols[0])}</th><th>row</th>${cc.map((c, k) => `<th class="${k === t.col ? 'selc' : ''}">${esc(c)}</th>`).join('')}</tr>`;
    t.runs.forEach((r, i) => {
      const q = r.res.rows[rows[i]];
      h += `<tr><td><span class="swatch" style="background:${PALETTE[i % PALETTE.length]}"></span>${esc(r.name)}</td><td>${fmt(q[0])}</td><td>${rows[i]}</td>${cc.map((c, k) => `<td class="${k === t.col ? 'selc' : ''}">${fmt(q[idx(r, c)])}</td>`).join('')}</tr>`;
    });
    if (t.runs.length > 1 && cc.length) {
      const q0 = base.res.rows[rows[0]];
      h += `<tr><td class="dim" colspan="${3 + cc.length}">Δ vs ${esc(base.name)} at this instant</td></tr>`;
      t.runs.slice(1).forEach((r, i) => {
        const q = r.res.rows[rows[i + 1]];
        h += `<tr><td><span class="swatch" style="background:${PALETTE[(i + 1) % PALETTE.length]}"></span>Δ ${esc(r.name)}</td><td>${fmt(q[0] - q0[0])}</td><td></td>${cc.map((c, k) => { const d = q[idx(r, c)] - q0[idx(base, c)]; return `<td class="${k === t.col ? 'selc' : ''} ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${fmt(d)}</td>`; }).join('')}</tr>`;
      });
    }
    live.innerHTML = h + '</table>';
  };

  const cursor = (force = false) => {
    if (!canvases.length) return;
    const rows = t.runs.map((r) => rowAt(t, r));
    t.runs.forEach((r, i) => {
      try { r.res.draw?.(new Gfx(canvases[i]), rows[i]); } catch (e) { console.error(e); }
      if (!r.res.draw) { const g = new Gfx(canvases[i]); g.hud(['(no visualisation)']); }
      const q = r.res.rows[rows[i]];
      const done = rows[i] === r.res.rows.length - 1;
      labels[i].innerHTML = `<b>${esc(r.name)}</b> <span class="dim">${esc(r.mod.id)} · ${esc(r.res.cols[0])}=${fmt(q[0])} · row ${rows[i] + 1}/${r.res.rows.length}${done ? ' · end' : ''}</span>`;
      const fb = fbds[i];
      if (fb && r.res.fbd) fb.textContent = r.res.fbd(rows[i]).join('\n');
    });
    const T = clockMax(t);
    prog.style.width = `${(100 * Math.min(1, t.clock / T)).toFixed(2)}%`;
    bar.innerHTML = `${t.playing ? '▶' : '❚❚'}  ${t.sync === 'time' ? `t = ${fmt(t.clock)} / ${fmt(T)} s` : `progress ${(100 * t.clock).toFixed(1)}%`}  ·  ×${t.speed}  ·  sync ${t.sync}${t.loop ? ' · loop' : ''}  ·  <span class="dim">space play · [ ] step · { } ±5% · +/- speed · s sync · o loop · j/k variable · 0/G ends · r refresh</span>`;
    // live table is the costliest DOM update: throttle to ~20 Hz while playing
    const now = performance.now();
    if (force || !t.playing || now - lastTable > 50) { liveTable(rows); lastTable = now; }
    const atEnd = t.clock >= T - 1e-12;
    if (t.playing && now - lastChart > 50) drawLiveChart(rows);
    else if (!t.playing && (force || atEnd)) drawLiveChart(atEnd ? undefined : rows);
    if (map) {
      const x = t.clock;
      const px = map.xToPx(x);
      chartCur.style.display = px >= map.left && px <= map.right ? 'block' : 'none';
      chartCur.style.left = `${px}px`;
      chartCur.style.top = `${map.top}px`;
      chartCur.style.height = `${map.bottom - map.top}px`;
    }
  };

  // layout() can arrive before the first build (e.g. the guide panel resizing panes): build instead
  return { el, refresh: build, cursor: () => cursor(), layout: () => { if (!chartCv) { build(); return; } drawLiveChart(); cursor(true); }, scroll(d) { el.scrollTop += d; } };
}

/** key handling inside the theater; returns true when consumed */
export function watchKey(t: WatchTab, k: string, n: number, v: WatchView, say: (m: string, e?: boolean) => void): boolean {
  const T = clockMax(t);
  switch (k) {
    case ' ': t.playing = !t.playing; if (t.playing && t.clock >= T) t.clock = 0; break;
    case '[': t.clock = Math.max(0, t.clock - n * stepSize(t)); t.playing = false; break;
    case ']': t.clock = Math.min(T, t.clock + n * stepSize(t)); t.playing = false; break;
    case '{': t.clock = Math.max(0, t.clock - 0.05 * T * n); break;
    case '}': t.clock = Math.min(T, t.clock + 0.05 * T * n); break;
    case '0': case 'gg': t.clock = 0; break;
    case 'G': case '$': t.clock = T; t.playing = false; break;
    case '+': case '=': case '>': t.speed = Math.min(256, t.speed * 2); say(`speed ×${t.speed}`); break;
    case '-': case '<': t.speed = Math.max(1 / 64, t.speed / 2); say(`speed ×${t.speed}`); break;
    case 's':
      if (t.sync === 'progress' && !canTimeSync(t)) { say('time sync needs every run to have a time column (static solvers use progress sync)', true); return true; }
      t.clock = t.sync === 'time' ? t.clock / T : t.clock * clockMax({ ...t, sync: 'time' });
      t.sync = t.sync === 'time' ? 'progress' : 'time';
      v.layout();
      return true;
    case 'o': t.loop = !t.loop; say(`loop ${t.loop ? 'on' : 'off'}`); break;
    case 'j': case 'ArrowDown': t.col += n; v.layout(); return true;
    case 'k': case 'ArrowUp': t.col = Math.max(0, t.col - n); v.layout(); return true;
    default: return false;
  }
  v.cursor();
  return true;
}
export { COL };
