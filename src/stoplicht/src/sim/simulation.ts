import { DT, secondsToTicks, TICKS_PER_SECOND } from './defaults';
import type { CollisionMode, LevelData, LightSettings, SpawnDef, VehicleTypeDef } from './level-schema';
import { RoadNetwork, type IntersectionInfo, type PathIntersection, type RoutePath, type SpawnPointInfo } from './road-network';
import { buildSignalPlan, signalStateAt, type SignalPlan, type SignalState } from './traffic-light';

export type SimStatus = 'active' | 'finished' | 'crashed';

export interface Vehicle {
  id: number;
  typeId: string;
  type: VehicleTypeDef;
  spawnPointId: string;
  path: RoutePath;
  /** front bumper position along the path (m) */
  s: number;
  /** position at the previous tick, for render interpolation */
  prevS: number;
  /** speed (m/s) */
  v: number;
  /** vehicle directly ahead in the same lane, null if none */
  leader: Vehicle | null;
  /** was standing still against a stop point at the end of the last tick */
  blocked: boolean;
  /** reaction delay: may not start moving before this tick */
  waitUntilTick: number;
  /** index into path.intersections of the first intersection whose zone the rear has not yet left */
  passedIndex: number;
  /**
   * Per path intersection: once its light is not green, stop before it or pass (already within braking
   * distance when it changed). Reset to null while the light is green.
   */
  lightDecisions: ('stop' | 'pass' | null)[];
  exited: boolean;
}

export type SimEventType = 'spawn' | 'exit' | 'start' | 'stop';

/** Side-channel for audio/visual feedback; never read back by the simulation itself. */
export interface SimEvent {
  type: SimEventType;
  vehicleId: number;
}

export interface CollisionInfo {
  tick: number;
  intersectionId: string;
  vehicleIds: number[];
}

export interface SimCounts {
  onMap: number;
  /** spawn time reached but no room to enter yet */
  queued: number;
  /** spawn time not yet reached */
  pending: number;
  total: number;
}

export interface SimResult {
  status: SimStatus;
  /** seconds; the tick in which the last vehicle left the map */
  time: number;
  ticks: number;
  collision?: CollisionInfo;
}

/** a queued vehicle enters the map once at least this much road (m) is free behind the last vehicle */
const MIN_ENTRY_ROOM = 1;

interface SpawnQueue {
  point: SpawnPointInfo;
  spawns: { def: SpawnDef; tick: number; path: RoutePath }[];
  next: number;
  last: Vehicle | null;
}

/**
 * Deterministic fixed-timestep traffic simulation. No DOM, no Phaser, no randomness.
 * Same level + same light settings => bit-identical outcome on every platform.
 */
export class Simulation {
  readonly network: RoadNetwork;
  readonly vehicles: Vehicle[] = [];
  /** events of the most recent step */
  readonly events: SimEvent[] = [];
  readonly signals: SignalState[] = [];
  readonly plans: SignalPlan[];
  readonly collisionMode: CollisionMode;
  readonly totalVehicles: number;
  tick = 0;
  status: SimStatus = 'active';
  collision: CollisionInfo | undefined;
  finishTick: number | undefined;

  private readonly queues: SpawnQueue[] = [];
  private readonly reactionTicks: number;
  private nextVehicleId = 1;
  /** the spawn with the latest time; once on the map its vehicle decides the finish time */
  private finalSpawn: SpawnQueue['spawns'][number] | null = null;
  /** id of the vehicle from the final spawn, once it has entered the map */
  finalVehicleId: number | null = null;

  constructor(readonly level: LevelData, readonly settings: Record<string, LightSettings>, network?: RoadNetwork) {
    this.network = network ?? new RoadNetwork(level);
    this.collisionMode = level.collisionMode;
    this.reactionTicks = secondsToTicks(level.constants.reactionTime);
    this.plans = this.network.intersections.map(info => {
      const s = settings[info.id] ?? level.defaultLightSettings[info.id] ?? fallbackLightSettings(info);
      return buildSignalPlan(info, s, level.constants);
    });
    for (const point of this.network.spawnPoints) this.queues.push({ point, spawns: [], next: 0, last: null });
    const queueById = new Map(this.queues.map(q => [q.point.id, q]));
    level.spawns
      .map((def, index) => ({ def, index, tick: secondsToTicks(def.time) }))
      .sort((a, b) => a.tick - b.tick || a.index - b.index)
      .forEach(({ def, tick }) => {
        const queue = queueById.get(def.spawnPoint);
        if (!queue) throw new Error(`Spawn refers to unknown spawn point ${def.spawnPoint}`);
        if (!level.vehicleTypes[def.vehicleType]) throw new Error(`Unknown vehicle type ${def.vehicleType}`);
        const path = def.route ? this.network.buildRoutePath(queue.point.path.tiles[0], def.route) : queue.point.path;
        queue.spawns.push({ def, tick, path });
      });
    this.totalVehicles = level.spawns.length;
    for (const q of this.queues) {
      const last = q.spawns[q.spawns.length - 1];
      if (last && (!this.finalSpawn || last.tick >= this.finalSpawn.tick)) this.finalSpawn = last;
    }
    this.updateSignals();
    this.checkFinished();
  }

