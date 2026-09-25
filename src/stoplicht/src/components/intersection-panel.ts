import { I18N } from '@aurelia/i18n';
import { resolve, watch } from 'aurelia';
import { intersectionDisplayName } from '../resources/intersection-name';
import { GameSession } from '../services/game-session';
import { DEFAULT_AMBER_RANGE, TICKS_PER_SECOND, type LightGroupDef, type LightParam, type LightSettings, type ParamRange, type SignalState } from '../sim';

/** Which part of the cycle is being edited: a group's green or amber, or the offset. */
export type PartKey = { kind: 'green' | 'amber'; group: string } | { kind: 'offset' };

export interface CyclePart {
  key: PartKey;
  kind: 'green' | 'amber';
  group: string;
  arrow: string;
  seconds: number;
  /** share of the cycle, 0..1 */
  share: number;
  selected: boolean;
}

export class IntersectionPanel {
  readonly session = resolve(GameSession);
  private readonly i18n = resolve(I18N);
  selected: PartKey = { kind: 'green', group: 'A' };

  /** a newly selected intersection starts with its first green part selected */
  @watch((panel: IntersectionPanel) => panel.session.selectedIntersectionId)
  onIntersectionChanged(): void {
    this.selected = { kind: 'green', group: this.groups[0]?.id ?? 'A' };
  }

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

  get amberRange(): ParamRange {
    return this.constants.amberRange ?? DEFAULT_AMBER_RANGE;
  }

  get signal(): SignalState | null {
    return this.session.selectedSignal;
  }

  get groups(): LightGroupDef[] {
    return this.intersection?.lightGroups ?? [];
  }

  /** ↕ for a north/south group, ↔ for east/west */
  arrowOf(group: LightGroupDef | string): string {
    const g = typeof group === 'string' ? this.groups.find(x => x.id === group) : group;
    if (!g) return '';
    return g.approaches.some(a => a === 'N' || a === 'S') ? '↕' : '↔';
  }

  groupName(groupId: string): string {
    return this.i18n.tr(`panel.group.${groupId}`, { defaultValue: groupId });
  }

  get cycleSeconds(): number {
    const s = this.settings;
    if (!s) return 0;
    return this.groups.reduce((sum, g) => sum + (s.green[g.id] ?? 0) + (s.amber?.[g.id] ?? this.constants.clearanceTime), 0);
  }

  /** The cycle as a row of parts: green, amber, green, amber, ... proportional to their duration. */
  get parts(): CyclePart[] {
    const s = this.settings;
    if (!s) return [];
    const total = this.cycleSeconds || 1;
    const out: CyclePart[] = [];
    for (const g of this.groups) {
      const green = s.green[g.id] ?? 0;
      const amber = s.amber?.[g.id] ?? this.constants.clearanceTime;
      out.push({ key: { kind: 'green', group: g.id }, kind: 'green', group: g.id, arrow: this.arrowOf(g), seconds: green, share: green / total, selected: this.isSelected('green', g.id) });
      out.push({ key: { kind: 'amber', group: g.id }, kind: 'amber', group: g.id, arrow: this.arrowOf(g), seconds: amber, share: amber / total, selected: this.isSelected('amber', g.id) });
    }
    return out;
  }

  get offsetSelected(): boolean {
    return this.selected.kind === 'offset';
  }

  isSelected(kind: 'green' | 'amber', group: string): boolean {
    return this.selected.kind === kind && this.selected.group === group;
  }

  select(key: PartKey): void {
    this.selected = key;
  }

  selectOffset(): void {
    this.selected = { kind: 'offset' };
  }

  // ---- the single slider below the bar

  get currentLabel(): string {
    const sel = this.selected;
    if (sel.kind === 'offset') return this.i18n.tr('panel.offset');
    const arrow = this.arrowOf(sel.group);
    const name = this.groupName(sel.group);
    return this.i18n.tr(sel.kind === 'green' ? 'panel.greenPart' : 'panel.amberPart', { arrow, name });
  }

  get currentRange(): ParamRange {
    const sel = this.selected;
    if (sel.kind === 'offset') return this.constants.offsetRange;
    return sel.kind === 'green' ? this.constants.greenRange : this.amberRange;
  }

  get currentValue(): number {
    const s = this.settings;
    const sel = this.selected;
    if (!s) return 0;
    if (sel.kind === 'offset') return s.offset;
    if (sel.kind === 'green') return s.green[sel.group] ?? 0;
    return s.amber?.[sel.group] ?? this.constants.clearanceTime;
  }

  set currentValue(v: number) {
    const s = this.settings;
    const sel = this.selected;
    if (!s) return;
    if (sel.kind === 'offset') {
      s.offset = v;
      return;
    }
    const targets = this.isLinked ? this.groups.map(g => g.id) : [sel.group];
    if (sel.kind === 'green') {
      for (const id of targets) s.green[id] = v;
    } else {
      s.amber ??= {};
      for (const id of targets) s.amber[id] = v;
    }
  }

  get currentLocked(): boolean {
    const sel = this.selected;
    return this.isLocked(sel.kind);
  }

  isLocked(param: LightParam): boolean {
    return this.constants.lockedParams?.includes(param) ?? false;
  }

  // ---- coupling

  get isLinked(): boolean {
    return this.intersection?.symmetric || (this.settings?.linked ?? true);
  }

  get linkFixed(): boolean {
    return this.intersection?.symmetric ?? false;
  }

  toggleLink(): void {
    const s = this.settings;
    if (!s || this.linkFixed || !this.session.canEditSettings) return;
    s.linked = !(s.linked ?? true);
    if (s.linked) {
      // re-couple: copy the first group's values to the others
      const first = this.groups[0]?.id;
      if (first !== undefined) {
        for (const g of this.groups) {
          s.green[g.id] = s.green[first];
          s.amber ??= {};
          s.amber[g.id] = s.amber[first] ?? this.constants.clearanceTime;
        }
      }
    }
    this.session.settingsChanged();
  }

  changed(): void {
    this.session.settingsChanged();
  }

  // ---- live phase

  colorOf(groupId: string): string {
    return this.signal?.colors[groupId] ?? 'red';
  }

  remaining(): string {
    const s = this.signal;
    return s ? (s.ticksRemaining / TICKS_PER_SECOND).toFixed(1) : '';
  }

  // ---- copy & paste between intersections

  copied = false;
  pasted = false;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  get canPaste(): boolean {
    return this.session.clipboard !== null && this.session.canEditSettings;
  }

  copy(): void {
    const info = this.intersection;
    if (!info) return;
    this.session.copySettings(info.id);
    this.flash('copied');
  }

  paste(): void {
    const info = this.intersection;
    if (!info || !this.session.pasteSettings(info.id)) return;
    this.flash('pasted');
  }

  private flash(which: 'copied' | 'pasted'): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.copied = which === 'copied';
    this.pasted = which === 'pasted';
    this.flashTimer = setTimeout(() => {
      this.copied = false;
      this.pasted = false;
      this.flashTimer = null;
    }, 1200);
  }

  close(): void {
    this.session.selectIntersection(null);
  }
}
