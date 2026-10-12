export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

/** Normalised driver controls. steer: -1 = full left, +1 = full right. */
export interface DriverInput { throttle: number; brake: number; steer: number; reset: boolean }

export interface SpawnPose { position: Vec3; yaw: number }

export interface WheelState {
  /** Wheel centre in world space. */
  position: Vec3;
  /** Steering angle in radians as applied to Rapier (positive = left). */
  steering: number;
  /** Accumulated spin angle around the axle in radians (Rapier wheelRotation). */
  rotation: number;
  inContact: boolean;
}

export interface VehicleState {
  position: Vec3;
  rotation: Quat;
  /** Signed speed along the car's forward axis, m/s (negative when reversing). */
  forwardSpeed: number;
  wheels: WheelState[]; // order: front-left, front-right, rear-left, rear-right
}

/** Output of tools/track-builder, served from public/tracks/<id>.json. */
export interface TrackData {
  id: string;                 // "monza"
  name: string;               // "Monza" (city/region name, never the commercial name)
  widthMeters: number;        // 12
  lengthMeters: number;       // length of the resampled closed centerline
  officialLengthMeters: number;
  /** Closed centerline [x, z] in metres, ~2 m spacing, index 0 = start/finish line, last point NOT repeated. */
  centerline: [number, number][];
  /** Centerline indices where sectors 1, 2, 3 start. sectors[0] is always 0. */
  sectors: [number, number, number];
  source: { dataset: string; license: string; url: string };
}

export type LapEvent =
  | { type: 'lapStarted'; lap: number; time: number }
  | { type: 'sectorCompleted'; lap: number; sector: number; sectorTime: number }
  | { type: 'lapCompleted'; lap: number; lapTime: number; isBest: boolean };
