import type { SectorFlag } from '../race/flags';

export const CLEAR_S = 3;
export type AlertMode = 'none' | 'yellow' | 'double' | 'clear' | 'countdown';
export interface AlertView {
  mode: AlertMode;
  text: string;
  lightsOn: boolean;
  /** 0 unless mode is 'countdown'. */
  digit: number;
}

const CLEAR_TEXT = '✓ SECTOR CLEAR · GREEN';

export class YellowAlert {
  private readonly view: AlertView = { mode: 'none', text: '', lightsOn: false, digit: 0 };
  private clearUntil = 0;
  private lastText = '';
  private lastSector = 0;
  private lastKey = '';

  update(
    playerFlag: SectorFlag,
    playerSector: number,
    timeS: number,
    countdowns?: readonly number[],
  ): AlertView {
    const v = this.view;
    if (playerFlag !== 'green') {
      const double = playerFlag === 'double-yellow';
      v.mode = double ? 'double' : 'yellow';
      v.digit = 0;
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
    // Countdown in the player's sector wins; else one in the next sector ahead (wraps).
    if (countdowns !== undefined) {
      const own = countdowns[playerSector - 1];
      if (own !== undefined && Number.isFinite(own)) {
        v.mode = 'countdown';
        v.digit = Math.ceil(own);
        v.text = `YELLOW FLAG IN ${v.digit} · SECTOR ${playerSector}`;
        v.lightsOn = true;
        return v;
      }
      const aheadSector = (playerSector % 3) + 1;
      const ahead = countdowns[aheadSector - 1];
      if (ahead !== undefined && Number.isFinite(ahead)) {
        v.mode = 'countdown';
        v.digit = Math.ceil(ahead);
        v.text = `YELLOW FLAG IN ${v.digit} · SECTOR ${aheadSector}`;
        v.lightsOn = true;
        return v;
      }
    }
    if (v.mode === 'yellow' || v.mode === 'double') this.clearUntil = timeS + CLEAR_S;
    this.lastKey = '';
    v.digit = 0;
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
