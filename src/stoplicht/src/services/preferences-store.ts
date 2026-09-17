import { LocalKeyValueStorage, type KeyValueStorage } from './storage';

export type Locale = 'nl' | 'en';

export interface Preferences {
  locale: Locale;
  muted: boolean;
  editorUnlocked: boolean;
}

const KEY = 'preferences';
const DEFAULTS: Preferences = { locale: 'nl', muted: false, editorUnlocked: false };

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
