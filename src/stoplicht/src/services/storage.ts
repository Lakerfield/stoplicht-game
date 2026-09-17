/** Key-value storage behind an interface so an online sync backend can be plugged in later. */
export interface KeyValueStorage {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

export class LocalKeyValueStorage implements KeyValueStorage {
  constructor(private readonly prefix = 'stoplicht:') {}

  get<T>(key: string): T | undefined {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // storage unavailable (private mode / quota): progress is simply not persisted
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch {
      // ignore
    }
  }
}