  get time(): number {
    return this.tick / TICKS_PER_SECOND;
  }

  get finishTime(): number | undefined {
    return this.finishTick === undefined ? undefined : this.finishTick / TICKS_PER_SECOND;
  }

  intersection(index: number): IntersectionInfo {
    return this.network.intersections[index];
  }

  /** mean speed of vehicles on the map (m/s), 0 when empty */
  meanSpeed(): number {
    if (this.vehicles.length === 0) return 0;
    let sum = 0;
    for (const v of this.vehicles) sum += v.v;
    return sum / this.vehicles.length;
  }

  /** vehicles per spawn point whose spawn time has passed but that are still waiting off-map */
  queuedBySpawnPoint(): Map<string, number> {
    const out = new Map<string, number>();
    for (const q of this.queues) {
      let n = 0;
      for (let i = q.next; i < q.spawns.length && q.spawns[i].tick < this.tick; i++) n++;
      if (n > 0) out.set(q.point.id, n);
    }
    return out;
  }

  counts(): SimCounts {
    let queued = 0;
    let pending = 0;
    for (const q of this.queues) {
      for (let i = q.next; i < q.spawns.length; i++) {
        // spawns are processed while stepping tick t; afterwards this.tick === t + 1
        if (q.spawns[i].tick < this.tick) queued++;
        else pending++;
      }
    }
    return { onMap: this.vehicles.length, queued, pending, total: this.totalVehicles };
  }

  /** Advances the simulation by one tick (1/60 s). */
  step(): void {
    if (this.status !== 'active') return;
    this.events.length = 0;
    this.updateSignals();
    this.spawnVehicles();

    const moves = this.vehicles.map(v => this.computeMove(v));
    for (let i = 0; i < this.vehicles.length; i++) {
      const veh = this.vehicles[i];
      if (veh.v === 0 && moves[i].v > 0) this.events.push({ type: 'start', vehicleId: veh.id });
      else if (veh.v > 0 && moves[i].v === 0) this.events.push({ type: 'stop', vehicleId: veh.id });
      veh.prevS = veh.s;
      veh.s = moves[i].s;
      veh.v = moves[i].v;
      veh.blocked = moves[i].blocked;
      this.advanceIntersectionMarker(veh);
    }
    this.removeExited();
    this.tick++;
    this.detectCollisions();
    if (this.status === 'active') this.checkFinished();
  }

  /** Runs until finished/crashed or until maxTicks elapsed. */
  run(maxTicks = TICKS_PER_SECOND * 3600): SimResult {
    while (this.status === 'active' && this.tick < maxTicks) this.step();
    return this.result();
  }

  result(): SimResult {
    return {
      status: this.status,
      time: this.finishTick !== undefined ? this.finishTick / TICKS_PER_SECOND : this.time,
      ticks: this.finishTick ?? this.tick,
      collision: this.collision,
    };
  }

  private updateSignals(): void {
    for (let i = 0; i < this.plans.length; i++) this.signals[i] = signalStateAt(this.plans[i], this.tick);
  }

