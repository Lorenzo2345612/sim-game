import type { PenaltyEntry } from '../race/penalties';

export function carName(car: number): string {
  return car === 0 ? 'You' : `AI ${car}`;
}

export function raceControlMessage(e: PenaltyEntry): string | null {
  if (e.kind !== 'penalty') return null;
  return `${e.seconds} SECOND TIME PENALTY FOR ${carName(e.car).toUpperCase()} - ${e.reason.toUpperCase()}`;
}

export interface PenaltyAnnouncement {
  title: string;
  value: string;
  reason: string;
}

export function penaltyAnnouncement(e: PenaltyEntry): PenaltyAnnouncement | null {
  if (e.kind !== 'penalty') return null;
  return {
    title: 'TIME PENALTY',
    value: `+${e.seconds} ${e.seconds === 1 ? 'SECOND' : 'SECONDS'}`,
    reason: e.reason.charAt(0).toUpperCase() + e.reason.slice(1),
  };
}

export function penaltyTag(seconds: number): string {
  return seconds > 0 ? `+${seconds}s` : '';
}
