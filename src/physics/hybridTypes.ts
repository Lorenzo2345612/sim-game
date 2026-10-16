export type ErsMode = 'charge' | 'balance' | 'attack';
export interface HybridSpec { mgukW: number; batteryJ: number; deployJPerLap: number; harvestJPerLap: number; overtakeExtraJ: number; minSpeedMs: number; taperStartMs: number; taperEndMs: number; overtakeTaperStartMs: number; overtakeTaperEndMs: number; regenW: number; superClipW: number; liftHarvestW: number }
export interface ActiveAeroSpec { dragScale: number; downforceScale: number; transitionS: number }
export interface ErsTelemetry { socFrac: number; powerW: number; mode: ErsMode; overtake: boolean; clipping: boolean; lapDeployJ: number; lapHarvestJ: number; deployCapJ: number }
export interface AeroTelemetry { blend: number; inZone: boolean }