  private spawnVehicles(): void {
    for (const queue of this.queues) {
      while (queue.next < queue.spawns.length && queue.spawns[queue.next].tick <= this.tick) {
        const entry = queue.spawns[queue.next];
        const type = this.level.vehicleTypes[entry.def.vehicleType];
        let v0 = type.maxSpeed;
        // never enter faster than allows a comfortable stop at the first stop line (1 m margin so the
        // stop/pass decision, which compares braking distance with the distance left, cannot flip to 'pass')
        const first = entry.path.intersections[0];
        if (first) v0 = Math.min(v0, Math.sqrt(2 * type.deceleration * Math.max(0, first.sStop - 1)));
        const leader = queue.last && !queue.last.exited ? queue.last : null;
        if (leader) {
          // room between the map edge and the leader's rear (minus the following gap). A vehicle joins the
          // queue as soon as its nose fits; the rest of its body stays off-map until the queue moves.
          const free = leader.s - leader.type.length - type.minGap;
          if (free < MIN_ENTRY_ROOM) break; // no room yet: wait in the invisible queue, later spawns shift along
          v0 = Math.min(v0, Math.sqrt(2 * type.deceleration * free));
        }
        const vehicle: Vehicle = {
          id: this.nextVehicleId++,
          typeId: entry.def.vehicleType,
          type,
          spawnPointId: queue.point.id,
          path: entry.path,
          s: 0,
          prevS: 0,
          v: v0,
          leader,
          blocked: false,
          waitUntilTick: 0,
          passedIndex: 0,
          lightDecisions: entry.path.intersections.map(() => null),
          exited: false,
        };
        this.vehicles.push(vehicle);
        if (entry === this.finalSpawn) this.finalVehicleId = vehicle.id;
        this.events.push({ type: 'spawn', vehicleId: vehicle.id });
        queue.last = vehicle;
        queue.next++;
      }
    }
  }

  private groupOf(pi: PathIntersection): string | undefined {
    return this.network.intersections[pi.intersectionIndex].approachToGroup[pi.approach];
  }

  private isGreenFor(pi: PathIntersection): boolean {
    const group = this.groupOf(pi);
    if (group === undefined) return true; // unsignalled approach
    return this.signals[pi.intersectionIndex].greenGroup === group;
  }

  private occupiesZone(veh: Vehicle, pi: PathIntersection): boolean {
    return veh.s > pi.sEnter && veh.s - veh.type.length < pi.sExit;
  }

  /** Calls fn for every intersection zone the vehicle body currently overlaps. */
  private forEachOccupiedZone(veh: Vehicle, fn: (pi: PathIntersection) => void): void {
    const list = veh.path.intersections;
    for (let i = veh.passedIndex; i < list.length && list[i].sEnter < veh.s; i++) {
      if (this.occupiesZone(veh, list[i])) fn(list[i]);
    }
  }

  /** Mild mode: is the intersection ahead occupied by traffic from another light group? */
  private zoneBlockedByCrossTraffic(veh: Vehicle, pi: PathIntersection): boolean {
    const group = this.groupOf(pi);
    let blocked = false;
    for (const other of this.vehicles) {
      if (other === veh || blocked) continue;
      this.forEachOccupiedZone(other, opi => {
        if (opi.intersectionIndex === pi.intersectionIndex && this.groupOf(opi) !== group) blocked = true;
      });
    }
    return blocked;
  }

  private computeMove(veh: Vehicle): { s: number; v: number; blocked: boolean } {
    const type = veh.type;
    let stopAt = Infinity;

    if (veh.leader && !veh.leader.exited) {
      stopAt = veh.leader.s - veh.leader.type.length - type.minGap;
    }

    // Look at every intersection ahead whose stop line the front bumper has not passed yet.
    const list = veh.path.intersections;
    for (let i = veh.passedIndex; i < list.length; i++) {
      const pi = list[i];
      if (veh.s > pi.sStop) continue;
      if (this.isGreenFor(pi)) {
        veh.lightDecisions[i] = null;
      } else {
        if (veh.lightDecisions[i] === null) {
          const brakingDistance = (veh.v * veh.v) / (2 * type.deceleration);
          veh.lightDecisions[i] = brakingDistance <= pi.sStop - veh.s ? 'stop' : 'pass';
        }
        if (veh.lightDecisions[i] === 'stop') stopAt = Math.min(stopAt, pi.sStop);
      }
      if (this.collisionMode === 'mild' && this.zoneBlockedByCrossTraffic(veh, pi)) {
        stopAt = Math.min(stopAt, pi.sStop);
      }
    }

    const d = stopAt - veh.s;
    if (d <= 0) {
      return { s: veh.s, v: 0, blocked: true };
    }

    let target = Math.min(type.maxSpeed, Math.sqrt(2 * type.deceleration * d));
    if (veh.v === 0) {
      if (veh.blocked) veh.waitUntilTick = this.tick + this.reactionTicks; // just released: reaction delay
      if (this.tick < veh.waitUntilTick) target = 0;
    }
    let v = target >= veh.v ? Math.min(veh.v + type.acceleration * DT, target) : target;
    let s = veh.s + v * DT;
    let blocked = false;
    if (s >= stopAt) {
      s = stopAt;
      v = 0;
      blocked = true;
    }
    return { s, v, blocked };
  }

  private advanceIntersectionMarker(veh: Vehicle): void {
    const list = veh.path.intersections;
    while (veh.passedIndex < list.length && veh.s - veh.type.length >= list[veh.passedIndex].sExit) {
      veh.passedIndex++;
    }
  }

