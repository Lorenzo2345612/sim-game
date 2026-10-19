export type SessionKind = 'practice' | 'qualifying' | 'sprint' | 'race';
export type GridRule = 'qualifying' | 'reverse-top8' | 'sprint-result';

export interface SessionSpec {
  kind: SessionKind;
  minutes?: number;
  laps?: number;
  points?: string;
  grid?: GridRule;
  polePoints?: number;
}

export interface WeekendFormat {
  id: string;
  name: string;
  sessions: SessionSpec[];
}

export interface PointsTable {
  id: string;
  positions: number[];
  fastestLap?: { points: number; maxPosition: number };
}
