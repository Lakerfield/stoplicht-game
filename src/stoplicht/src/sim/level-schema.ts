/**
 * Level format (one JSON document per level). Pure data, no logic.
 * Bump LEVEL_FORMAT_VERSION on breaking changes and migrate old levels in level-loader.
 */
export const LEVEL_FORMAT_VERSION = 1;

/** Grid coordinate in tiles, [x, y]; x grows east, y grows south. */
export type GridPoint = [number, number];

/** Compass side of a tile. Also used as "approach": the side a vehicle enters an intersection from. */
export type Side = 'N' | 'E' | 'S' | 'W';

/** Straight, axis-aligned run of road tiles from `from` to `to` (inclusive). One-way flows from -> to. */
export interface RoadSegmentDef {
  id: string;
  from: GridPoint;
  to: GridPoint;
  oneWay?: boolean;
  /** editor-only bookkeeping for cycling the direction; stripped on export */
  reversedOnce?: boolean;
}

/** A group of lights that are always in the same state. v1: A = N+S approaches, B = E+W approaches. */
export interface LightGroupDef {
  id: string;
  approaches: Side[];
}

/** Optional explicit intersection definition; intersections are derived from the road geometry otherwise. */
export interface IntersectionDef {
  id: string;
  at: GridPoint;
  lightGroups?: LightGroupDef[];
}

/** Entry point on the map edge. `route` = waypoints after `at`; omitted = keep driving straight ahead. */
export interface SpawnPointDef {
  id: string;
  at: GridPoint;
  route?: GridPoint[];
}

export interface SpawnDef {
  /** seconds since level start */
  time: number;
  spawnPoint: string;
  vehicleType: string;
  /** per-vehicle route override (waypoints after the spawn tile) */
  route?: GridPoint[];
}

/** Visual/audio category of a vehicle type; physics come from the numbers, not from the kind. */
export type VehicleKind = 'car' | 'truck' | 'motorcycle' | 'bus' | 'van' | 'tractor';

/** All values in meters / seconds. */
export interface VehicleTypeDef {
  name?: string;
  kind?: VehicleKind;
  length: number;
  width?: number;
  maxSpeed: number;
  acceleration: number;
  deceleration: number;
  /** standstill gap to the vehicle in front */
  minGap: number;
}

export interface ParamRange {
  min: number;
  max: number;
  step: number;
}

export type LightParam = 'green' | 'offset';

export interface LevelConstants {
  /** all-red / amber time between phases, seconds */
  clearanceTime: number;
  /** delay before a standing vehicle reacts to green / to its leader moving, seconds */
  reactionTime: number;
  greenRange: ParamRange;
  offsetRange: ParamRange;
  /** parameters the player may not change in this level (tutorial levels) */
  lockedParams?: LightParam[];
}

/** Player-adjustable settings of one intersection. `green` is keyed by light-group id. */
export interface LightSettings {
  green: Record<string, number>;
  offset: number;
}

export type CollisionMode = 'strict' | 'mild';

export interface LevelData {
  formatVersion: number;
  id: string;
  name: string;
  grid: { width: number; height: number };
  roads: RoadSegmentDef[];
  intersections?: IntersectionDef[];
  spawnPoints: SpawnPointDef[];
  spawns: SpawnDef[];
  vehicleTypes: Record<string, VehicleTypeDef>;
  constants: LevelConstants;
  /** seconds */
  targetTime: number;
  collisionMode: CollisionMode;
  defaultLightSettings: Record<string, LightSettings>;
}
