import type { LevelConstants, LightGroupDef, ParamRange, VehicleKind, VehicleTypeDef } from './level-schema';

/** meters per tile */
export const TILE_SIZE = 8;
export const TICKS_PER_SECOND = 60;
export const DT = 1 / TICKS_PER_SECOND;

/** right-hand traffic: lane centre offset from the road centre line on two-way roads (m) */
export const LANE_OFFSET_TWO_WAY = 2;
/** vehicles stop this far before the intersection tile edge (m) */
export const STOP_LINE_OFFSET = 0.5;

export const DEFAULT_VEHICLE_TYPES: Record<string, VehicleTypeDef> = {
  car: { name: 'Auto', kind: 'car', length: 4.5, width: 2, maxSpeed: 14, acceleration: 2.5, deceleration: 4, minGap: 1.5 },
  truck: { name: 'Vrachtwagen', kind: 'truck', length: 10, width: 2.5, maxSpeed: 11, acceleration: 1.2, deceleration: 3, minGap: 2 },
  motorcycle: { name: 'Motor', kind: 'motorcycle', length: 2.2, width: 0.9, maxSpeed: 14, acceleration: 4, deceleration: 5, minGap: 1 },
  bus: { name: 'Bus', kind: 'bus', length: 12, width: 2.5, maxSpeed: 11, acceleration: 1, deceleration: 2.5, minGap: 2.5 },
  van: { name: 'Bestelbus', kind: 'van', length: 6, width: 2.2, maxSpeed: 13, acceleration: 2, deceleration: 3.5, minGap: 1.5 },
  tractor: { name: 'Tractor', kind: 'tractor', length: 5, width: 2.4, maxSpeed: 8, acceleration: 1, deceleration: 3, minGap: 2 },
};

/** Rendering category when a level's vehicle type omits `kind`. */
export function vehicleKindOf(type: VehicleTypeDef): VehicleKind {
  return type.kind ?? (type.length >= 7 ? 'truck' : 'car');
}

export const DEFAULT_AMBER_RANGE: ParamRange = { min: 1, max: 10, step: 0.1 };

export const DEFAULT_CONSTANTS: LevelConstants = {
  clearanceTime: 2,
  reactionTime: 0.3,
  greenRange: { min: 1, max: 30, step: 0.1 },
  offsetRange: { min: -30, max: 30, step: 0.1 },
  amberRange: DEFAULT_AMBER_RANGE,
};

export const DEFAULT_LIGHT_GROUPS: LightGroupDef[] = [
  { id: 'A', approaches: ['N', 'S'] },
  { id: 'B', approaches: ['E', 'W'] },
];

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}