  private removeExited(): void {
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const veh = this.vehicles[i];
      if (veh.s - veh.type.length >= veh.path.polyline.length) {
        veh.exited = true;
        this.events.push({ type: 'exit', vehicleId: veh.id });
        this.vehicles.splice(i, 1);
      }
    }
    for (const veh of this.vehicles) {
      if (veh.leader?.exited) veh.leader = null;
    }
  }

  /**
   * Collision = two vehicles from different light groups whose bodies actually overlap inside an
   * intersection tile. Bodies are treated as axis-aligned boxes (paths run straight through junctions in v1).
   */
  private detectCollisions(): void {
    const perIntersection = new Map<number, { veh: Vehicle; group: string }[]>();
    for (const veh of this.vehicles) {
      this.forEachOccupiedZone(veh, pi => {
        const group = this.groupOf(pi) ?? `approach:${pi.approach}`;
        let list = perIntersection.get(pi.intersectionIndex);
        if (!list) {
          list = [];
          perIntersection.set(pi.intersectionIndex, list);
        }
        list.push({ veh, group });
      });
    }
    if (this.collisionMode !== 'strict') return;
    for (const [index, list] of perIntersection) {
      if (list.length < 2) continue;
      const boxes = list.map(e => bodyBox(e.veh));
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].group === list[j].group) continue;
          if (!boxesOverlap(boxes[i], boxes[j])) continue;
          this.status = 'crashed';
          this.collision = {
            tick: this.tick,
            intersectionId: this.network.intersections[index].id,
            vehicleIds: [list[i].veh.id, list[j].veh.id].sort((a, b) => a - b),
          };
          return;
        }
      }
    }
  }

  private checkFinished(): void {
    if (this.vehicles.length > 0) return;
    for (const q of this.queues) if (q.next < q.spawns.length) return;
    this.status = 'finished';
    this.finishTick = this.tick;
  }
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Axis-aligned bounding box of a vehicle body: centre line from rear to front, widened by half the width. */
function bodyBox(veh: Vehicle): Box {
  const line = veh.path.polyline;
  const front = line.pointAt(veh.s);
  const rear = line.pointAt(veh.s - veh.type.length);
  const h = line.headingAt(veh.s - veh.type.length / 2);
  const half = (veh.type.width ?? 2) / 2;
  // widen perpendicular to the heading only (exact for axis-aligned bodies)
  const wx = Math.abs(h.y) * half;
  const wy = Math.abs(h.x) * half;
  return {
    minX: Math.min(front.x, rear.x) - wx,
    maxX: Math.max(front.x, rear.x) + wx,
    minY: Math.min(front.y, rear.y) - wy,
    maxY: Math.max(front.y, rear.y) + wy,
  };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** Settings used when a level does not specify defaults for an intersection. */
export function fallbackLightSettings(info: IntersectionInfo, clearanceTime = 2): LightSettings {
  const green: Record<string, number> = {};
  const amber: Record<string, number> = {};
  for (const g of info.lightGroups) {
    green[g.id] = 10;
    amber[g.id] = clearanceTime;
  }
  return { green, amber, offset: 0, linked: true };
}

/**
 * Complete settings for every intersection of the network, filling gaps (missing intersections, missing
 * amber times from older saves, missing `linked`) from level defaults, constants or the fallback.
 */
export function completeLightSettings(network: RoadNetwork, level: LevelData, settings: Record<string, LightSettings> = {}): Record<string, LightSettings> {
  const out: Record<string, LightSettings> = {};
  for (const info of network.intersections) {
    const s = settings[info.id] ?? level.defaultLightSettings[info.id] ?? fallbackLightSettings(info, level.constants.clearanceTime);
    const green: Record<string, number> = {};
    const amber: Record<string, number> = {};
    for (const g of info.lightGroups) {
      green[g.id] = s.green[g.id] ?? level.defaultLightSettings[info.id]?.green[g.id] ?? 10;
      amber[g.id] = s.amber?.[g.id] ?? level.defaultLightSettings[info.id]?.amber?.[g.id] ?? level.constants.clearanceTime;
    }
    out[info.id] = { green, amber, offset: s.offset ?? 0, linked: info.symmetric || (s.linked ?? true) };
  }
  return out;
}

/** Convenience for tests and (later) server-side verification of leaderboard runs. */
export function simulateLevel(level: LevelData, settings: Record<string, LightSettings>, maxTicks?: number): SimResult {
  return new Simulation(level, settings).run(maxTicks);
}
