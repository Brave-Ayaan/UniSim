import type { SimModule } from '../core/types';
import { pendulum } from './pendulum';
import { projectile } from './projectile';
import { collision } from './collision';
import { truss } from './truss';
import { orbital } from './orbital';
import { thermo } from './thermo';
import { beam } from './beam';
import { circuits } from './circuits';
import { aero } from './aero';
import { energy } from './energy';
import { fluids } from './fluids';
import { springs } from './springs';
import { rotation } from './rotation';
import { waves } from './waves';
import { em } from './em';
import { optics } from './optics';
import { kinetics } from './kinetics';
import { fracture } from './fracture';
import { rocket } from './rocket';
import { vehicle } from './vehicle';
import { granular } from './granular';
import { acoustics } from './acoustics';
import { control } from './control';
import { wrap } from '../workspace/wrap';

// every simulation is wrapped: its parameters are the global environment, EDIT adds objects
export const MODULES: SimModule[] = [
  pendulum, projectile, collision, truss, orbital, thermo, beam, circuits, aero, energy, fluids, springs,
  rotation, waves, em, optics, kinetics, fracture, rocket, vehicle, granular, acoustics, control,
].map(wrap);

export const findModule = (q: string): SimModule | undefined => {
  const s = q.toLowerCase();
  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= MODULES.length) return MODULES[n - 1];
  return MODULES.find((m) => m.id === s) ?? MODULES.find((m) => m.id.startsWith(s)) ?? MODULES.find((m) => m.name.toLowerCase().includes(s));
};
