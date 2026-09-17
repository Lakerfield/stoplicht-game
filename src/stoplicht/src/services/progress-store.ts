import type { LightSettings } from '../sim';
import { LocalKeyValueStorage, type KeyValueStorage } from './storage';

export interface LevelProgress {
  /** best finish time in seconds */
  bestTime: number;
  /** light settings that produced the best time */
  bestSettings: Record<string, LightSettings>;
  /** target time has been met at least once (unlocks the next level) */
  achieved: boolean;
}

interface ProgressData {
  version: 1;
  levels: Record<string, LevelProgress>;
}

const KEY = 'progress';

export class ProgressStore {
  private data: ProgressData;

  constructor(private readonly storage: KeyValueStorage = new LocalKeyValueStorage()) {
    this.data = storage.get<ProgressData>(KEY) ?? { version: 1, levels: {} };
  }

  get(levelId: string): LevelProgress | undefined {
    return this.data.levels[levelId];
  }

  save(levelId: string, progress: LevelProgress): void {
    this.data.levels[levelId] = progress;
    this.storage.set(KEY, this.data);
  }

  isUnlocked(levelIds: string[], levelId: string): boolean {
    const index = levelIds.indexOf(levelId);
    if (index <= 0) return true;
    return this.get(levelIds[index - 1])?.achieved === true;
  }
}
