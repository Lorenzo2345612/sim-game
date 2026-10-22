export interface TrackConditions {
  abrasion: number;
  trackTempC: number;
}

export const DEFAULT_TRACK_CONDITIONS: TrackConditions = { abrasion: 1, trackTempC: 30 };

export const TRACK_CONDITIONS: Record<string, TrackConditions> = {
  monza: { abrasion: 0.9, trackTempC: 35 },
  spa: { abrasion: 1.1, trackTempC: 25 },
  silverstone: { abrasion: 1.25, trackTempC: 30 },
  mexico: { abrasion: 0.8, trackTempC: 40 },
  daytona: { abrasion: 1.2, trackTempC: 35 },
  lusail: { abrasion: 1.3, trackTempC: 30 },
  bahrain: { abrasion: 1.5, trackTempC: 30 },
  braselton: { abrasion: 1.15, trackTempC: 35 },
  elkhart: { abrasion: 1.0, trackTempC: 30 },
  sepang: { abrasion: 1.3, trackTempC: 50 },
  baku: { abrasion: 0.75, trackTempC: 35 },
  budapest: { abrasion: 1.0, trackTempC: 50 },
  singapore: { abrasion: 0.85, trackTempC: 35 },
  lasvegas: { abrasion: 0.7, trackTempC: 15 },
  spielberg: { abrasion: 1.0, trackTempC: 35 },
  fontana: { abrasion: 1.2, trackTempC: 40 },
  'fontana-roval': { abrasion: 1.2, trackTempC: 40 },
  cleveland: { abrasion: 1.35, trackTempC: 35 },
  detroit: { abrasion: 1.2, trackTempC: 30 },
  'ermita-centro': { abrasion: 1.2, trackTempC: 40 },
  'ermita-federal': { abrasion: 1.2, trackTempC: 40 },
  'ermita-norte': { abrasion: 1.2, trackTempC: 40 },
  'ermita-mixto': { abrasion: 1.2, trackTempC: 40 },
  'ermita-poniente': { abrasion: 1.2, trackTempC: 40 },
  'ermita-veloz': { abrasion: 1.2, trackTempC: 40 },
  bathurst: { abrasion: 1.2, trackTempC: 25 },
  jeddah: { abrasion: 0.85, trackTempC: 35 },
  miami: { abrasion: 0.9, trackTempC: 45 },
};

export function conditionsFor(id: string): TrackConditions {
  const c = Object.prototype.hasOwnProperty.call(TRACK_CONDITIONS, id)
    ? TRACK_CONDITIONS[id]
    : DEFAULT_TRACK_CONDITIONS;
  return { abrasion: c.abrasion, trackTempC: c.trackTempC };
}

export function trackWearMult(c: TrackConditions): number {
  const t = Math.min(1.5, Math.max(0.7, 1 + 0.015 * (c.trackTempC - 30)));
  return c.abrasion * t;
}
