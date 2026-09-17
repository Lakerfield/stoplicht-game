import { DEFAULT_CONSTANTS, DEFAULT_VEHICLE_TYPES, type LevelData, type SpawnDef } from '../../src/sim';

/** Cross level: horizontal two-way road on row 4, vertical two-way road on column 5 (11x9 tiles). */
export function crossLevel(spawns: SpawnDef[], overrides: Partial<LevelData> = {}): LevelData {
  return {
    formatVersion: 1,
    id: 'cross',
    name: 'cross',
    grid: { width: 11, height: 9 },
    roads: [
      { id: 'h', from: [0, 4], to: [10, 4] },
      { id: 'v', from: [5, 0], to: [5, 8] },
    ],
    intersections: [{ id: 'k1', at: [5, 4] }],
    spawnPoints: [
      { id: 'N', at: [5, 0] },
      { id: 'S', at: [5, 8] },
      { id: 'W', at: [0, 4] },
      { id: 'E', at: [10, 4] },
    ],
    spawns,
    vehicleTypes: DEFAULT_VEHICLE_TYPES,
    constants: DEFAULT_CONSTANTS,
    targetTime: 60,
    collisionMode: 'strict',
    defaultLightSettings: { k1: { green: { A: 10, B: 10 }, offset: 0 } },
    ...overrides,
  };
}

/** Two intersections close together on one horizontal road: verticals at x=4 and x=6. */
export function doubleLevel(spawns: SpawnDef[], overrides: Partial<LevelData> = {}): LevelData {
  return {
    formatVersion: 1,
    id: 'double',
    name: 'double',
    grid: { width: 11, height: 9 },
    roads: [
      { id: 'h', from: [0, 4], to: [10, 4] },
      { id: 'v1', from: [4, 0], to: [4, 8] },
      { id: 'v2', from: [6, 0], to: [6, 8] },
    ],
    intersections: [
      { id: 'k1', at: [4, 4] },
      { id: 'k2', at: [6, 4] },
    ],
    spawnPoints: [
      { id: 'W', at: [0, 4] },
      { id: 'N1', at: [4, 0] },
    ],
    spawns,
    vehicleTypes: DEFAULT_VEHICLE_TYPES,
    constants: DEFAULT_CONSTANTS,
    targetTime: 60,
    collisionMode: 'strict',
    defaultLightSettings: {
      k1: { green: { A: 5, B: 5 }, offset: 0 },
      k2: { green: { A: 60, B: 1 }, offset: 0 },
    },
    ...overrides,
  };
}
