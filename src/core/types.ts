import type { Gfx } from './gfx';

export type Val = number | string;
export type Params = Record<string, Val>;
export type Method = 'euler' | 'semi' | 'rk4';

export interface Settings {
  dt: number;
  steps: number;
  method: Method;
}

/** Parameter definition. Numeric values are stored in the displayed unit; modules convert to SI. */
export interface ParamDef {
  k: string;
  l: string;
  u?: string;
  v: Val;
  min?: number;
  max?: number;
  s?: number; // step for h/l nudging
  o?: string[]; // enum options
  when?: (p: Params) => boolean;
  /** start a labelled section in the parameter list before this row */
  sec?: string;
  /** explanation shown in the info box (overrides docs.ts) */
  d?: string;
}

export interface Series {
  name: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  dash?: boolean;
  pts?: boolean;
}

export interface Chart {
  id: string;
  title: string;
  xl: string;
  yl: string;
  series: Series[];
  equal?: boolean;
  bars?: boolean;
  /** x axis is the table's first column (time) so the playback cursor can be drawn */
  tAxis?: boolean;
}

/** expected-vs-actual check; tol is relative (default 1e-3). ref = reference only, not pass/fail */
export interface Check {
  l: string;
  exp: number;
  act: number;
  u?: string;
  tol?: number;
  abs?: number;
  ref?: boolean;
}

export interface Scalar {
  l: string;
  v: number;
  u?: string;
}

export interface Target {
  l: string;
  hit: boolean;
  err: number;
  u?: string;
}

export interface Result {
  cols: string[];
  rows: number[][];
  scalars: Scalar[];
  checks: Check[];
  charts: Chart[];
  targets?: Target[];
  draw?: (g: Gfx, row: number) => void;
  fbd?: (row: number) => string[];
  notes?: string[];
}

export interface SimModule {
  id: string;
  name: string;
  desc: string;
  params: ParamDef[];
  settings: Settings;
  timeBased: boolean;
  stepsLabel?: string;
  /** integrator defaults applied when the 'mode' param switches to the given value */
  modeSettings?: Record<string, Partial<Settings>>;
  /** parameters derived from the current values (e.g. one block per drawn object); appended to `params` */
  dynParams?: (p: Params) => ParamDef[];
  /** extra named scenarios for :selftest (beyond defaults and the first option list) */
  selftests?: { name: string; p: Params; s?: Partial<Settings> }[];
  run(p: Params, s: Settings): Result;
}
