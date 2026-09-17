import { I18N } from '@aurelia/i18n';
import { resolve } from 'aurelia';
import { intersectionDisplayName } from '../resources/intersection-name';
import { GameSession } from '../services/game-session';
import { TICKS_PER_SECOND, type LightParam, type LightSettings, type SignalState } from '../sim';

export class IntersectionPanel {
  readonly session = resolve(GameSession);
  private readonly i18n = resolve(I18N);

  get intersection() {
    return this.session.selectedIntersection;
  }

  get displayName(): string {
    return intersectionDisplayName(this.intersection?.id);
  }

  get settings(): LightSettings | undefined {
    const info = this.intersection;
    return info ? this.session.settings[info.id] : undefined;
  }

  get constants() {
    return this.session.level!.constants;
  }

  get signal(): SignalState | null {
    return this.session.selectedSignal;
  }

  get cycleSeconds(): number {
    const info = this.intersection;
    const s = this.settings;
    if (!info || !s) return 0;
    return info.lightGroups.reduce((sum, g) => sum + (s.green[g.id] ?? 0) + this.constants.clearanceTime, 0);
  }

  isLocked(param: LightParam): boolean {
    return this.constants.lockedParams?.includes(param) ?? false;
  }

  groupLabel(groupId: string): string {
    const name = this.i18n.tr(`panel.group.${groupId}`, { defaultValue: groupId });
    return this.i18n.tr('panel.green', { group: name });
  }

  remaining(): string {
    const s = this.signal;
    return s ? (s.ticksRemaining / TICKS_PER_SECOND).toFixed(1) : '';
  }

  close(): void {
    this.session.selectIntersection(null);
  }
}
