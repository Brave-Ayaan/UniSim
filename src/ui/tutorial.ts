// Interactive tutorial (":help"): a coach that walks through a live projectile simulation.
// The launcher is scene object 1 (its values are e1_*); gravity and drag are the environment.
// Each step names a task; the step completes itself when the app state shows the user did it.

/** read-only view of app state the steps need */
export interface CoachCtx {
  tut: any; // the tutorial run tab (projectile) — RunTab shape
  cur: any; // the tab currently shown
  tabs: any[];
  selKey: (t: any) => string | undefined; // key of the highlighted parameter row
  seenLive: boolean; // the tutorial run has been replayed live at least once
}

export interface Step {
  title: string;
  body: string; // HTML
  task?: string; // HTML; when present the step auto-completes via done()
  hl?: string; // parameter row to highlight
  done?: (c: CoachCtx) => boolean;
}

import { parseEnts } from '../workspace/wrap';
import { GROUND } from '../workspace/catalog';

const k = (s: string) => `<kbd>${s}</kbd>`;
const p = (t: any, key: string) => t?.p?.[key];

export const STEPS: Step[] = [
  {
    title: 'Welcome to UniSim',
    body: `<p>This is a live <b>projectile</b> simulation. The <b>left column</b> lists every input value — first the <b>environment</b> (gravity, air: things nobody can change by hand), then each object in the scene (what you <i>can</i> change: how hard and at what angle you throw); the <b>right side</b> shows the animation, a free-body diagram (forces), the results, expected-vs-actual checks, graphs and the full data table.</p>
      <p>UniSim is driven by the keyboard, like the vim editor. This guide waits for you to try each thing — it moves on by itself when you do.</p>`,
    task: `Press ${k('N')} to start (${k('B')} goes back a step, ${k(':help stop')} closes the guide).`,
  },
  {
    title: 'Moving around',
    body: `<p>The highlighted row is the value you are working on. ${k('j')} moves down, ${k('k')} moves up (arrow keys work too).</p>`,
    task: `Move the highlight down to <b>launch angle</b>.`,
    hl: 'e1_ang',
    done: (c) => c.cur === c.tut && c.selKey(c.tut) === 'e1_ang',
  },
  {
    title: 'What does a value do?',
    body: `<p>Look at the box <b>under the parameter list</b>: it explains the highlighted value in plain words, its unit, and how to change it. It updates as you move — try a few rows.</p>`,
    task: `Read it, then go back to <b>launch angle</b> and press ${k('N')}.`,
    hl: 'e1_ang',
  },
  {
    title: 'Change a value, see the result',
    body: `<p>${k('l')} increases the highlighted value by one step, ${k('h')} decreases it. Every change re-runs the simulation instantly — watch the arc, <b>range</b> and <b>max height</b> in the results.</p>`,
    task: `Raise the launch angle to <b>55°</b> or more.`,
    hl: 'e1_ang',
    done: (c) => Number(p(c.tut, 'e1_ang')) >= 55,
  },
  {
    title: 'Reading the results',
    body: `<p>The arc is now higher but lands <b>shorter</b>: with air drag the best angle is below 45°. The <b>results</b> panel lists computed quantities (range, flight time, impact speed…). The thin line in each graph and the highlighted table row mark the moment shown in the drawing.</p>`,
    task: `Press ${k('N')} when you have looked at them.`,
  },
  {
    title: 'Typing an exact value',
    body: `<p>To enter a precise number, highlight the row and press ${k('i')} (insert). Type the value, then ${k('Enter')} to apply or ${k('Esc')} to cancel.</p>`,
    task: `Set <b>launch speed</b> to exactly <b>80</b>.`,
    hl: 'e1_v0',
    done: (c) => Number(p(c.tut, 'e1_v0')) === 80,
  },
  {
    title: 'Values can be maths',
    body: `<p>Inputs accept expressions: ${k('2*pi')}, ${k('sqrt(2)')}, ${k('1e-3')}, ${k('g0')} (standard gravity)… The Moon's gravity is about one sixth of Earth's.</p>`,
    task: `Set <b>gravity</b> to ${k('g0/6')} — then see how far the projectile flies on the Moon.`,
    hl: 'g',
    done: (c) => Math.abs(Number(p(c.tut, 'g')) - 9.80665 / 6) < 1e-6,
  },
  {
    title: 'Expected vs actual',
    body: `<p>The <b>expected vs actual</b> table compares the simulation with textbook formulas. <span class="pass">PASS</span> = matches within tolerance, <span class="fail">FAIL</span> = numerical error too big, <span class="dim">REF</span> = a reference value that is <i>not supposed</i> to match (here: the no-air formula while drag is on).</p>`,
    task: `Turn air resistance off: highlight <b>drag model</b> and press ${k('l')} until it says <b>none</b>.`,
    hl: 'drag',
    done: (c) => p(c.tut, 'drag') === 'none',
  },
  {
    title: 'Now the formulas apply',
    body: `<p>In a vacuum the textbook range, flight time and apex height formulas are exact — those rows switched to <span class="pass">PASS</span>, and the error columns show how close the numerical result is (often 1e-6 or better).</p>`,
    task: `Press ${k('N')} to continue.`,
  },
  {
    title: 'Hit the target',
    body: `<p>There is a target at x = 200 m (the red circle; status under <b>targets</b> on the left). The results list <b>vacuum angle to hit (low)</b> — the exact angle needed.</p>`,
    task: `Type that angle into <b>launch angle</b> so the target says <span class="hit">HIT</span>.`,
    hl: 'e1_ang',
    done: (c) => !!c.tut?.res?.targets?.some((q: any) => q.hit),
  },
  {
    title: 'Place it, throw it',
    body: `<p>Where an object starts matters. Press ${k('E')} (or click <b>EDIT</b>) to open the scene: ${k('shift')}+drag (or ${k('g')} then ${k('hjkl')}) moves an object — a launcher's height above the ground becomes its launch height. Plain drag from an object <b>aims</b> it: the arrow's direction is the launch angle and its length the speed (${k('v')} then ${k('hjkl')} does the same from the keyboard). ${k('Enter')} finishes; the new values are in the list.</p>`,
    task: `Open EDIT, lift the launcher onto a higher spot (and aim it if you like), then press ${k('Enter')}.`,
    done: (c) => !!c.tut && !c.tut.editing && parseEnts(c.tut.p).some((e) => e.k === 'proj' && e.y < GROUND),
  },
  {
    title: 'Watch it happen',
    body: `<p>By default you see the <b>finished</b> result with every graph filled in. Press ${k('space')} to replay it <b>live</b>: the object flies, the graphs draw themselves and rows stream into the data table as time passes. ${k('space')} again pauses; the final results come back when it ends (or press ${k('G')}).</p>`,
    task: `Press ${k('space')} and watch the replay.`,
    done: (c) => c.seenLive,
  },
  {
    title: 'Step through time',
    body: `<p>${k('Tab')} moves focus between the parameter list and the <b>data table</b>. In the table, ${k('j')}/${k('k')} step one row, ${k('Ctrl-d')}/${k('Ctrl-u')} half a page, ${k('gg')}/${k('G')} start/end. The drawing and free-body diagram follow the selected row.</p>`,
    task: `Press ${k('Tab')} to focus the table and step through a few rows.`,
    done: (c) => c.tut?.focus === 'table' && c.tut?.row < c.tut?.res?.rows?.length - 1,
  },
  {
    title: 'Numerical methods',
    body: `<p>Under <b>numerics</b>: the <b>integrator</b> (how the equations are stepped), the <b>timestep dt</b> and the number of <b>iterations</b>. Different integrators give different accuracy.</p>`,
    task: `${k('Tab')} back to the parameters, highlight <b>integrator</b> and switch it to <b>euler</b>.`,
    hl: '$method',
    done: (c) => c.tut?.s?.method === 'euler',
  },
  {
    title: 'See the error',
    body: `<p>Look at the <b>energy</b> check: explicit Euler slowly gains or loses energy, so its error grows (it may even FAIL). RK4 keeps it near machine precision. That is why the default is rk4.</p>`,
    task: `Switch the integrator back to <b>rk4</b>.`,
    hl: '$method',
    done: (c) => c.tut?.s?.method === 'rk4',
  },
  {
    title: 'Compare runs',
    body: `<p>${k('yy')} duplicates the current run into a new tab. Change something there, then type ${k(':compare')} and ${k('Enter')} to get overlaid graphs and a table of differences between all runs of this module.</p>`,
    task: `Press ${k('yy')}, change the launch angle in the copy, then run ${k(':compare')}.`,
    done: (c) => c.cur?.kind === 'cmp',
  },
  {
    title: 'Watch several at once',
    body: `<p>The <b>theater</b> plays multiple simulations side by side on one shared clock, with live values and differences underneath. ${k('W')} (or ${k(':watch')}) opens it from a compare tab. In there: ${k('space')} play, ${k('+')}/${k('-')} speed, ${k('j')}/${k('k')} pick the variable to compare.</p>`,
    task: `Press ${k('W')} on the compare tab.`,
    done: (c) => c.cur?.kind === 'watch',
  },
  {
    title: 'You are ready',
    body: `<p>Everything happens in one workspace. Press ${k('M')} (or click <b>change</b>) to load any of the 23 simulations. The outside list holds its <b>environment</b> (gravity, air, the road…); ${k('E')} (or <b>EDIT</b>) is where you place, throw and aim things and add more — pendulums, balls, planets, cars, a Saturn V… each with its own hand-set values, all in one frame where they act on each other (where you put things matters). Also: ${k(':sweep ang 10 80 15')} sweeps, ${k(':multi v0 40 50 60')} variants, ${k(':realtime')} real-time playback, ${k('?')} the key list, ${k(':help')} this guide again.</p>`,
    task: `Press ${k('N')} to close the guide.`,
  },
];
