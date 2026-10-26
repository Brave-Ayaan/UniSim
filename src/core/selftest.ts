import type { Check, Params, Settings, SimModule } from './types';

export function checkPass(c: Check): boolean | null {
  if (c.ref) return null;
  if (!Number.isFinite(c.act) || !Number.isFinite(c.exp)) return c.act === c.exp;
  const err = Math.abs(c.act - c.exp);
  const tol = Math.max(c.abs ?? 0, (c.tol ?? 1e-3) * Math.abs(c.exp));
  return err <= tol || (c.abs === undefined && Math.abs(c.exp) < 1e-12 && err < 1e-9);
}

export function defaults(m: SimModule): Params {
  const p: Params = {};
  m.params.forEach((d) => (p[d.k] = d.v));
  return p;
}

export function settingsFor(m: SimModule, p: Params): Settings {
  const mode = p.mode !== undefined ? String(p.mode) : undefined;
  return { ...m.settings, ...(mode && m.modeSettings?.[mode] ? m.modeSettings[mode] : {}) };
}

export interface CaseResult {
  mod: string;
  variant: string;
  ms: number;
  pass: number;
  fail: number;
  ref: number;
  failures: string[];
  error?: string;
}

/** run every module with defaults and with each option of its first enum parameter */
export function selftest(mods: SimModule[]): CaseResult[] {
  const out: CaseResult[] = [];
  for (const m of mods) {
    const base = defaults(m);
    const first = m.params.find((d) => d.o);
    const variants: { p: Params; label: string; s?: Partial<{ dt: number; steps: number; method: 'euler' | 'semi' | 'rk4' }> }[] = first ? first.o!.map((o) => ({ p: { ...base, [first.k]: o }, label: o })) : [{ p: base, label: 'default' }];
    for (const c of m.selftests ?? []) variants.push({ p: { ...base, ...c.p }, label: c.name, s: c.s });
    for (const { p, label, s: so } of variants) {
      const s = { ...settingsFor(m, p), ...(so ?? {}) };
      const t0 = performance.now();
      try {
        const r = m.run(p, s);
        const cr: CaseResult = { mod: m.id, variant: label, ms: performance.now() - t0, pass: 0, fail: 0, ref: 0, failures: [] };
        r.checks.forEach((c) => {
          const ok = checkPass(c);
          if (ok === null) cr.ref++;
          else if (ok) cr.pass++;
          else { cr.fail++; cr.failures.push(`${c.l}: exp ${c.exp} act ${c.act}`); }
        });
        out.push(cr);
      } catch (e: any) {
        out.push({ mod: m.id, variant: label, ms: performance.now() - t0, pass: 0, fail: 1, ref: 0, failures: [], error: String(e?.stack ?? e) });
      }
    }
  }
  return out;
}
