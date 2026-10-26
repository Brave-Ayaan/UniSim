// Per simulation: which values are the ENVIRONMENT (outside list: things a person can't really change —
// gravity, air, fields, road surface…) and which belong to the OBJECTS you place in EDIT (things a person
// chooses — mass, size, launch speed, angle, position…). Also: what position and dragging mean physically,
// the default scene, and ready-made real objects with pixel-art sprites.
import type { ParamDef, Params, Settings, Result } from '../core/types';
import { GROUND, type Ent } from './engines';
import { SCENE_CATALOG } from './scenes';
export { GROUND };

/** what dragging from an object sets */
export type Aim =
  | { kind: 'vel'; fx: string; fy: string; per: number; set?: Params } // velocity vector (units per cell)
  | { kind: 'polar'; speed: string; angle: string; per: number } // speed & launch angle
  | { kind: 'pull' } // pendulum: drag the ball (rope length & start angle)
  | { kind: 'len'; field: string; per: number }; // one value from a sideways drag

export interface Kind {
  kind: string;
  name: string;
  desc: string;
  sprite: string;
  /** module parameters this object owns; default = every non-environment parameter */
  fields?: string[];
  /** starting values when this kind is added */
  init?: Params;
  /** own fields for scene engines (pendulums, balls, bodies, targets) */
  custom?: ParamDef[];
  aim?: Aim;
}
export interface Preset { name: string; kind: string; sprite: string; desc: string; v: Params; group?: { dx: number; dy?: number; v?: Params }[]; s?: Partial<Settings> }
export interface Catalog {
  /** module parameters that stay in the outside list */
  env: string[];
  engine?: 'pendulums' | 'balls' | 'nbody' | 'projectiles' | 'scene';
  /** one-frame scene: environment values of its own, numerics, and the coupled solver */
  envDefs?: ParamDef[];
  settings?: Settings;
  timeBased?: boolean;
  desc?: string;
  /** objects stand on the ground line (EDIT draws it) */
  ground?: boolean;
  run?: (p: Params, s: Settings, ents: Ent[]) => Result;
  /** EDIT overlay: what the scene looks like around the objects (walls, beam, water...) */
  guide?: (g: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number, cp: number, p: Params, ents: { id: number; k: string; x: number; y: number }[]) => void;
  /** extra environment values of the scene */
  globals?: ParamDef[];
  kinds: Kind[];
  presets: Preset[];
  /** what position means (shown in EDIT) */
  where: string;
  /** objects present when the simulation is loaded: [kind or preset name, x, y, values] */
  start: [string, number, number, Params?][];
  /** extra self-test scenes */
  tests?: { name: string; list: [string, number, number, Params?][]; p?: Params; s?: Partial<Settings> }[];
}

const ON = ['on', 'off'];

