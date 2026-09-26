import { I18N } from '@aurelia/i18n';
import { IRouter, type Params } from '@aurelia/router';
import { resolve } from 'aurelia';
import { GameSession, SPEEDS, type WaitStat } from '../services/game-session';
import { EditorStore } from '../services/editor-store';
import { LevelLoader, levelName, validateLevel } from '../services/level-loader';
import { intersectionDisplayName } from '../resources/intersection-name';
import { TimeFormatValueConverter } from '../resources/time-format';

export const EDITOR_LEVEL_ID = 'editor';

interface WaitRow {
  name: string;
  average: number;
  /** total as m:ss.d (converters cannot be nested in translation parameters) */
  totalText: string;
  vehicles: number;
}

const timeFormat = new TimeFormatValueConverter();

function toRows(waits: WaitStat[]): WaitRow[] {
  return waits
    .filter(w => w.total > 0)
    .slice(0, 3)
    .map(w => ({ name: intersectionDisplayName(w.intersectionId), average: w.average, totalText: timeFormat.toView(w.total), vehicles: w.vehicles }));
}

export class PlayPage {
  readonly session = resolve(GameSession);
  private readonly loader = resolve(LevelLoader);
  private readonly editorStore = resolve(EditorStore);
  private readonly router = resolve(IRouter);
  private readonly i18n = resolve(I18N);
  readonly speeds = SPEEDS;
  levelId = 'level1';
  nextLevelId: string | null = null;
  levelNumber: number | null = null;
  levelName = '';
  /** tutorial hint (levels 1 and 2), dismissable */
  hintKey: string | null = null;
  hintDismissed = false;
  error: string | null = null;

  get fromEditor(): boolean {
    return this.levelId === EDITOR_LEVEL_ID;
  }

  loading(params: Params): void {
    this.levelId = params.levelId ?? 'level1';
  }

  async attached(): Promise<void> {
    try {
      if (this.fromEditor) {
        const level = this.editorStore.current;
        if (!level) throw new Error(this.i18n.tr('play.noEditorLevel'));
        this.session.loadLevel(validateLevel(level), { trackProgress: false });
        this.nextLevelId = null;
        this.levelNumber = null;
        this.levelName = levelName(level, this.i18n.getLocale());
        this.hintKey = null;
      } else {
        const [level, manifest] = await Promise.all([this.loader.load(this.levelId), this.loader.getManifest()]);
        this.session.loadLevel(level);
        const index = manifest.levels.findIndex(l => l.id === this.levelId);
        this.nextLevelId = index >= 0 && index + 1 < manifest.levels.length ? manifest.levels[index + 1].id : null;
        this.levelNumber = index >= 0 ? index + 1 : null;
        this.levelName = levelName(level, this.i18n.getLocale());
        this.hintKey = this.levelId === 'level1' || this.levelId === 'level2' ? `hints.${this.levelId}` : null;
        this.hintDismissed = false;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.error = message.startsWith('Unknown level') ? this.i18n.tr('play.unknownLevel', { id: this.levelId }) : message;
    }
  }

  detaching(): void {
    this.session.pause();
  }

  back(): void {
    void this.router.load(this.fromEditor ? 'editor' : '');
  }

  next(): void {
    if (this.nextLevelId) void this.router.load(`play/${this.nextLevelId}`);
  }

  get playLabel(): string {
    switch (this.session.runState) {
      case 'running':
        return 'hud.pause';
      case 'paused':
        return this.session.needsRestart ? 'hud.restart' : 'hud.resume';
      default:
        return 'hud.start';
    }
  }

  /** the hint is shown before the first start and disappears once the player has opened the panel or started */
  get showHint(): boolean {
    return this.hintKey !== null && !this.hintDismissed && this.session.runState === 'idle' && this.session.selectedIntersectionId === null;
  }

  dismissHint(): void {
    this.hintDismissed = true;
  }

  get crashIntersectionName(): string {
    return intersectionDisplayName(this.session.collision?.intersectionId);
  }

  /** i18n key explaining why the blocking vehicle was stuck */
  get crashCauseKey(): string {
    const c = this.session.collision;
    if (!c) return '';
    if (c.cause === 'queue') return c.causeIntersectionId ? 'crash.causeQueue' : 'crash.causeQueueExit';
    if (c.cause === 'light') return 'crash.causeLight';
    return 'crash.causeUnknown';
  }

  get crashCauseIntersectionName(): string {
    return intersectionDisplayName(this.session.collision?.causeIntersectionId);
  }

  /** the three intersections where vehicles lost most time */
  get topWaits(): WaitRow[] {
    return toRows(this.session.result?.waits ?? []);
  }

  get crashWaits(): WaitRow[] {
    return toRows(this.session.waitStats());
  }

  get diffToBest(): number | null {
    const r = this.session.result;
    if (!r || r.previousBest === null) return null;
    return r.time - r.previousBest;
  }
}
