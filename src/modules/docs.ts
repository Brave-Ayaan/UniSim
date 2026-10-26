// Plain-language explanation of every parameter, shown in the info box under the parameter list.
// Keyed by module id, then parameter key. `$method`, `$dt`, `$steps` describe the integrator rows.

export const SETTINGS_DOCS: Record<string, string> = {
  $method: 'How the equations are stepped through time. rk4 (Runge-Kutta, 4th order) is the most accurate; semi (semi-implicit/symplectic Euler) conserves energy well over long runs; euler is the simplest and drifts — compare them to see numerical error.',
  $dt: 'Timestep: how much simulated time passes per step. Smaller = more accurate but more steps needed for the same duration (simulated time = dt × iterations).',
  $steps: 'Number of steps (or, for static solvers, the resolution: points, segments, rays or samples). More steps = longer simulated time or finer detail.',
};

const G = 'Gravitational acceleration. Earth 9.80665, Moon 1.62, Mars 3.71 m/s².';

export const DOCS: Record<string, Record<string, string>> = {
  pendulum: {
    mode: 'simple = point mass on a massless rod; compound = a solid rod swinging from one end; double = two linked pendulums (chaotic).',
    L1: 'Length of the (first) rod. Longer pendulums swing more slowly: period ∝ √L.',
    m1: 'Mass of the (first) bob. For a single pendulum it does not change the period, only energy and tension.',
    th1: 'Starting angle from straight down. Small angles give the textbook period 2π√(L/g); large angles take longer.',
    w1: 'Starting angular velocity (a push). Positive = counter-clockwise.',
    L2: 'Length of the second rod (double mode).',
    m2: 'Mass of the second bob (double mode).',
    th2: 'Starting angle of the second rod (double mode). Tiny changes here diverge quickly — that is chaos.',
    w2: 'Starting angular velocity of the second rod.',
    g: G,
    c: 'Damping: friction that slowly removes energy. 0 = no losses, so total energy should stay constant.',
  },
  projectile: {
    v0: 'How fast the object leaves the launcher.',
    ang: 'Launch angle above horizontal. Without air, 45° gives the longest range from ground level.',
    h0: 'Height of the launch point above the ground.',
    g: G,
    m: 'Mass. Heavier objects are slowed less by the same drag force.',
    drag: 'Air resistance model: quadratic (realistic, ∝ v²), linear (∝ v, has an exact formula), or none (vacuum).',
    Cd: 'Drag coefficient (shape). Sphere ≈ 0.47, streamlined body ≈ 0.04, flat plate ≈ 1.28.',
    d: 'Diameter of the object; sets the frontal area that pushes through the air.',
    rho: 'Air density. Sea level 1.225 kg/m³; thinner air means less drag.',
    kl: 'Linear drag coefficient b in F = −b·v.',
    wind: 'Horizontal wind speed (+ = blowing in the launch direction). Drag acts relative to the moving air.',
    tx: 'Horizontal position of the target you are trying to hit.',
    ty: 'Height of the target.',
    tol: 'How close the path must pass to the target to count as a HIT.',
  },
  collision: {
    dim: '1D = head-on along a line; 2D = the balls can strike off-centre and scatter at angles.',
    m1: 'Mass of ball 1 (blue).', m2: 'Mass of ball 2 (orange).',
    v1: 'Initial velocity of ball 1 along x.', v2: 'Initial velocity of ball 2 along x (negative = moving left).',
    e: 'Coefficient of restitution: 1 = perfectly elastic (no KE lost), 0 = perfectly inelastic (they stick in the normal direction).',
    r1: 'Radius of ball 1.', r2: 'Radius of ball 2.',
    b: 'Impact offset: sideways distance between the centres\' paths. 0 = head-on; larger = glancing blow.',
  },
  truss: {
    type: 'Truss pattern. Pratt diagonals are in tension, Howe diagonals in compression, Warren uses alternating triangles.',
    n: 'Number of panels (bays) along the span; must be even.', span: 'Total length of the bridge between supports.',
    h: 'Height of the truss. Deeper trusses carry the same load with smaller chord forces.',
    load: 'uniform = load on every bottom joint; center = a single load at mid-span.',
    P: 'Load applied at each loaded joint (kN).', E: 'Young\'s modulus of the members (steel ≈ 200 GPa).',
    A: 'Cross-section area of each member. Bigger = lower stress and more buckling resistance.',
    fy: 'Yield strength: stress at which the material starts to permanently deform (steel ≈ 250 MPa).',
  },
  orbital: {
    mode: 'two-body = satellite around a planet; figure-8 = the famous 3-body choreography; lagrange = a test particle near a Lagrange point.',
    M: 'Mass of the central body (Earth = 5.972e24 kg).', Rb: 'Radius of the central body (impact if the orbit goes below it).',
    r0: 'Starting distance from the centre of the planet.',
    v0: 'Starting speed. At circular speed √(GM/r) the orbit is a circle; at √2× that it escapes.',
    gam: 'Flight-path angle: 0 = moving sideways (tangential), positive = climbing outward.',
    pert: 'Nudge added to the figure-8 start position — watch the choreography break apart.',
    mu: 'Mass ratio of the smaller primary (Earth-Moon ≈ 0.01215). L4/L5 are stable only below 0.0385.',
    Lp: 'Which Lagrange point to start at.', dx: 'Starting offset from the Lagrange point (non-dimensional).',
  },
  thermo: {
    mode: 'process = one ideal-gas process; carnot / otto = full engine cycles; conduction = heat flow along a rod; phase change = heating ice to steam.',
    n: 'Amount of gas in moles.', gam: 'Heat-capacity ratio γ = Cp/Cv (air 1.4, monatomic gas 1.667).',
    P1: 'Starting pressure (atmosphere ≈ 101.325 kPa).', T1: 'Starting temperature in kelvin.',
    proc: 'isothermal = constant T, isobaric = constant P, isochoric = constant V, adiabatic = no heat exchange.',
    r: 'How much the volume changes (V2/V1), or pressure for isochoric (P2/P1).',
    Th: 'Hot reservoir temperature of the Carnot engine.', Tc: 'Cold reservoir temperature. Efficiency = 1 − Tc/Th.',
    rc: 'Compression ratio of the Otto (petrol engine) cycle. Higher = more efficient.', Qin: 'Heat added by combustion per cycle.',
    L: 'Rod length.', k: 'Thermal conductivity (aluminium 205, copper 400, steel ~50 W/m·K).', rho: 'Density of the rod material.',
    cp: 'Specific heat capacity: energy to warm 1 kg by 1 K.', TL: 'Temperature held at the left end.', TR: 'Temperature held at the right end.',
    T0: 'Initial temperature of the whole rod.', N: 'Number of grid points along the rod (spatial resolution).',
    mw: 'Mass of water.', Ts: 'Starting temperature (below 0 °C = ice).', Te: 'Temperature to heat to (above 100 °C = steam).', Pw: 'Heater power.',
  },
  beam: {
    sup: 'simply supported = resting on two supports; cantilever = fixed at one end, free at the other (like a diving board).',
    L: 'Length of the beam.', P: 'Concentrated (point) load.', a: 'Where along the beam the point load sits, measured from the left.',
    w: 'Uniformly distributed load along the whole beam (e.g. its own weight + floor).', E: 'Young\'s modulus (stiffness of the material).',
    b: 'Width of the rectangular cross-section.', h: 'Depth of the section. Stiffness grows with h³ — the most effective way to reduce deflection.',
    fy: 'Yield strength of the material.', Pax: 'Axial compressive load, checked against column buckling.',
    K: 'Column end condition; sets the effective buckling length K·L.', lim: 'Allowed deflection, as span/x (L/360 is a common building limit).',
  },
  circuits: {
    mode: 'RLC/RC/RL step = switching on a DC source; AC series RLC = sinusoidal source; resistor network = R1 in series with R2‖R3.',
    V: 'Source voltage (peak value for AC).', R: 'Resistance (R1 in the network).', L: 'Inductance — resists changes in current.',
    C: 'Capacitance — stores charge.', f: 'AC source frequency. Resonance happens at f0 = 1/(2π√LC).', R2: 'Second resistor.', R3: 'Third resistor (in parallel with R2).',
  },
  aero: {
    mode: 'sphere fall = drag & terminal velocity; airfoil = wing lift/drag; boundary layer = flow along a flat plate; cylinder = wind-tunnel flow around a spinning cylinder.',
    rho: 'Fluid density (air 1.225, water 1000 kg/m³).', mu: 'Dynamic viscosity (air 1.81e-5, water 1e-3 Pa·s).',
    d: 'Sphere diameter.', rhos: 'Sphere material density.', g: G, U: 'Free-stream (wind) speed.',
    alpha: 'Angle of attack: angle between the wing chord and the oncoming air. Too high = stall.',
    cm: 'Maximum camber of the NACA airfoil (curvature, % of chord). Cambered wings lift at 0°.', cp: 'Where along the chord the maximum camber sits.',
    c: 'Chord: front-to-back width of the wing.', span: 'Wing span (tip to tip). Long thin wings have less induced drag.',
    e: 'Oswald efficiency: 1 = ideal elliptical lift distribution.', cd0: 'Profile (skin friction + form) drag coefficient.',
    stall: 'Angle where the flow separates and lift collapses.', Lp: 'Length of the flat plate.', Retr: 'Reynolds number where laminar flow becomes turbulent.',
    R: 'Cylinder radius.', Gam: 'Circulation (spin). Non-zero circulation creates lift — the Magnus effect.',
  },
  energy: {
    m: 'Mass of the block.', th: 'Steepness of the incline.', d: 'Distance the block slides before reaching the spring.',
    mu: 'Kinetic friction coefficient: turns motion into heat.', k: 'Spring stiffness: how hard the bumper pushes back per metre squeezed.',
    cg: 'Generator/eddy-current brake strength: turns motion into electrical energy (F = −c·v).', g: G,
  },
  fluids: {
    mode: 'venturi = pipe narrowing (Bernoulli); pipe flow = friction losses; tank drain = Torricelli; buoyancy = floating cube.',
    rho: 'Fluid density.', g: G, D1: 'Inlet pipe diameter.', D2: 'Throat (narrowest) diameter. Smaller throat = faster flow, lower pressure.',
    Q: 'Volume flow rate.', P1: 'Absolute pressure at the inlet.', dz: 'How much higher the outlet is than the inlet.',
    D: 'Pipe diameter.', Lp: 'Pipe length.', mu: 'Dynamic viscosity of the fluid.', eps: 'Wall roughness (commercial steel ≈ 0.045 mm).',
    At: 'Tank cross-section area.', ao: 'Area of the drain hole.', Cd: 'Discharge coefficient (sharp-edged orifice ≈ 0.61).', h0: 'Starting water depth.',
    side: 'Edge length of the cube.', rhoo: 'Density of the cube. Below the fluid density it floats.', z0: 'Extra push down at the start (sets bobbing amplitude).', c: 'Water damping on the bobbing motion.',
  },
  springs: {
    mode: 'single = one mass on a spring (damped, driven); coupled = two masses linked by springs (normal modes, beats).',
    m: 'Mass (m1).', k: 'Spring stiffness (k1). Natural frequency ω0 = √(k/m).', c: 'Damping. ζ = c/(2√km): <1 oscillates, 1 critical, >1 sluggish.',
    F0: 'Amplitude of the periodic driving force (0 = free vibration).', wd: 'Driving frequency. Near ω0 the response is largest: resonance.',
    m2: 'Second mass.', k2: 'Spring from the second mass to the right wall.', kc: 'Coupling spring between the masses. Weak coupling = slow energy swapping (beats).',
    x0: 'Starting displacement (of mass 1).', v0: 'Starting velocity (of mass 1).', x20: 'Starting displacement of mass 2.',
  },
  rotation: {
    mode: 'rolling = objects rolling down a ramp; flywheel = torque spin-up; gyroscope = spinning top that precesses.',
    shape: 'Shape sets the moment of inertia: a hoop is slowest down the ramp, a solid sphere fastest.', fshape: 'Flywheel shape (sets I = k·m·r²).',
    m: 'Mass.', r: 'Radius.', th: 'Incline angle.', mus: 'Static friction: enough of it means pure rolling, too little and it slips.', muk: 'Kinetic friction while slipping.',
    Ld: 'Length of the incline.', tau: 'Applied torque.', b: 'Bearing friction (opposes spin in proportion to speed).', toff: 'When the torque is switched off.',
    l: 'Distance from the pivot to the spinning disk.', rpm: 'Spin rate of the disk. Faster spin = slower precession.', th0: 'Tilt of the spin axis from vertical.',
    init: 'steady = released at exactly the steady precession rate; released = dropped from rest, so it nods (nutation).', g: G,
  },
  waves: {
    mode: 'string = vibrating string; interference = light through slits; doppler = moving sound source.',
    L: 'String length.', T: 'String tension. Wave speed c = √(T/μ).', mu: 'Mass per metre of the string.',
    init: 'mode n = a pure standing wave; pluck = pulled aside at one point; two pulses = two bumps passing through each other.',
    n: 'Harmonic number (number of half-waves on the string).', xp: 'Where the string is plucked (fraction of length).', A: 'Amplitude.',
    N: 'Grid points along the string.', lam: 'Wavelength of the light (green ≈ 550 nm).', ns: 'Number of slits (2 = double slit; many = grating).',
    dsl: 'Distance between slit centres. Wider spacing = narrower fringes.', asl: 'Width of each slit; sets the overall envelope.', Ds: 'Distance to the screen.',
    f0: 'Frequency emitted by the source.', vs: 'Source speed. Approaching = higher pitch, receding = lower.', vo: 'Observer speed.',
    yo: 'Closest distance between the source path and the observer.', Tair: 'Air temperature (sets the speed of sound).', Lw: 'Source sound power level.',
  },
  em: {
    mode: 'lorentz = charged particle in fields; solenoid = coil magnetic field; dc motor; ac generator.',
    q: 'Particle charge (proton = 1.602e-19 C; negative for electrons).', m: 'Particle mass (proton 1.673e-27, electron 9.109e-31 kg).',
    B: 'Magnetic field strength. Stronger B = tighter circles.', Ex: 'Electric field, x component.', Ey: 'Electric field, y component. E with B gives a sideways drift E×B.',
    vx: 'Initial speed across the field.', vz: 'Initial speed along the field (makes a helix).', N: 'Number of turns of wire.', Ls: 'Coil length.', Rs: 'Coil radius.', I: 'Coil current.',
    V: 'Motor supply voltage.', R: 'Winding / load resistance.', Lm: 'Winding inductance.', kt: 'Motor constant: torque per amp = back-emf per rad/s.',
    J: 'Rotor inertia.', bf: 'Viscous friction in the bearings.', tl: 'Load torque the motor must drive.', Ac: 'Coil area.', rpm: 'Generator shaft speed.',
  },
  optics: {
    mode: 'interface = refraction & reflection at a boundary; thin lens system = two lenses; thick lens trace = exact ray tracing.',
    n1: 'Refractive index where the light starts (air 1.0).', n2: 'Refractive index it enters (water 1.33, glass 1.5).', th: 'Angle of incidence from the normal.', t: 'Glass slab thickness (for the sideways shift).',
    f1: 'Focal length of lens 1 (negative = diverging).', f2: 'Focal length of lens 2.', sep: 'Distance between the lenses.', do: 'Distance of the object in front of lens 1.', ho: 'Object height.',
    R1: 'Radius of the front surface (+ = bulges toward the light).', R2: 'Radius of the back surface.', tc: 'Lens thickness at the centre.', n: 'Glass index (BK7 = 1.5168).', ap: 'How far from the axis rays are traced.',
  },
  kinetics: {
    mode: 'nth order = A → products; reversible = A ⇌ B reaches equilibrium; consecutive = A → B → C with an intermediate.',
    order: 'Reaction order: how the rate depends on [A] (rate = k[A]^n).', A0: 'Starting concentration of A.',
    Af: 'Pre-exponential factor of the forward reaction (Arrhenius A).', Ea: 'Activation energy: the energy barrier. Higher = slower and more temperature-sensitive.',
    Ar: 'Pre-exponential factor of the second reaction.', Ear: 'Activation energy of the second reaction.', T: 'Temperature. Rate k = A·exp(−Ea/RT).',
  },
  fracture: {
    mode: 'tensile test = stress-strain curve; hole in plate = stress concentration; crack fatigue = crack growth to failure.',
    E: 'Young\'s modulus.', sy: 'Yield strength.', nRO: 'Hardening exponent: larger n = sharper yield, less work-hardening.', ef: 'True strain at fracture.',
    W: 'Plate width.', dh: 'Hole diameter.', tp: 'Plate thickness.', F: 'Pulling force on the plate.',
    KIC: 'Fracture toughness: crack resistance (steel ~50, aluminium ~25, glass ~0.7 MPa√m).', Y: 'Crack geometry factor (edge crack ≈ 1.12).',
    smax: 'Peak stress in each load cycle.', smin: 'Minimum stress in each cycle.', a0: 'Initial crack length.', C: 'Paris-law coefficient (material).', mP: 'Paris-law exponent (steel ≈ 3).',
  },
  rocket: {
    ns: 'Number of stages. Dropping empty stages is what makes orbit reachable.', pay: 'Payload mass carried to the top.',
    grav: 'Gravity model: inverse square (real), constant g, or off (pure Tsiolkovsky).', drag: 'Include air drag in an exponential atmosphere.',
    Cd: 'Drag coefficient of the vehicle.', dia: 'Vehicle diameter (frontal area).', ht: 'Apogee you are aiming for.', htol: 'How close the apogee must be to count as a HIT.',
  },
  vehicle: {
    mode: 'braking = stopping distance; cornering = sliding vs rolling over; suspension = quarter-car over a bump.',
    m: 'Vehicle mass.', v0: 'Speed when the hazard appears.', mu: 'Peak tyre-road friction (dry asphalt ≈ 0.8, wet ≈ 0.5, ice ≈ 0.1).',
    muk: 'Friction with locked (skidding) wheels.', abs: 'ABS keeps tyres near peak friction instead of skidding.', tr: 'Driver reaction time before braking starts.',
    grade: 'Road slope (uphill helps braking).', CdA: 'Drag area (Cd × frontal area).', hcg: 'Height of the centre of gravity. Higher = more weight transfer and rollover risk.',
    wb: 'Wheelbase (front-to-rear axle distance).', ff: 'Share of weight on the front axle when parked.', R: 'Curve radius.', tw: 'Track width (left-right wheel distance).',
    bank: 'Road banking angle.', ms: 'Sprung mass (body, per corner).', mus: 'Unsprung mass (wheel, brake, hub).', ks: 'Suspension spring rate.',
    cs: 'Damper (shock absorber) rate.', kt: 'Tyre stiffness.', road: 'Road input: a step (kerb) or a sine wave.', zr: 'Bump height or road wave amplitude.', fr: 'Road wave frequency.', rho: 'Air density.',
  },
  granular: {
    mode: 'sand pile = grains poured onto a floor; particle gas = bouncing disks that reach a Maxwell-Boltzmann speed distribution.',
    N: 'Number of particles.', r: 'Particle radius.', rho: 'Particle material density.', kn: 'Contact stiffness (how hard grains push apart when they overlap).',
    e: 'Restitution: bounciness of collisions.', mu: 'Friction between grains — higher = steeper pile.', g: G, v0: 'Initial particle speed (gas mode).', W: 'Box width.', H: 'Box height.',
  },
  acoustics: {
    Lx: 'Room length.', Ly: 'Room width.', Lz: 'Room height.', alpha: 'Average absorption of the walls (0 = hard concrete, 1 = open window).',
    T: 'Air temperature.', rays: 'Number of sound rays traced (more = smoother decay curve).', scatter: 'Fraction of reflections that scatter diffusely (1 = fully diffuse).',
    fmax: 'Highest frequency of room modes to list.', sx: 'Source position along the length.', rx: 'Receiver position along the length.',
  },
  control: {
    plant: 'The system being controlled: a mass-spring-damper or a first-order lag (like a heater).',
    m: 'Mass of the plant.', c: 'Damping of the plant.', k: 'Spring stiffness of the plant.', K: 'Plant gain.', tau: 'Plant time constant.',
    Kp: 'Proportional gain: pushes harder the bigger the error. Too high = overshoot.', Ki: 'Integral gain: removes steady-state error over time.',
    Kd: 'Derivative gain: damps the motion by reacting to how fast the error changes.', Nf: 'Derivative filter bandwidth (limits noise/kick).',
    r: 'Setpoint: the value the controller tries to reach.', umax: 'Actuator limit: the largest control effort available.', aw: 'Anti-windup: stops the integrator growing while the actuator is saturated.',
    dist: 'Disturbance force applied partway through.', td: 'When the disturbance hits.',
  },
};

/** explanation for a parameter (falls back to stage-pattern keys for the rocket) */
export function docFor(mod: string, key: string): string | undefined {
  if (key in SETTINGS_DOCS) return SETTINGS_DOCS[key];
  const d = DOCS[mod]?.[key];
  if (d) return d;
  if (mod === 'rocket') {
    const m = /^(mp|md|isp|T)(\d)$/.exec(key);
    if (m) return ({ mp: 'Propellant mass of stage ', md: 'Empty (dry) mass of stage ', isp: 'Specific impulse (engine efficiency, seconds) of stage ', T: 'Engine thrust of stage ' } as Record<string, string>)[m[1]] + m[2] + '.';
  }
  return undefined;
}