export const CATALOG: Record<string, Catalog> = {
  pendulum: {
    env: ['g', 'c'],
    engine: 'pendulums',
    where: 'left/right = where the pivot hangs on the ceiling bar · drag a ball to pull it back (sets rope length and start angle)',
    globals: [
      { k: 'ws_balls', l: 'ball-ball collisions', v: 'on', o: ON, d: 'Pendulum balls bounce off each other (Newton\'s cradle).' },
      { k: 'ws_rope', l: 'ball-rope collisions', v: 'on', o: ON, d: 'Balls also hit other pendulums\' ropes and push them aside.' },
      { k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.1, min: 1e-3, s: 0.01, d: 'Size of one editor grid cell.' },
    ],
    kinds: [{ kind: 'pend', name: 'pendulum', sprite: 'clockpendulum', desc: 'a pendulum hanging from the ceiling bar', aim: { kind: 'pull' }, custom: [
      { k: 'type', l: 'type', v: 'simple', o: ['simple', 'compound', 'double'], d: 'simple = ball on a rope (collides with others); compound = swinging rigid rod; double = two linked pendulums (chaotic). Compound and double run on their own.' },
      { k: 'L', l: 'rope length', u: 'm', v: 1, min: 0.01, s: 0.1, d: 'Length from pivot to the centre of the ball (or rod length). Drag the ball in EDIT to set it.' },
      { k: 'm', l: 'ball mass', u: 'kg', v: 1, min: 1e-6, s: 0.1, d: 'Mass of the ball.' },
      { k: 'r', l: 'ball size (radius)', u: 'm', v: 0.1, min: 0.001, s: 0.01, d: 'Radius of the ball: bigger balls hit each other and ropes sooner.', when: (p) => p.type === 'simple' },
      { k: 'e', l: 'ball bounciness', v: 0.98, min: 0, max: 1, s: 0.02, d: 'How elastic the ball is (steel ≈ 0.98, putty ≈ 0.1). A collision uses the less bouncy of the two.', when: (p) => p.type === 'simple' },
      { k: 'th', l: 'start angle', u: 'deg', v: 30, s: 5, d: 'How far the ball is pulled back (from straight down, + = right). Drag the ball in EDIT to set it.' },
      { k: 'w', l: 'push (angular velocity)', u: 'rad/s', v: 0, s: 0.2, d: 'A push at the start.' },
      { k: 'L2', l: 'second rod length', u: 'm', v: 1, min: 0.01, s: 0.1, when: (p) => p.type === 'double', d: 'Length of the lower rod.' },
      { k: 'm2', l: 'second ball mass', u: 'kg', v: 1, min: 1e-6, s: 0.1, when: (p) => p.type === 'double', d: 'Mass of the lower ball.' },
      { k: 'th2', l: 'second start angle', u: 'deg', v: 90, s: 5, when: (p) => p.type === 'double', d: 'Start angle of the lower rod.' },
      { k: 'w2', l: 'second push', u: 'rad/s', v: 0, s: 0.2, when: (p) => p.type === 'double', d: 'Push on the lower rod.' },
    ] }],
    presets: [
      { name: 'Newton\'s cradle (5 balls)', kind: 'pend', sprite: 'steelball', desc: '5 touching steel balls, the left one pulled back', v: { type: 'simple', L: 1, m: 0.2, r: 0.1, e: 0.98, th: 0, w: 0 }, group: [{ dx: -4, v: { th: -35 } }, { dx: -2 }, { dx: 0 }, { dx: 2 }, { dx: 4 }] },
      { name: 'wrecking ball', kind: 'pend', sprite: 'wreckingball', desc: '500 kg ball on a 3 m chain', v: { type: 'simple', L: 3, m: 500, r: 0.35, e: 0.3, th: 60 } },
      { name: 'clock pendulum', kind: 'pend', sprite: 'clockpendulum', desc: 'seconds pendulum (0.994 m, 2 s period)', v: { type: 'simple', L: 0.994, m: 1, r: 0.06, th: 5 } },
      { name: 'playground swing', kind: 'pend', sprite: 'swing', desc: 'child on a 2.5 m swing', v: { type: 'simple', L: 2.5, m: 30, r: 0.25, e: 0.5, th: 30 } },
      { name: 'swinging rod', kind: 'pend', sprite: 'ibeam', desc: 'compound pendulum (rigid rod)', v: { type: 'compound', L: 1, m: 2, th: 40 } },
      { name: 'double pendulum', kind: 'pend', sprite: 'clockpendulum', desc: 'chaotic: two linked rods', v: { type: 'double', L: 1, m: 1, th: 30, L2: 1, m2: 1, th2: 90 } },
    ],
    start: [['pend', 32, 1]],
  },
  collision: {
    env: [],
    engine: 'balls',
    where: 'where the ball starts on the table · drag from a ball to throw it (arrow = velocity)',
    globals: [
      { k: 'ws_walls', l: 'table cushions', v: 'on', o: ON, d: 'Balls bounce off the edges (off = open space, momentum conserved).' },
      { k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 0.1, min: 1e-4, s: 0.01, d: 'Size of one editor grid cell (64 cells wide).' },
      { k: 'ws_T', l: 'scene duration', u: 's', v: 4, min: 0.1, s: 1, d: 'How long the table is simulated.' },
    ],
    kinds: [{ kind: 'ball', name: 'ball', sprite: 'billiard', desc: 'a ball on the table', aim: { kind: 'vel', fx: 'vx', fy: 'vy', per: 0.25 }, custom: [
      { k: 'm', l: 'mass', u: 'kg', v: 1, min: 1e-6, s: 0.1, d: 'Mass of the ball.' },
      { k: 'r', l: 'radius', u: 'm', v: 0.4, min: 1e-4, s: 0.05, d: 'Ball radius.' },
      { k: 'e', l: 'bounciness', v: 1, min: 0, max: 1, s: 0.05, d: 'Restitution (1 = no energy lost). A collision uses the less bouncy of the two balls.' },
      { k: 'vx', l: 'throw velocity x', u: 'm/s', v: 0, s: 0.5, d: 'Initial velocity to the right — drag from the ball in EDIT to set it.' },
      { k: 'vy', l: 'throw velocity y', u: 'm/s', v: 0, s: 0.5, d: 'Initial velocity upward.' },
    ] }],
    presets: [
      { name: 'cue ball (struck)', kind: 'ball', sprite: 'billiard', desc: 'billiard ball moving at 3 m/s', v: { m: 0.17, r: 0.028, e: 0.95, vx: 3, vy: 0 } },
      { name: 'billiard ball', kind: 'ball', sprite: 'billiard', desc: '170 g, 57 mm', v: { m: 0.17, r: 0.028, e: 0.95 } },
      { name: 'bowling ball', kind: 'ball', sprite: 'bowling', desc: '7 kg, 22 cm', v: { m: 7, r: 0.109, e: 0.6, vx: 2 } },
      { name: 'basketball', kind: 'ball', sprite: 'basketball', desc: '620 g, 24 cm', v: { m: 0.62, r: 0.12, e: 0.8 } },
      { name: 'tennis ball', kind: 'ball', sprite: 'tennis', desc: '57 g, 6.7 cm', v: { m: 0.057, r: 0.033, e: 0.75 } },
      { name: 'billiard rack (6 balls)', kind: 'ball', sprite: 'billiard', desc: 'triangle of touching billiard balls', v: { m: 0.17, r: 0.028, e: 0.95 }, group: [{ dx: 0, dy: 0 }, { dx: 0.49, dy: -0.29 }, { dx: 0.49, dy: 0.29 }, { dx: 0.98, dy: -0.57 }, { dx: 0.98, dy: 0 }, { dx: 0.98, dy: 0.57 }] },
    ],
    // the classic two-ball setup: heavy ball moving right, a lighter one coming back, slightly off-centre
    start: [['ball', 16, 18, { m: 2, r: 0.5, vx: 3, vy: 0 }], ['ball', 48, 14, { m: 1, r: 0.4, vx: -1, vy: 0 }]],
  },
  orbital: {
    env: [],
    engine: 'nbody',
    where: 'where the body starts · drag from a body to launch it (arrow = velocity); "circular" orbits are set automatically',
    globals: [
      { k: 'ws_scale', l: 'scene: km per cell', u: 'km', v: 20000, min: 1, s: 1000, d: 'Distance represented by one editor grid cell.' },
      { k: 'ws_dt', l: 'scene timestep', u: 's', v: 600, min: 1e-3, s: 60, d: 'Integration step (RK4).' },
      { k: 'ws_steps', l: 'scene steps', v: 4000, min: 10, max: 200000, s: 500, d: 'Number of steps (duration = steps × timestep).' },
    ],
    kinds: [{ kind: 'body', name: 'body', sprite: 'moon', desc: 'a planet, moon or spacecraft', aim: { kind: 'vel', fx: 'vx', fy: 'vy', per: 0.1, set: { orbit: 'as set' } }, custom: [
      { k: 'M', l: 'mass', u: 'kg', v: 7.342e22, min: 1, s: 1e22, d: 'Mass of the body.' },
      { k: 'R', l: 'radius', u: 'km', v: 1737, min: 0.001, s: 100, d: 'Physical radius.' },
      { k: 'orbit', l: 'start velocity', v: 'circular', o: ['circular', 'as set', 'at rest'], d: 'circular = launched on a circular orbit around the heaviest other body; as set = the dragged velocity (vx, vy).' },
      { k: 'vx', l: 'velocity x', u: 'km/s', v: 0, s: 0.1, when: (p) => p.orbit === 'as set', d: 'Launch velocity to the right.' },
      { k: 'vy', l: 'velocity y', u: 'km/s', v: 0, s: 0.1, when: (p) => p.orbit === 'as set', d: 'Launch velocity upward.' },
    ] }],
    presets: [
      { name: 'Earth', kind: 'body', sprite: 'earth', desc: '5.97e24 kg', v: { M: 5.972e24, R: 6371, orbit: 'at rest' } },
      { name: 'Moon', kind: 'body', sprite: 'moon', desc: '7.34e22 kg, circular orbit', v: { M: 7.342e22, R: 1737, orbit: 'circular' } },
      { name: 'Mars', kind: 'body', sprite: 'mars', desc: '6.42e23 kg', v: { M: 6.417e23, R: 3390, orbit: 'circular' } },
      { name: 'Jupiter', kind: 'body', sprite: 'jupiter', desc: '1.90e27 kg', v: { M: 1.898e27, R: 69911, orbit: 'at rest' } },
      { name: 'ISS', kind: 'body', sprite: 'iss', desc: '420 t station', v: { M: 4.2e5, R: 0.05, orbit: 'circular' } },
      { name: 'Sun', kind: 'body', sprite: 'sun', desc: '1.99e30 kg', v: { M: 1.989e30, R: 696340, orbit: 'at rest' } },
      // Chenciner–Montgomery figure-8, scaled to M = 1e25 kg, L = 1e8 m (5 cells), v unit = √(GM/L)
      { name: 'figure-8 three-body', kind: 'body', sprite: 'moon', desc: 'three equal stars chasing on a figure 8', v: { M: 1e25, R: 1000, orbit: 'as set' }, group: [
        { dx: 4.85, dy: 1.215, v: { vx: 1.2043, vy: 1.1168 } }, { dx: -4.85, dy: -1.215, v: { vx: 1.2043, vy: 1.1168 } }, { dx: 0, dy: 0, v: { vx: -2.4086, vy: -2.2336 } }] },
    ],
    start: [['Earth', 32, 18], ['Moon', 51.2, 18]],
  },
  projectile: {
    env: ['g', 'drag', 'rho', 'wind'],
    engine: 'projectiles',
    where: 'a launcher fires from where you place it (height above the ground = launch height) · drag from it to aim (arrow length = speed, direction = angle) · place a target to aim at',
    globals: [{ k: 'ws_scale', l: 'scene: metres per cell', u: 'm', v: 5, min: 1e-3, s: 1, d: 'Size of one editor grid cell (the ground is the line near the bottom).' }],
    kinds: [
      { kind: 'proj', name: 'launcher', sprite: 'cannonball', desc: 'something thrown or fired from this spot', fields: ['v0', 'ang', 'm', 'Cd', 'd', 'kl'], aim: { kind: 'polar', speed: 'v0', angle: 'ang', per: 2 } },
      { kind: 'target', name: 'target', sprite: 'target', desc: 'a target to hit (its position is the target point)', custom: [{ k: 'tol', l: 'hit tolerance', u: 'm', v: 2, min: 0, s: 0.5, d: 'How close a path must pass to count as a HIT.' }] },
    ],
    presets: [
      { name: 'cannonball', kind: 'proj', sprite: 'cannonball', desc: '5 kg iron ball at 80 m/s', v: { v0: 80, ang: 40, m: 5, Cd: 0.47, d: 0.11 } },
      { name: 'baseball', kind: 'proj', sprite: 'baseball', desc: '145 g at 40 m/s', v: { v0: 40, ang: 35, m: 0.145, Cd: 0.35, d: 0.074 } },
      { name: 'golf drive', kind: 'proj', sprite: 'golfball', desc: '46 g at 70 m/s', v: { v0: 70, ang: 12, m: 0.046, Cd: 0.25, d: 0.043 } },
      { name: 'basketball shot', kind: 'proj', sprite: 'basketball', desc: '620 g at 9 m/s', v: { v0: 9, ang: 52, m: 0.62, Cd: 0.47, d: 0.24 } },
      { name: 'shot put', kind: 'proj', sprite: 'shotput', desc: '7.26 kg at 14 m/s', v: { v0: 14, ang: 38, m: 7.26, Cd: 0.47, d: 0.12 } },
    ],
    start: [['proj', 6, GROUND], ['target', 46, GROUND]],
  },
  truss: {
    env: [], where: 'position is layout only', start: [['bridge', 32, 18]],
    kinds: [{ kind: 'bridge', name: 'bridge', sprite: 'footbridge', desc: 'a truss bridge' }],
    presets: [
      { name: 'footbridge', kind: 'bridge', sprite: 'footbridge', desc: 'Warren, 12 m', v: { type: 'warren', n: 6, span: 12, h: 2, load: 'uniform', P: 20, A: 40 } },
      { name: 'railway bridge', kind: 'bridge', sprite: 'railbridge', desc: 'Pratt, 40 m, heavy', v: { type: 'pratt', n: 10, span: 40, h: 6, load: 'uniform', P: 300, A: 300 } },
      { name: 'roof truss', kind: 'bridge', sprite: 'rooftruss', desc: 'Howe, 8 m', v: { type: 'howe', n: 4, span: 8, h: 2, load: 'uniform', P: 15, A: 30 } },
    ],
  },
  thermo: {
    env: [], where: 'position is layout only', start: [['sys', 32, 18]],
    kinds: [
      { kind: 'sys', name: 'thermodynamic system', sprite: 'engine', desc: 'a gas, rod or water sample' },
      { kind: 'cycle', name: 'heat engine', sprite: 'engine', desc: 'an Otto (petrol) engine cycle', init: { mode: 'otto cycle' } },
      { kind: 'rod', name: 'heated rod', sprite: 'ibeam', desc: 'heat conducting along a bar', init: { mode: 'conduction' } },
      { kind: 'water', name: 'heated water', sprite: 'kettle', desc: 'heating through melting & boiling', init: { mode: 'phase change' } },
    ],
    presets: [
      { name: 'car engine', kind: 'cycle', sprite: 'engine', desc: 'Otto cycle, compression 10', v: { mode: 'otto cycle', n: 0.02, gam: 1.4, P1: 100, T1: 300, rc: 10, Qin: 1200 } },
      { name: 'power plant', kind: 'sys', sprite: 'powerplant', desc: 'Carnot 800 K → 300 K', v: { mode: 'carnot cycle', n: 1, gam: 1.4, P1: 2000, r: 3, Th: 800, Tc: 300 } },
      { name: 'copper rod', kind: 'rod', sprite: 'ibeam', desc: 'k = 400 W/mK', v: { mode: 'conduction', L: 0.5, k: 400, rho: 8960, cp: 385, TL: 100, TR: 0, T0: 20 } },
      { name: 'kettle', kind: 'water', sprite: 'kettle', desc: '1.5 L to boiling, 2 kW', v: { mode: 'phase change', mw: 1.5, Ts: 20, Te: 100, Pw: 2000 }, s: { dt: 0.1, steps: 4000 } },
      { name: 'ice cube', kind: 'water', sprite: 'icecube', desc: '30 g ice in a 100 W warmer', v: { mode: 'phase change', mw: 0.03, Ts: -18, Te: 20, Pw: 100 } },
    ],
  },
  beam: {
    env: [], where: 'position is layout only', start: [['beam', 32, 18]],
    kinds: [{ kind: 'beam', name: 'beam', sprite: 'ibeam', desc: 'a beam with its own supports, loads and section' }],
    presets: [
      { name: 'diving board', kind: 'beam', sprite: 'divingboard', desc: 'cantilever, diver at the tip', v: { sup: 'cantilever', L: 4.8, P: 0.8, a: 4.8, w: 0.1, b: 500, h: 60 } },
      { name: 'bookshelf', kind: 'beam', sprite: 'shelf', desc: '1 m shelf of books', v: { sup: 'simply supported', L: 1, P: 0, a: 0.5, w: 0.3, b: 250, h: 20 } },
      { name: 'floor joist', kind: 'beam', sprite: 'joist', desc: '4 m timber joist', v: { sup: 'simply supported', L: 4, P: 1, a: 2, w: 2, b: 50, h: 200 } },
    ],
  },
  circuits: {
    env: [], where: 'position is layout only', start: [['ckt', 32, 18]],
    kinds: [{ kind: 'ckt', name: 'circuit', sprite: 'battery', desc: 'a circuit' }],
    presets: [
      { name: 'camera flash', kind: 'ckt', sprite: 'flash', desc: 'RC charge, 300 V, 1000 µF', v: { mode: 'RC charge', V: 300, R: 100, C: 1000 }, s: { dt: 1e-4, steps: 5000 } },
      { name: 'car headlight', kind: 'ckt', sprite: 'bulb', desc: '12 V, 1.2 Ω lamp branches', v: { mode: 'resistor network', V: 12, R: 0.05, R2: 2.4, R3: 2.4 } },
      { name: 'radio tuner', kind: 'ckt', sprite: 'radio', desc: 'AC RLC near resonance', v: { mode: 'AC series RLC', V: 1, R: 5, L: 1, C: 0.1, f: 15915 }, s: { dt: 5e-7, steps: 20000 } },
      { name: 'phone charger coil', kind: 'ckt', sprite: 'charger', desc: 'RL step, 5 V', v: { mode: 'RL step', V: 5, R: 2, L: 20 } },
    ],
  },
  aero: {
    env: ['rho', 'mu', 'g'], where: 'position is layout only', start: [['wing', 32, 18]],
    kinds: [
      { kind: 'wing', name: 'wing or body', sprite: 'cessna', desc: 'a wing, falling body, plate or cylinder' },
      { kind: 'drop', name: 'falling sphere', sprite: 'raindrop', desc: 'something falling to terminal speed', init: { mode: 'sphere fall' } },
    ],
    presets: [
      { name: 'Cessna 172 wing', kind: 'wing', sprite: 'cessna', desc: '55 m/s, 11 m span', v: { mode: 'airfoil', U: 55, alpha: 4, cm: 2, c: 1.5, span: 11, e: 0.8 } },
      { name: 'glider wing', kind: 'wing', sprite: 'glider', desc: 'long, slender', v: { mode: 'airfoil', U: 25, alpha: 5, cm: 4, c: 0.8, span: 15, e: 0.95 } },
      { name: 'raindrop', kind: 'drop', sprite: 'raindrop', desc: '2 mm water drop', v: { mode: 'sphere fall', d: 0.002, rhos: 1000 } },
      { name: 'hailstone', kind: 'drop', sprite: 'hailstone', desc: '2 cm ice ball', v: { mode: 'sphere fall', d: 0.02, rhos: 917 } },
      { name: 'skydiver (ball model)', kind: 'drop', sprite: 'skydiver', desc: '80 kg as a 0.6 m sphere', v: { mode: 'sphere fall', d: 0.6, rhos: 707 } },
    ],
  },
  energy: {
    env: ['g'], where: 'position is layout only', start: [['block', 32, 18]],
    kinds: [{ kind: 'block', name: 'block on ramp', sprite: 'crate', desc: 'a block sliding down into a spring' }],
    presets: [
      { name: 'wooden crate', kind: 'block', sprite: 'crate', desc: '20 kg, μ 0.3', v: { m: 20, th: 30, d: 5, mu: 0.3, k: 2000, cg: 0 } },
      { name: 'sled on snow', kind: 'block', sprite: 'sled', desc: '10 kg, μ 0.05', v: { m: 10, th: 20, d: 8, mu: 0.05, k: 1000, cg: 0 } },
      { name: 'skateboard', kind: 'block', sprite: 'skateboard', desc: '5 kg, rolling μ 0.02', v: { m: 5, th: 15, d: 6, mu: 0.02, k: 500, cg: 0 } },
    ],
  },
  fluids: {
    env: ['rho', 'g', 'mu'], where: 'position is layout only', start: [['flow', 32, 18]],
    kinds: [
      { kind: 'flow', name: 'pipe or object', sprite: 'hose', desc: 'a venturi, pipe, tank or floating object' },
      { kind: 'float', name: 'floating object', sprite: 'boat', desc: 'a block bobbing in the liquid', init: { mode: 'buoyancy' } },
      { kind: 'tank', name: 'draining tank', sprite: 'watertower', desc: 'a tank emptying through a hole', init: { mode: 'tank drain' } },
    ],
    presets: [
      { name: 'rowing boat', kind: 'float', sprite: 'boat', desc: 'light hull block', v: { mode: 'buoyancy', side: 1, rhoo: 300, z0: 0.1, c: 200 }, s: { dt: 0.002, steps: 20000 } },
      { name: 'iceberg', kind: 'float', sprite: 'iceberg', desc: 'ice (floats ~90% under)', v: { mode: 'buoyancy', side: 2, rhoo: 917, z0: 0.1, c: 5000 }, s: { dt: 0.002, steps: 20000 } },
      { name: 'water tower', kind: 'tank', sprite: 'watertower', desc: '10 m of water', v: { mode: 'tank drain', At: 50, ao: 100, Cd: 0.61, h0: 10 }, s: { dt: 2, steps: 6000 } },
      { name: 'garden hose', kind: 'flow', sprite: 'hose', desc: '16 mm, 20 m', v: { mode: 'pipe flow', D: 0.016, Lp: 20, Q: 0.3, eps: 0.0015 } },
    ],
  },
  springs: {
    env: [], where: 'position is layout only · drag sideways from a spring to stretch it (start displacement)', start: [['osc', 32, 18]],
    kinds: [{ kind: 'osc', name: 'oscillator', sprite: 'carspring', desc: 'a mass on a spring', aim: { kind: 'len', field: 'x0', per: 0.02 } }],
    presets: [
      { name: 'car suspension', kind: 'osc', sprite: 'carspring', desc: '300 kg, 20 kN/m', v: { mode: 'single', m: 300, k: 20000, c: 1500, F0: 0, wd: 0, x0: 0.05, v0: 0 } },
      { name: 'slinky', kind: 'osc', sprite: 'slinky', desc: 'soft and light', v: { mode: 'single', m: 0.2, k: 2, c: 0.01, F0: 0, wd: 0, x0: 0.2, v0: 0 } },
      { name: 'bungee jumper', kind: 'osc', sprite: 'bungee', desc: '70 kg on a 100 N/m cord', v: { mode: 'single', m: 70, k: 100, c: 20, F0: 0, wd: 0, x0: 5, v0: 0 } },
      { name: 'washing machine drum', kind: 'osc', sprite: 'washer', desc: 'driven near resonance', v: { mode: 'single', m: 40, k: 16000, c: 150, F0: 200, wd: 19, x0: 0, v0: 0 } },
    ],
  },
  rotation: {
    env: ['g'], where: 'position is layout only', start: [['roller', 32, 18]],
    kinds: [
      { kind: 'roller', name: 'rotating object', sprite: 'tyre', desc: 'something rolling, a flywheel or a top' },
      { kind: 'top', name: 'spinning top', sprite: 'spintop', desc: 'a gyroscope precessing', init: { mode: 'gyroscope' } },
    ],
    presets: [
      { name: 'bowling ball', kind: 'roller', sprite: 'bowling', desc: 'solid sphere 7 kg', v: { mode: 'rolling', shape: 'solid sphere', m: 7, r: 0.109, th: 15, mus: 0.3 } },
      { name: 'car tyre', kind: 'roller', sprite: 'tyre', desc: 'roughly a hoop', v: { mode: 'rolling', shape: 'hoop', m: 10, r: 0.33, th: 15, mus: 0.8 } },
      { name: 'tin can', kind: 'roller', sprite: 'flywheel', desc: 'solid cylinder', v: { mode: 'rolling', shape: 'solid cylinder', m: 0.4, r: 0.04, th: 20, mus: 0.4 } },
      { name: 'toy spinning top', kind: 'top', sprite: 'spintop', desc: '100 g at 1500 rpm', v: { mode: 'gyroscope', m: 0.1, r: 0.03, l: 0.04, rpm: 1500, th0: 20, init: 'released (nutation)' } },
    ],
  },
  waves: {
    env: ['Tair'], where: 'position is layout only', start: [['string', 32, 18]],
    kinds: [
      { kind: 'string', name: 'wave system', sprite: 'guitar', desc: 'a string, slits or a sound source' },
      { kind: 'source', name: 'moving sound source', sprite: 'siren', desc: 'a Doppler-shifted source', init: { mode: 'doppler' } },
    ],
    presets: [
      { name: 'guitar low E string', kind: 'string', sprite: 'guitar', desc: '82 Hz', v: { mode: 'string', L: 0.648, T: 70, mu: 0.00648, init: 'pluck', n: 1, A: 0.002 }, s: { dt: 4e-6, steps: 25000, method: 'rk4' } },
      { name: 'piano A4 string', kind: 'string', sprite: 'piano', desc: '440 Hz', v: { mode: 'string', L: 0.39, T: 750, mu: 0.0075, init: 'mode n', n: 1, A: 0.001 }, s: { dt: 2e-6, steps: 20000, method: 'rk4' } },
      { name: 'ambulance siren', kind: 'source', sprite: 'siren', desc: '700 Hz at 25 m/s', v: { mode: 'doppler', f0: 700, vs: 25, yo: 5 } },
    ],
  },
  em: {
    env: ['B', 'Ex', 'Ey'], where: 'position is layout only (the fields are uniform)', start: [['charge', 32, 18]],
    kinds: [
      { kind: 'charge', name: 'device or particle', sprite: 'electron', desc: 'a charged particle, coil, motor or generator' },
      { kind: 'motor', name: 'DC motor', sprite: 'drill', desc: 'an electric motor', init: { mode: 'dc motor' } },
    ],
    presets: [
      { name: 'electron', kind: 'charge', sprite: 'electron', desc: 'e⁻ at 1e6 m/s', v: { mode: 'lorentz', q: -1.602176634e-19, m: 9.1093837e-31, vx: 1e6, vz: 0 }, s: { dt: 1e-10, steps: 2000 } },
      { name: 'alpha particle', kind: 'charge', sprite: 'electron', desc: 'He²⁺ at 1e6 m/s', v: { mode: 'lorentz', q: 3.204353268e-19, m: 6.6446573e-27, vx: 1e6, vz: 1e5 } },
      { name: 'cordless drill', kind: 'motor', sprite: 'drill', desc: '18 V', v: { mode: 'dc motor', V: 18, R: 0.3, kt: 0.02, J: 2e-5, tl: 0.05 } },
    ],
  },
  optics: {
    env: ['n1'], where: 'position is layout only', start: [['optic', 32, 18]],
    kinds: [{ kind: 'optic', name: 'optical element', sprite: 'water', desc: 'a surface, lens system or thick lens' }],
    presets: [
      { name: 'water surface', kind: 'optic', sprite: 'water', desc: 'n = 1.333', v: { mode: 'interface', n2: 1.333, th: 40 } },
      { name: 'diamond', kind: 'optic', sprite: 'diamond', desc: 'n = 2.42', v: { mode: 'interface', n2: 2.417, th: 40 } },
      { name: 'glasses lens', kind: 'optic', sprite: 'glasses', desc: 'crown glass n = 1.52', v: { mode: 'interface', n2: 1.52, th: 20 } },
      { name: 'camera lens', kind: 'optic', sprite: 'cameralens', desc: 'thick biconvex lens', v: { mode: 'thick lens trace', R1: 60, R2: -60, tc: 8, n: 1.52, ap: 15 } },
      { name: 'magnifying glass', kind: 'optic', sprite: 'magnifier', desc: 'two thin lenses', v: { mode: 'thin lens system', f1: 100, f2: 50, sep: 250, do: 300, ho: 10 } },
    ],
  },
  kinetics: {
    env: [], where: 'position is layout only', start: [['rxn', 32, 18]],
    kinds: [{ kind: 'rxn', name: 'reaction', sprite: 'flask', desc: 'a reaction vessel' }],
    presets: [
      { name: 'hydrogen peroxide (warm)', kind: 'rxn', sprite: 'flask', desc: '1st order, 330 K', v: { mode: 'nth order A→P', order: '1', A0: 1, Af: 1e10, Ea: 75, T: 330 } },
      { name: 'cold storage', kind: 'rxn', sprite: 'tube', desc: 'same reaction at 278 K', v: { mode: 'nth order A→P', order: '1', A0: 1, Af: 1e10, Ea: 75, T: 278 }, s: { dt: 20, steps: 2000 } },
    ],
  },
  fracture: {
    env: [], where: 'position is layout only', start: [['part', 32, 18]],
    kinds: [{ kind: 'part', name: 'part', sprite: 'bracket', desc: 'a part under load' }],
    presets: [
      { name: 'steel cable', kind: 'part', sprite: 'cable', desc: 'tensile test, σy 350 MPa', v: { mode: 'tensile test', sy: 350 } },
      { name: 'aluminium bracket', kind: 'part', sprite: 'bracket', desc: 'plate with a bolt hole', v: { mode: 'hole in plate', sy: 270, W: 60, dh: 12, F: 20 } },
      { name: 'cracked wing skin', kind: 'part', sprite: 'wingskin', desc: 'fatigue crack growth', v: { mode: 'crack fatigue', KIC: 30, smax: 120, a0: 2 } },
    ],
  },
  rocket: {
    env: ['grav', 'drag'], where: 'position is layout only (every rocket launches straight up from its pad)', start: [['rocket', 32, 18]],
    kinds: [{ kind: 'rocket', name: 'rocket', sprite: 'modelrocket', desc: 'a launch vehicle' }],
    presets: [
      { name: 'Saturn V', kind: 'rocket', sprite: 'saturnv', desc: '3 stages, 45 t payload', v: { ns: 3, pay: 45, mp1: 2077, md1: 131, isp1: 263, T1: 34000, mp2: 444, md2: 36, isp2: 421, T2: 5141, mp3: 109, md3: 11, isp3: 421, T3: 1033, Cd: 0.5, dia: 10.1 } },
      { name: 'Falcon 9', kind: 'rocket', sprite: 'falcon9', desc: '2 stages, 15 t', v: { ns: 2, pay: 15, mp1: 411, md1: 22, isp1: 282, T1: 7607, mp2: 107.5, md2: 4, isp2: 348, T2: 934, Cd: 0.3, dia: 3.7 } },
      { name: 'V-2', kind: 'rocket', sprite: 'v2', desc: '1 stage, 1 t warhead', v: { ns: 1, pay: 1, mp1: 8.8, md1: 4, isp1: 239, T1: 270, Cd: 0.3, dia: 1.65 } },
      { name: 'model rocket', kind: 'rocket', sprite: 'modelrocket', desc: 'C6 motor, 100 g', v: { ns: 1, pay: 0.00005, mp1: 0.0000108, md1: 0.00004, isp1: 94, T1: 0.006, ht: 0.3, htol: 0.05, Cd: 0.75, dia: 0.025 } },
    ],
  },
  vehicle: {
    env: ['mu', 'muk', 'grade', 'rho', 'R', 'bank', 'road', 'zr', 'fr'],
    where: 'position is layout only · drag sideways from a vehicle to set its speed',
    start: [['veh', 32, GROUND]],
    kinds: [{ kind: 'veh', name: 'vehicle', sprite: 'car', desc: 'a vehicle on the road', aim: { kind: 'len', field: 'v0', per: 5 } }],
    presets: [
      { name: 'family car', kind: 'veh', sprite: 'car', desc: '1.5 t, ABS', v: { mode: 'braking', m: 1500, v0: 100, abs: 'on', tr: 1, CdA: 0.7, hcg: 0.55, wb: 2.7 } },
      { name: 'lorry', kind: 'veh', sprite: 'truck', desc: '12 t, high CG', v: { mode: 'braking', m: 12000, v0: 80, abs: 'on', tr: 1.2, CdA: 6, hcg: 1.5, wb: 5 } },
      { name: 'sports car', kind: 'veh', sprite: 'sportscar', desc: 'low and light', v: { mode: 'braking', m: 1300, v0: 100, abs: 'on', tr: 0.8, CdA: 0.6, hcg: 0.45, wb: 2.5 } },
      { name: 'bus', kind: 'veh', sprite: 'bus', desc: '18 t', v: { mode: 'braking', m: 18000, v0: 70, abs: 'on', tr: 1.2, CdA: 7, hcg: 1.4, wb: 6 } },
      { name: 'motorbike', kind: 'veh', sprite: 'motorbike', desc: '250 kg, no ABS', v: { mode: 'braking', m: 250, v0: 100, abs: 'off', tr: 0.8, CdA: 0.5, hcg: 0.6, wb: 1.4 } },
    ],
  },
  granular: {
    env: ['g', 'W', 'H'], where: 'position is layout only', start: [['heap', 32, 18]],
    kinds: [{ kind: 'heap', name: 'grains', sprite: 'sandpile', desc: 'a pile or gas of grains' }],
    presets: [
      { name: 'dry sand', kind: 'heap', sprite: 'sand', desc: 'μ 0.5', v: { mode: 'sand pile', N: 150, r: 0.01, e: 0.4, mu: 0.5 } },
      { name: 'glass marbles', kind: 'heap', sprite: 'marbles', desc: 'bouncy, slippery', v: { mode: 'sand pile', N: 100, r: 0.012, e: 0.9, mu: 0.1 } },
      { name: 'gravel', kind: 'heap', sprite: 'gravel', desc: 'coarse, rough', v: { mode: 'sand pile', N: 80, r: 0.02, e: 0.3, mu: 0.8 } },
    ],
  },
  acoustics: {
    env: ['T'], where: 'position is layout only', start: [['room', 32, 18]],
    kinds: [{ kind: 'room', name: 'room', sprite: 'hall', desc: 'a room with its own size and surfaces' }],
    presets: [
      { name: 'concert hall', kind: 'room', sprite: 'hall', desc: '40×25×15 m', v: { Lx: 40, Ly: 25, Lz: 15, alpha: 0.25 } },
      { name: 'bathroom', kind: 'room', sprite: 'bathroom', desc: 'hard tiles', v: { Lx: 3, Ly: 2, Lz: 2.5, alpha: 0.05 } },
      { name: 'recording studio', kind: 'room', sprite: 'studio', desc: 'heavily damped', v: { Lx: 6, Ly: 5, Lz: 3, alpha: 0.6 } },
    ],
  },
  control: {
    env: ['dist', 'td'], where: 'position is layout only', start: [['loop', 32, 18]],
    kinds: [{ kind: 'loop', name: 'control loop', sprite: 'thermostat', desc: 'a controlled system' }],
    presets: [
      { name: 'drone altitude hold', kind: 'loop', sprite: 'drone', desc: '1.2 kg, no spring', v: { plant: 'mass-spring-damper', m: 1.2, c: 0.5, k: 0, Kp: 40, Ki: 10, Kd: 12 } },
      { name: 'car cruise control', kind: 'loop', sprite: 'cruise', desc: 'first-order speed plant', v: { plant: 'first-order', K: 1, tau: 10, Kp: 3, Ki: 0.5, Kd: 0 } },
      { name: 'thermostat', kind: 'loop', sprite: 'thermostat', desc: 'slow room heating', v: { plant: 'first-order', K: 1, tau: 300, Kp: 20, Ki: 0.1, Kd: 0 } },
    ],
  },
};

// simulations rebuilt as one-frame scenes replace their entries above
Object.assign(CATALOG, SCENE_CATALOG);
