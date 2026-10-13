import type { CarSpec } from './carSpec';

export const AIR_DENSITY = 1.225;

export interface AeroForces {
  front: number;
  rear: number;
  drag: number;
}

export function aeroForces(
  spec: CarSpec,
  speedMs: number,
  rideDrop: number,
  setup?: { frontWing: number; rearWing: number },
  out?: AeroForces,
): AeroForces {
  const result = out ?? { front: 0, rear: 0, drag: 0 };
  const v = Math.abs(speedMs);
  const q = 0.5 * AIR_DENSITY * v * v;
  const ride = spec.aero.rideHeightSens * rideDrop;
  let claFront = spec.aero.claFront + ride;
  let claRear = spec.aero.claRear + ride;
  let cda = spec.aero.cda;
  if (setup) {
    const dF = setup.frontWing - spec.setup.frontWing.default;
    const dR = setup.rearWing - spec.setup.rearWing.default;
    claFront += spec.aero.wingStep.claFront * dF;
    claRear += spec.aero.wingStep.claRear * dR;
    cda += spec.aero.wingStep.cda * dR;
  }
  result.front = q * Math.max(0, claFront);
  result.rear = q * Math.max(0, claRear);
  result.drag = q * Math.max(0, cda);
  return result;
}
