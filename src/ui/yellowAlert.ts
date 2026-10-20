import type { SectorFlag } from '../race/flags';

export const CLEAR_S = 3;
export type AlertMode = 'none' | 'yellow' | 'double' | 'clear';
export interface AlertView {
  mode: AlertMode;
  text: string;
  lightsOn: boolean;
}

const CLEAR_TEXT = '✓ SECTOR CLEAR · GREEN';

export class YellowAlert {
  private readonly view: AlertView = { mode: 'none', text: '', lightsOn: false };
  private clearUntil = 0;
  private lastText = '';
  private lastSector = 0;
  private lastKey = '';

  update(playerFlag: SectorFlag, playerSector: number, timeS: number): AlertView {
    const v = this.view;
    if (playerFlag !== 'green') {
      const double = playerFlag === 'double-yellow';
      v.mode = double ? 'double' : 'yellow';
      if (this.lastKey !== playerFlag || this.lastSector !== playerSector) {
        this.lastKey = playerFlag;
        this.lastSector = playerSector;
        this.lastText = double
          ? `⚠⚠ DOUBLE YELLOW · SECTOR ${playerSector} · SLOW DOWN, BE READY TO STOP`
          : `⚠ YELLOW FLAG · SECTOR ${playerSector} · NO OVERTAKING`;
      }
      v.text = this.lastText;
      v.lightsOn = Math.floor(timeS * 4) % 2 === 0;
      return v;
    }
    if (v.mode === 'yellow' || v.mode === 'double') this.clearUntil = timeS + CLEAR_S;
    this.lastKey = '';
    if ((v.mode === 'yellow' || v.mode === 'double' || v.mode === 'clear') && timeS < this.clearUntil) {
      v.mode = 'clear';
      v.text = CLEAR_TEXT;
    } else {
      v.mode = 'none';
      v.text = '';
    }
    v.lightsOn = false;
    return v;
  }
}
