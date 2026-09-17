import { IRouter, type Params } from '@aurelia/router';
import { resolve } from 'aurelia';
import { GameSession, SPEEDS } from '../services/game-session';
import { EditorStore } from '../services/editor-store';
import { LevelLoader, validateLevel } from '../services/level-loader';
import { intersectionDisplayName } from '../resources/intersection-name';

export const EDITOR_LEVEL_ID = 'editor';

export class PlayPage {
  readonly session = resolve(GameSession);
  private readonly loader = resolve(LevelLoader);
  private readonly editorStore = resolve(EditorStore);
  private readonly router = resolve(IRouter);
  readonly speeds = SPEEDS;
  levelId = 'level1';
  nextLevelId: string | null = null;
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
        if (!level) throw new Error('No level in editor');
        this.session.loadLevel(validateLevel(level), { trackProgress: false });
        this.nextLevelId = null;
      } else {
        const [level, manifest] = await Promise.all([this.loader.load(this.levelId), this.loader.getManifest()]);
        this.session.loadLevel(level);
        const index = manifest.levels.findIndex(l => l.id === this.levelId);
        this.nextLevelId = index >= 0 && index + 1 < manifest.levels.length ? manifest.levels[index + 1].id : null;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
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

  get crashIntersectionName(): string {
    return intersectionDisplayName(this.session.collision?.intersectionId);
  }

  get diffToBest(): number | null {
    const r = this.session.result;
    if (!r || r.previousBest === null) return null;
    return r.time - r.previousBest;
  }
}
