import type { Chart, Params, Series } from './types';

/** series from table columns by exact column name */
export function chart(
  cols: string[],
  rows: number[][],
  id: string,
  title: string,
  xc: string,
  ycs: string[],
  o: Partial<Chart> = {},
): Chart {
  const xi = cols.indexOf(xc);
  if (xi < 0) throw new Error(`no column ${xc}`);
  const x = rows.map((r) => r[xi]);
  const series: Series[] = ycs.map((n) => {
    const j = cols.indexOf(n);
    if (j < 0) throw new Error(`no column ${n}`);
    return { name: n, x, y: rows.map((r) => r[j]) };
  });
  return { id, title, xl: xc, yl: o.yl ?? (ycs.length === 1 ? ycs[0] : ''), series, tAxis: xi === 0, ...o };
}

export const num = (p: Params, k: string) => Number(p[k]);
export const str = (p: Params, k: string) => String(p[k]);
