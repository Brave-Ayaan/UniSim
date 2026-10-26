<div align="center">

# ⚛️ UniSim

**A keyboard-driven physics sandbox where everything shares one world.**

Place, throw and aim objects yourself. Watch them collide, heat, pull and break each other, with every result checked against exact physics.

![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-shell-000000?style=for-the-badge&logo=rust&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)

![Simulations](https://img.shields.io/badge/simulations-23-ff9f1c?style=flat-square)
![Self-checks](https://img.shields.io/badge/self--checks-376%20passing-2ea44f?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white)
![Offline](https://img.shields.io/badge/works-offline-8a2be2?style=flat-square)
![Keys](https://img.shields.io/badge/keys-vim-019733?style=flat-square&logo=vim&logoColor=white)

</div>

---

## 📑 Table of Contents

- [✨ Highlights](#-highlights)
- [🚀 Getting Started](#-getting-started)
- [🎓 Learning UniSim](#-learning-unisim)
- [🌍 The Workspace](#-the-workspace)
- [🧪 The 23 Simulations](#-the-23-simulations)
- [✏️ The Scene Editor (EDIT)](#️-the-scene-editor-edit)
- [▶️ Watching Simulations Play](#️-watching-simulations-play)
- [🎭 Theater Mode](#-theater-mode)
- [⌨️ Keys & Commands](#️-keys--commands)
- [✅ Self-Checking Physics](#-self-checking-physics)
- [🗂️ Project Layout](#️-project-layout)

---

## ✨ Highlights

| | |
| :-- | :-- |
| 🌐 **One frame per simulation** | Every object lives in the same world, on the same clock, and acts on every other object. Where you put things matters. |
| 🎯 **Drag to aim** | Drag from a launcher, ball or glider to set its direction and speed. |
| 🧮 **Exact checks** | Every run audits itself against closed-form results, such as energy balance, Torricelli's law, lens images and Paris-law fatigue. |
| ⌨️ **Vim keys** | `h j k l` everywhere, plus a command line, split panes, undo/redo and tabs. |
| 👾 **Pixel-art objects** | Includes a Saturn V, Newton's cradle, wrecking ball, coaster car, sailplane, drone, prism and more. |
| 📊 **Live graphs and data** | Charts draw themselves during replay, rows stream into the table, and you can export to CSV or JSON. |
| 🖥️ **Native and offline** | A Tauri desktop app with bundled fonts, native file dialogs and a strict CSP (no `eval`). |

---

## 🚀 Getting Started

> [!NOTE]
> UniSim is a native desktop app (Tauri on the system WebView2). There is no web version.

**Requirements:** [Node.js](https://nodejs.org) 18+, [Rust](https://rustup.rs), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Brave-Ayaan/UniSim.git
cd UniSim
npm install
```

| Command | What it does |
| :-- | :-- |
| `npm run app` | 🔥 Starts the desktop app with hot reload |
| `npm run app:exe` | 📦 Builds a release executable at `src-tauri/target/release/unisim.exe` |
| `npm run app:build` | 💿 Builds a release plus a Windows installer (NSIS) |
| `npm run check` | 🔍 Type-checks the project |

---

## 🎓 Learning UniSim

> [!TIP]
> Type **`:help`** in the app. The guide also opens on its own the first time you launch.

The interactive guide opens a live projectile simulation and walks you through it in **18 steps**. Each step asks you to do something, and it moves on once you've done it. The steps cover:
- moving to a value, changing it, and typing a formula
- hitting a target
- aiming in EDIT
- replaying live, comparing runs, and opening the theater

- `N` / `B` go forward and back. `:help stop` closes the guide.
- `?` or `:keys` opens the full key reference.
- The box under each parameter list explains the highlighted value in plain words, with its unit and how to change it.

---

## 🌍 The Workspace

UniSim is one screen. Press **`M`** (or click **change**) to pick a simulation, or type `:sim pendulum`. Each simulation remembers its scene when you switch away and back.

Every value lives in exactly one of two places:

| 🌦️ **Environment** (outside, parameter list) | 🧍 **Objects** (inside EDIT) |
| :-- | :-- |
| Things nobody can change by hand | Things a person could change |
| Gravity, air density, drag, wind, damping, road surface and grade, magnetic field, room temperature, disturbances | Mass, size, throw speed and angle, start position, rope length, spring stretch |
| Applies to **every** object | Shown as `+ 1 · name` blocks, with one block per object |

---

## 🧪 The 23 Simulations

<details open>
<summary><b>🏃 Mechanics</b></summary>

| | Simulation | How the objects interact |
| :-: | :-- | :-- |
| 🎯 | **Projectile** | Launchers fire from where you put them, and each aims at the nearest target. |
| 🕰️ | **Pendulum** | Simple, compound and double pendulums share one ceiling, and balls and ropes hit each other. |
| 🎱 | **Collisions** | Balls collide on one table. |
| 🪐 | **Orbital** | Bodies you throw attract each other. |
| 🎢 | **Energy transfer** | Carts ride one spline coaster track, rub, bump into each other and bounce off the buffers. |
| 🚗 | **Vehicles** | Cars share one lane, with reaction times, brake lights, crashes and speed bumps. |
| 🛞 | **Rotation** | Balls, hoops and boxes roll or slip down wedge ramps and into each other. |
| 🪀 | **Springs** | Masses on a row form a chain between walls, and shakers drive them. |
| ⚙️ | **Control** | Drones and lifts hold target heights through gusts and sensor lag, and can land on each other. |

</details>

<details open>
<summary><b>💨 Fluids & Air</b></summary>

| | Simulation | How the objects interact |
| :-: | :-- | :-- |
| 🪂 | **Aerodynamics** | Spheres fall, gliders glide, fans blow updrafts, and the wind blows on everything. |
| 🚰 | **Fluids** | Pipes join neighbouring tanks, drains empty them, floats raise the level, and full tanks spill. |
| ⏳ | **Granular** | Heaps pour into one box over pegs. |
| 🚀 | **Rockets** | Rockets lift off from their own pads into one sky. A higher pad starts in thinner air. |

</details>

<details open>
<summary><b>🔊 Waves, Light & Sound</b></summary>

| | Simulation | How the objects interact |
| :-: | :-- | :-- |
| 🌊 | **Waves** | Sources, slit walls and microphones share one patch of air, showing interference, diffraction and Doppler shifts. |
| 🎵 | **Room acoustics** | Speakers, microphones and absorbing panels share one ray-traced room. |
| 🔦 | **Optics** | Lamps and lasers shine through lenses, mirrors, glass blocks and prisms onto screens. |

</details>

<details open>
<summary><b>⚡ Electricity & Fields</b></summary>

| | Simulation | How the objects interact |
| :-: | :-- | :-- |
| 🔌 | **Circuits** | Parts stacked in a column are in parallel, columns are in series, and switches run on timers. |
| 🧲 | **Electromagnetism** | Every charge pushes on every other charge inside uniform E and B fields. |

</details>

<details open>
<summary><b>🔥 Heat, Chemistry & Materials</b></summary>

| | Simulation | How the objects interact |
| :-: | :-- | :-- |
| 🌡️ | **Thermodynamics** | Touching blocks, water, heaters, rods and engines exchange heat, and water melts and boils. |
| ⚗️ | **Chemical kinetics** | Neighbouring flasks share heat, so one exothermic reaction can speed up the next. |
| 🏗️ | **Beams** | Loads rest on the beam below them and can walk along it, while props add supports. |
| 🌉 | **Trusses** | Vehicles drive across bridge decks, and the member forces change as they move. |
| 💥 | **Fracture** | Parts hanging in a chain carry the same load, so the weakest link breaks first. |

</details>

> [!NOTE]
> A few old single-object calculator modes did not fit a shared world, so they were folded into object types or dropped. They include the ideal-gas and Otto/Carnot diagrams, the solenoid, DC motor and AC generator, the flywheel and spinning top, cornering, the vibrating string, the venturi, the thick-lens tracers, and the boundary-layer calculators.

---

## ✏️ The Scene Editor (EDIT)

Press **`E`** (or click **EDIT**) to open the scene. Each simulation starts with a small ready-made scene.

| Action | Keys |
| :-- | :-- |
| 🧭 Move | `h j k l` |
| 🔀 Choose object | `[ ]` |
| ➕ Add | `space` or click · `:add saturn` |
| ❌ Delete | `x` or right-click |
| 📋 Copy | `y` |
| ⏭️ Next object | `Tab` |
| 🎯 Aim | drag from the object · or `v` then `h j k l` |
| ✋ Move object | shift-drag · or `g` then move |
| 📏 Size / rope | `+ -` · `< >` |
| ↩️ Undo / done | `u` · `Enter` |

---

## ▶️ Watching Simulations Play

Each run opens on the **finished result**, with every graph and table already filled in.

- **`space`** replays the run live. Graphs draw on fixed axes and rows stream into the table.
- A **LIVE** strip shows every value at the current moment. Final results stay greyed until the replay ends (or until you press `G`).
- **`:realtime`** plays at 1 simulated second per real second.
- **`:live off`** switches back to stepping a cursor over the finished result.

---

## 🎭 Theater Mode

| Input | Action |
| :-- | :-- |
| `W` · `:watch` | Shows the current run full-size with a live free-body diagram |
| `:watch all` · `:watch 2 5 7` | Shows up to 9 tabs on one synchronized clock |
| `:multi v0 40 50 60` | Creates one run per value and shows them together |
| `space [ ] { } 0 G` | Play/pause, step, jump ±5%, go to start/end |
| `+ -` | Speed ×2 / ÷2 |
| `s` · `o` | Switch between time and progress sync · loop |
| `j k` | Choose which variable to compare |

Theaters update on their own when a source tab is re-run.

---

## ⌨️ Keys & Commands

> [!TIP]
> Press **`?`** in the app for the full list.

| Key | Action |
| :-- | :-- |
| `j k` | Move the parameter cursor or table row |
| `h l` / `< >` | Nudge a value / ×10 |
| `i` | Edit a value (`2*pi`, `sqrt(2)*g0`, `1e-3`, …) |
| `Tab` | Switch focus between parameters and the data table |
| `gt gT H L` | Change tab |
| `wv wh wl wo wc` | Split, move between panes, keep only this pane, close pane |
| `yy` | Duplicate the run |
| `u` / `Ctrl-r` | Undo / redo |
| `r` / `R` | Run again / reset to defaults |

<details>
<summary><b>📜 All commands</b></summary>

```
:sim <name>        :edit             :add <object>      :done
:new <module>      :set k=v          :compare [tabs]    :sweep k a b n
:multi k v1 v2 …   :watch            :runall            :goal <qty> <v> [tol]
:export csv|json   :preset save|load|rm <name>          :session save|load
:vs                :only             :selftest          :q
```

</details>

---

## ✅ Self-Checking Physics

Every scene checks itself:

- 📒 **Bookkeeping** for the whole scene covers energy, volume, charge and momentum.
- 📐 **Closed-form results** are checked whenever the scene is simple enough to have one. Examples include:
  - stopping distances, rolling times and terminal speeds
  - Torricelli's law and Archimedes' principle
  - lens images and RC charging
  - weakest-link failure loads, Paris-law fatigue life and Doppler shifts

> [!IMPORTANT]
> Run **`:selftest`** to run every object type, real object and scene test in parallel on the worker pool. **376 checks pass.**

---

## 🗂️ Project Layout

```
UniSim/
├── src/
│   ├── core/          🧮 integrators, root finding, safe expression parser, worker pool, canvas renderer
│   ├── modules/       ⚛️ the 23 physics modules + plain-language parameter docs
│   ├── workspace/     🌍 environment/object catalog, one-frame scenes, pixel-art sprites
│   └── ui/            🖥️ tabs & vim keys, EDIT editor, theater, tutorial, native dialogs
└── src-tauri/         🦀 Rust shell: save/open commands, window config, CSP
```

<div align="center">

---

Made with ⚛️ and a lot of `h j k l`.

</div>
