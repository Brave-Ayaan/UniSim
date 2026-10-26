// Fixed-size worker pool. Jobs are queued and handed to the first idle worker; falls back to running
// inline on the UI thread if Workers are unavailable.
import type { Job } from './worker';
import { MODULES } from '../modules';
import { selftest } from './selftest';

type Pending = { job: Job; resolve: (v: any) => void; reject: (e: Error) => void };

export class Pool {
  private idle: Worker[] = [];
  private all: Worker[] = [];
  private queue: Pending[] = [];
  private live = new Map<number, Pending>();
  private seq = 1;
  readonly size: number;
  private ok = typeof Worker !== 'undefined';

  constructor(size?: number) {
    this.size = size ?? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  }

  private spawn(): Worker | null {
    if (!this.ok || this.all.length >= this.size) return null;
    try {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const p = this.live.get(e.data.id);
        this.live.delete(e.data.id);
        this.idle.push(w);
        if (p) e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.err));
        this.pump();
      };
      w.onerror = (e) => { e.preventDefault(); this.ok = false; this.failAll(new Error(e.message || 'worker failed')); };
      this.all.push(w);
      return w;
    } catch {
      this.ok = false;
      return null;
    }
  }

  private failAll(err: Error) {
    // a broken worker setup (e.g. strict sandbox) degrades to inline execution instead of erroring out
    const jobs = [...this.live.values(), ...this.queue];
    this.live.clear();
    this.queue = [];
    jobs.forEach((p) => this.inline(p).catch(() => p.reject(err)));
  }

  private async inline(p: Pending) {
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 0));
    try {
      if (p.job.kind === 'run') {
        const m = MODULES.find((x) => x.id === (p.job as any).mod)!;
        const r = m.run((p.job as any).p, (p.job as any).s);
        p.resolve({ ok: true, ms: performance.now() - t0, res: r });
      } else p.resolve({ ok: true, ms: performance.now() - t0, res: selftest(MODULES.filter((m) => (p.job as any).mods.includes(m.id))) });
    } catch (e: any) { p.reject(e); }
  }

  private pump() {
    while (this.queue.length) {
      const w = this.idle.pop() ?? this.spawn();
      if (!w) break;
      const p = this.queue.shift()!;
      this.live.set(p.job.id, p);
      w.postMessage(p.job);
    }
  }

  submit<T = any>(job: Job extends infer J ? (J extends Job ? Omit<J, 'id'> : never) : never): Promise<{ ok: true; ms: number; res: T }> {
    return new Promise((resolve, reject) => {
      const p: Pending = { job: { ...job, id: this.seq++ } as Job, resolve, reject };
      if (!this.ok) { this.inline(p); return; }
      this.queue.push(p);
      this.pump();
    });
  }

  /** spawn every worker ahead of time (module load/parse happens off the critical path) */
  warm() {
    while (this.ok && this.all.length < this.size) {
      const w = this.spawn();
      if (!w) break;
      this.idle.push(w);
    }
  }

  get busy() { return this.live.size + this.queue.length; }
}

export const pool = new Pool();
