import { LEVEL_FORMAT_VERSION, type LevelData } from '../sim';

export interface LevelManifestEntry {
  id: string;
  file: string;
  name: string;
}

export interface LevelManifest {
  formatVersion: number;
  levels: LevelManifestEntry[];
}

/** Loads the standard levels served as static JSON from /levels. */
export class LevelLoader {
  private manifest: Promise<LevelManifest> | null = null;

  getManifest(): Promise<LevelManifest> {
    this.manifest ??= fetchJson<LevelManifest>('levels/index.json');
    return this.manifest;
  }

  async load(levelId: string): Promise<LevelData> {
    const manifest = await this.getManifest();
    const entry = manifest.levels.find(l => l.id === levelId);
    if (!entry) throw new Error(`Unknown level ${levelId}`);
    return validateLevel(await fetchJson<LevelData>(`levels/${entry.file}`));
  }
}

export function validateLevel(level: LevelData): LevelData {
  if (level.formatVersion !== LEVEL_FORMAT_VERSION) {
    // Future: migrate older formats here.
    throw new Error(`Unsupported level format version ${level.formatVersion}`);
  }
  return level;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return (await response.json()) as T;
}
