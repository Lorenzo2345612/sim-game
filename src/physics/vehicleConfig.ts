import type { Vec3 } from '../core/types';

export interface VehicleConfig {
  massKg: number;
  chassisHalfExtents: Vec3;
  wheelRadius: number;
  suspensionRestLength: number;
  maxSuspensionTravel: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  frictionSlip: number;
  sideFrictionStiffness: number;
  wheelPositions: Vec3[]; // FL, FR, RL, RR
  enginePowerW: number;
  maxDriveForceN: number;
  brakeMax: number;
  maxSteerLowSpeed: number;
  maxSteerHighSpeed: number;
  dragAreaCdA: number;
  liftAreaClA: number;
}

export const PLACEHOLDER_CAR: VehicleConfig = {
  massKg: 650,
  chassisHalfExtents: { x: 0.8, y: 0.2, z: 2.0 },
  wheelRadius: 0.33,
  suspensionRestLength: 0.12,
  maxSuspensionTravel: 0.1,
  suspensionStiffness: 60,
  suspensionCompression: 4.4,
  suspensionRelaxation: 2.3,
  frictionSlip: 2.2,
  sideFrictionStiffness: 1.0,
  wheelPositions: [
    { x: -0.8, y: 0, z: -1.3 },
    { x: 0.8, y: 0, z: -1.3 },
    { x: -0.8, y: 0, z: 1.25 },
    { x: 0.8, y: 0, z: 1.25 },
  ],
  enginePowerW: 130000,
  maxDriveForceN: 6000,
  brakeMax: 20,
  maxSteerLowSpeed: 0.35,
  maxSteerHighSpeed: 0.10,
  dragAreaCdA: 0.9,
  liftAreaClA: 2.0,
};

// wheelRadius and hub x/z from public/models/f4.json (game model, task 053); the rest matches PLACEHOLDER_CAR.
export const F4_CAR: VehicleConfig = {
  massKg: 650,
  chassisHalfExtents: { x: 0.8, y: 0.2, z: 2.0 },
  wheelRadius: 0.273059,
  suspensionRestLength: 0.12,
  maxSuspensionTravel: 0.1,
  suspensionStiffness: 60,
  suspensionCompression: 4.4,
  suspensionRelaxation: 2.3,
  frictionSlip: 2.2,
  sideFrictionStiffness: 1.0,
  wheelPositions: [
    { x: -0.735795, y: 0, z: -1.366602 },
    { x: 0.735795, y: 0, z: -1.366503 },
    { x: -0.74315, y: 0, z: 1.366487 },
    { x: 0.74315, y: 0, z: 1.366618 },
  ],
  enginePowerW: 130000,
  maxDriveForceN: 6000,
  brakeMax: 20,
  maxSteerLowSpeed: 0.35,
  maxSteerHighSpeed: 0.10,
  dragAreaCdA: 0.9,
  liftAreaClA: 2.0,
};
