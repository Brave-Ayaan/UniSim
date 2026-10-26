/// <reference lib="webworker" />
// Simulation worker: runs modules off the UI thread. Results are returned without the draw/fbd
// closures (functions can't cross threads); the UI re-hydrates them on demand when a run is watched.
import { MODULES } from '../modules';
import { selftest } from './selftest';
import type { Result } from './types';

export type Job =
  | { id: number; kind: 'run'; mod: string; p: Record<string, number | string>; s: { dt: number; steps: number; method: 'euler' | 'semi' | 'rk4' } }
  | { id: number; kind: 'selftest'; mods: string[] };

export type DataResult = Omit<Result, 'draw' | 'fbd'>;

const strip = (r: Result): DataResult => ({ cols: r.cols, rows: r.rows, scalars: r.scalars, checks: r.checks, charts: r.charts, targets: r.targets, notes: r.notes });

self.onmessage = (e: MessageEvent<Job>) => {
  const job = e.data;
  const t0 = performance.now();
  try {
    if (job.kind === 'run') {
      const m = MODULES.find((x) => x.id === job.mod);
      if (!m) throw new Error(`unknown module ${job.mod}`);
      const res = strip(m.run(job.p, job.s));
      (self as unknown as Worker).postMessage({ id: job.id, ok: true, ms: performance.now() - t0, res });
    } else {
      const res = selftest(MODULES.filter((m) => job.mods.includes(m.id)));
      (self as unknown as Worker).postMessage({ id: job.id, ok: true, ms: performance.now() - t0, res });
    }
  } catch (err: any) {
    (self as unknown as Worker).postMessage({ id: job.id, ok: false, err: String(err?.message ?? err) });
  }
};
