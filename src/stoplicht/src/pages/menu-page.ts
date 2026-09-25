import { I18N } from '@aurelia/i18n';
import { IRouter } from '@aurelia/router';
import { resolve } from 'aurelia';
import pkg from '../../package.json';
import { cloneLevel } from './editor-page';
import { AudioService } from '../services/audio-service';
import { EditorStore } from '../services/editor-store';
import { LevelLoader, type LevelManifestEntry } from '../services/level-loader';
import { FPS_MODES, PreferencesStore, type FpsMode, type Locale } from '../services/preferences-store';
import { ProgressStore } from '../services/progress-store';

interface LevelRow extends LevelManifestEntry {
  unlocked: boolean;
  achieved: boolean;
  best: number | null;
}

const UNLOCK_TAPS = 7;
const TAP_WINDOW_MS = 4000;

export class MenuPage {
  private readonly loader = resolve(LevelLoader);
  private readonly progress = resolve(ProgressStore);
  private readonly prefs = resolve(PreferencesStore);
  private readonly i18n = resolve(I18N);
  private readonly router = resolve(IRouter);
  private readonly editorStore = resolve(EditorStore);
  readonly audio = resolve(AudioService);

  readonly version = pkg.version;
  levels: LevelRow[] = [];
  error: string | null = null;
  editorUnlocked = this.prefs.get('editorUnlocked');
  locale: Locale = this.prefs.get('locale');
  fpsMode: FpsMode = this.prefs.get('fpsMode');
  toast: string | null = null;

  private taps = 0;
  private lastTap = 0;

  async attached(): Promise<void> {
    try {
      const manifest = await this.loader.getManifest();
      const ids = manifest.levels.map(l => l.id);
      this.levels = manifest.levels.map(entry => {
        const p = this.progress.get(entry.id);
        return { ...entry, unlocked: this.editorUnlocked || this.progress.isUnlocked(ids, entry.id), achieved: p?.achieved ?? false, best: p?.bestTime ?? null };
      });
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  play(level: LevelRow): void {
    if (!level.unlocked) return;
    void this.router.load(`play/${level.id}`);
  }

  openEditor(): void {
    void this.router.load('editor');
  }

  /** Dev mode: copy a standard level into the editor and open it there. */
  async cloneToEditor(level: LevelRow, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      this.editorStore.save(cloneLevel(await this.loader.load(level.id)));
      void this.router.load('editor');
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** auto → 30 → 60 → max → auto */
  cycleFpsMode(): void {
    const next = FPS_MODES[(FPS_MODES.indexOf(this.fpsMode) + 1) % FPS_MODES.length];
    this.fpsMode = next;
    this.prefs.set('fpsMode', next);
  }

  async toggleLocale(): Promise<void> {
    this.locale = this.locale === 'nl' ? 'en' : 'nl';
    this.prefs.set('locale', this.locale);
    await this.i18n.setLocale(this.locale);
  }

  /** Hidden editor unlock: 7 shift-clicks (desktop) or 7 taps (touch) on the version number. */
  onVersionClick(event: MouseEvent): void {
    const isTouch = (event as PointerEvent).pointerType === 'touch' || matchMedia('(pointer: coarse)').matches;
    if (!isTouch && !event.shiftKey) return;
    const now = Date.now();
    if (now - this.lastTap > TAP_WINDOW_MS) this.taps = 0;
    this.lastTap = now;
    this.taps++;
    if (this.taps >= UNLOCK_TAPS) {
      this.taps = 0;
      this.setEditorUnlocked(true);
      this.showToast(this.i18n.tr('menu.editorUnlocked'));
    }
  }

  hideEditor(): void {
    this.setEditorUnlocked(false);
  }

  /** Dev mode (editor unlocked) also makes every level playable so they can be tested individually. */
  private setEditorUnlocked(value: boolean): void {
    this.editorUnlocked = value;
    this.prefs.set('editorUnlocked', value);
    const ids = this.levels.map(l => l.id);
    this.levels = this.levels.map(l => ({ ...l, unlocked: value || this.progress.isUnlocked(ids, l.id) }));
  }

  private showToast(text: string): void {
    this.toast = text;
    setTimeout(() => (this.toast = null), 2500);
  }
}
