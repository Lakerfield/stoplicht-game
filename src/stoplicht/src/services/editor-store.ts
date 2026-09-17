import type { LevelData } from '../sim';
import { LocalKeyValueStorage, type KeyValueStorage } from './storage';

const KEY = 'editor-level';

/** Holds the level being edited so it survives the round trip editor -> test run -> editor and page reloads. */
export class EditorStore {
  private level: LevelData | null;

  constructor(private readonly storage: KeyValueStorage = new LocalKeyValueStorage()) {
    this.level = storage.get<LevelData>(KEY) ?? null;
  }

  get current(): LevelData | null {
    return this.level;
  }

  save(level: LevelData): void {
    this.level = level;
    this.storage.set(KEY, level);
  }

  clear(): void {
    this.level = null;
    this.storage.remove(KEY);
  }
}
