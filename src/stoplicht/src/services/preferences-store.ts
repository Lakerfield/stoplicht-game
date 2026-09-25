import { LocalKeyValueStorage, type KeyValueStorage } from './storage';

export type Locale = 'nl' | 'en';
/** frame rate while the simulation runs; 'auto' = 30 on touch devices, 60 elsewhere; 'max' = display refresh rate */
export type FpsMode = 'auto' | '30' | '60' | 'max';
export const FPS_MODES: FpsMode[] = ['auto', '30', '60', 'max'];

export interface Preferences {
  locale: Locale;
  muted: boolean;
  editorUnlocked: boolean;
  fpsMode: FpsMode;
}

const KEY = 'preferences';
const DEFAULTS: Preferences = { locale: 'nl', muted: false, editorUnlocked: false, fpsMode: 'auto' };

export class PreferencesStore {
  private data: Preferences;

  constructor(private readonly storage: KeyValueStorage = new LocalKeyValueStorage()) {
    this.data = { ...DEFAULTS, ...(storage.get<Partial<Preferences>>(KEY) ?? {}) };
  }

  get<K extends keyof Preferences>(key: K): Preferences[K] {
    return this.data[key];
  }

  set<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    this.data = { ...this.data, [key]: value };
    this.storage.set(KEY, this.data);
  }
}
