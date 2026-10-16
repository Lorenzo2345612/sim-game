export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

/** Normalised driver controls. steer: -1 = full left, +1 = full right. */
export interface DriverInput { throttle: number; brake: number; steer: number; reset: boolean; shiftUp?: boolean; shiftDown?: boolean }

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
  | { type: 'lapCompleted'; lap: number; lapTime: number; isBest: boolean }
  | { type: 'lapInvalidated'; lap: number };

/** Per-track look: ground palette and default vegetation. */
export type EnvironmentType = 'parkland' | 'forest' | 'desert' | 'tropical' | 'city';

export type Surface = 'asphalt' | 'kerb' | 'grass' | 'gravel' | 'runoff';
export type Side = 'left' | 'right';
/** Centerline index range; end is inclusive, segments may wrap (end < start). */
export interface TrackSegment { start: number; end: number; side: Side }
export interface RunoffSegment extends TrackSegment { surface: 'gravel' | 'runoff'; widthMeters: number }
export interface BarrierSegment extends TrackSegment { type: 'armco' | 'tyres' | 'wall' | 'foam'; offsetMeters: number }
/** Offline escape road polyline (XZ metres, order A→K→B) at chicane braking zones. */
export interface EscapeRoad { points: [number, number][]; width: number }
export interface Terrain { originX: number; originZ: number; sizeX: number; sizeZ: number; rows: number; cols: number; heights: number[] } // Rapier layout; origin = centre
export interface TreeSpecies { name: string; preset: string; heightMeters: number }
export interface TreeInstances { species: string; data: number[] } // flat [x, z, scale, rotY] * n
export interface Grandstand { x: number; z: number; yaw: number; lengthMeters: number; rows: number; roof: boolean }
export interface PitLane { start: number; end: number; side: Side }
/** Static braking board beside the track; offset is metres from the centerline, positive outward on `side`. */
export interface Board { index: number; side: Side; offset: number; label: 50 | 100 | 150 | 200 }
/** Small yellow kerb on the inside of a chicane apex; offset is metres from the centerline on `side`, length metres along the track. */
export interface Sausage { index: number; side: Side; offset: number; length: number }
export interface SurfaceStrip { surface: Surface; positions: Float32Array; indices: Uint32Array; uvs: Float32Array } // task 031 builds, 032/037 consume

/** Baked city environment (tools/env/osmBuildings.ts), served from public/tracks/<id>-env.json. */
export type BuildingMaterial = 'glass' | 'concrete' | 'brick' | 'stone';
export interface Building { ring: [number, number][]; height: number; material: BuildingMaterial }
export interface Wall { line: [number, number][]; height: number; thickness: number }
export interface CityEnv { buildings: Building[]; walls: Wall[]; water: [number, number][][] }
export type LandmarkKind = 'cylinder-tower' | 'flame-towers' | 'twin-deck' | 'wheel' | 'lattice-tower';
export interface Landmark { kind: LandmarkKind; x: number; z: number; height: number; heading?: number } // local metres, heading rad
export interface TrackDataV2 extends Omit<TrackData, 'source'> {
  version: 2;
  /** Ground palette and vegetation set; parser defaults a missing value to 'parkland'. */
  environment?: EnvironmentType;
  elevation: number[];      // metres, per centerline point, relative to the start line (start = 0)
  kerbs: TrackSegment[];
  runoffs: RunoffSegment[];
  barriers: BarrierSegment[];
  terrain: Terrain;
  treeSpecies: TreeSpecies[];
  trees: TreeInstances[];
  grandstands: Grandstand[];
  pit: PitLane;
  escapeRoads?: EscapeRoad[];
  boards?: Board[];
  sausages?: Sausage[];
  landmarks?: Landmark[];
  /** Metres from the centerline to the left/right edge per index; absent when no section is narrowed. */
  halfWidthLeft?: number[];
  halfWidthRight?: number[];
  source: { dataset: string; license: string; url: string; dem: string };
}
