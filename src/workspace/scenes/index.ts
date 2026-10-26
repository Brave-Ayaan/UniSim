// One-frame scenes: the simulations whose objects all live and interact in a single world.
import type { Catalog } from '../catalog';
import { acousticsScene } from './acoustics';
import { beamScene } from './beam';
import { thermoScene } from './thermo';
import { springsScene } from './springs';
import { emScene } from './em';
import { energyScene } from './energy';
import { vehicleScene } from './vehicle';
import { rotationScene } from './rotation';
import { aeroScene } from './aero';
import { fluidsScene } from './fluids';
import { circuitsScene } from './circuits';
import { opticsScene } from './optics';
import { kineticsScene } from './kinetics';
import { controlScene } from './control';
import { fractureScene } from './fracture';
import { trussScene } from './truss';
import { granularScene } from './granular';
import { wavesScene } from './waves';
import { rocketScene } from './rocket';

export const SCENE_CATALOG: Record<string, Catalog> = {
  acoustics: acousticsScene,
  beam: beamScene,
  thermo: thermoScene,
  springs: springsScene,
  em: emScene,
  energy: energyScene,
  vehicle: vehicleScene,
  rotation: rotationScene,
  aero: aeroScene,
  fluids: fluidsScene,
  circuits: circuitsScene,
  optics: opticsScene,
  kinetics: kineticsScene,
  control: controlScene,
  fracture: fractureScene,
  truss: trussScene,
  granular: granularScene,
  waves: wavesScene,
  rocket: rocketScene,
};
