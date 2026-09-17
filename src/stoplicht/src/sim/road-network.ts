import { DEFAULT_LIGHT_GROUPS, LANE_OFFSET_TWO_WAY, STOP_LINE_OFFSET, TILE_SIZE } from './defaults';
import { add, equals, Polyline, quadraticBezier, rightOf, scale, vec, type Vec2 } from './geometry';
import type { GridPoint, IntersectionDef, LevelData, LightGroupDef, RoadSegmentDef, Side } from './level-schema';

export const SIDES: Side[] = ['N', 'E', 'S', 'W'];

export const SIDE_DIR: Record<Side, Vec2> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

export const OPPOSITE: Record<Side, Side> = { N: 'S', E: 'W', S: 'N', W: 'E' };

export function dirToSide(dx: number, dy: number): Side {
  if (dx > 0) return 'E';
  if (dx < 0) return 'W';
  if (dy > 0) return 'S';
  return 'N';
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function pointKey(p: GridPoint): string {
  return tileKey(p[0], p[1]);
}

export interface TileInfo {
  x: number;
  y: number;
  /** segments covering this tile */
  segments: RoadSegmentDef[];
  /** sides on which a connected road tile exists */
  neighbors: Side[];
}

export interface IntersectionInfo {
  id: string;
  x: number;
  y: number;
  /** centre in meters */
  center: Vec2;
  lightGroups: LightGroupDef[];
  approachToGroup: Record<Side, string | undefined>;
}

/** Where a route crosses an intersection, in path distance (m). */
export interface PathIntersection {
  intersectionId: string;
  intersectionIndex: number;
  approach: Side;
  /** front bumper position when waiting */
  sStop: number;
  /** entering / leaving the intersection tile */
  sEnter: number;
  sExit: number;
}

export interface RoutePath {
  polyline: Polyline;
  tiles: GridPoint[];
  intersections: PathIntersection[];
}

export interface SpawnPointInfo {
  id: string;
  x: number;
  y: number;
  /** direction of travel when entering the map */
  heading: Side;
  path: RoutePath;
}

const BEND_SUBDIVISIONS = 8;

/**
 * Derives the tile graph, intersections and lane paths from the level's road segments.
 * Throws with a descriptive message on invalid level data; the editor surfaces these to the author.
 */
export class RoadNetwork {
  readonly tiles = new Map<string, TileInfo>();
  readonly intersections: IntersectionInfo[] = [];
  readonly intersectionByKey = new Map<string, IntersectionInfo>();
  readonly intersectionById = new Map<string, IntersectionInfo>();
  readonly spawnPoints: SpawnPointInfo[] = [];
  readonly spawnPointById = new Map<string, SpawnPointInfo>();
  readonly width: number;
  readonly height: number;

  constructor(readonly level: LevelData) {
    this.width = level.grid.width;
    this.height = level.grid.height;
    this.buildTiles();
    this.buildIntersections();
    this.buildSpawnPoints();
  }

  tileAt(x: number, y: number): TileInfo | undefined {
    return this.tiles.get(tileKey(x, y));
  }

  isEdge(x: number, y: number): boolean {
    return x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;
  }

  tileCenter(x: number, y: number): Vec2 {
    return vec((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE);
  }

  private buildTiles(): void {
    for (const seg of this.level.roads) {
      const [x0, y0] = seg.from;
      const [x1, y1] = seg.to;
      if (x0 !== x1 && y0 !== y1) throw new Error(`Road ${seg.id} is not axis-aligned`);
      if (x0 === x1 && y0 === y1) throw new Error(`Road ${seg.id} has zero length`);
      const dx = Math.sign(x1 - x0);
      const dy = Math.sign(y1 - y0);
      let x = x0;
      let y = y0;
      for (;;) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
          throw new Error(`Road ${seg.id} leaves the grid at ${x},${y}`);
        }
        const key = tileKey(x, y);
        let tile = this.tiles.get(key);
        if (!tile) {
          tile = { x, y, segments: [], neighbors: [] };
          this.tiles.set(key, tile);
        }
        for (const other of tile.segments) {
          if (segmentAxis(other) === segmentAxis(seg)) {
            throw new Error(`Roads ${other.id} and ${seg.id} overlap at ${x},${y}`);
          }
        }
        tile.segments.push(seg);
        if (x === x1 && y === y1) break;
        x += dx;
        y += dy;
      }
    }
    for (const tile of this.tiles.values()) {
      for (const side of SIDES) {
        if (this.segmentForStep(tile, side)) tile.neighbors.push(side);
      }
    }
  }

  /** Segment that connects `tile` to its neighbour on `side`, if any. */
  segmentForStep(tile: TileInfo, side: Side): RoadSegmentDef | undefined {
    const d = SIDE_DIR[side];
    const nx = tile.x + d.x;
    const ny = tile.y + d.y;
    const neighbor = this.tileAt(nx, ny);
    if (!neighbor) return undefined;
    const axis = side === 'E' || side === 'W' ? 'h' : 'v';
    return tile.segments.find(s => segmentAxis(s) === axis && neighbor.segments.includes(s));
  }

  /** May traffic travel from `tile` towards `side` over this segment? */
  stepAllowed(seg: RoadSegmentDef, side: Side): boolean {
    if (!seg.oneWay) return true;
    return segmentDirection(seg) === side;
  }

  private buildIntersections(): void {
    const defs = new Map<string, IntersectionDef>();
    for (const def of this.level.intersections ?? []) defs.set(pointKey(def.at), def);

    // Deterministic order: explicit definitions first (data order), then derived ones row-major.
    const ordered: TileInfo[] = [];
    for (const def of this.level.intersections ?? []) {
      const tile = this.tileAt(def.at[0], def.at[1]);
      if (!tile) throw new Error(`Intersection ${def.id} is not on a road`);
      if (tile.neighbors.length < 3) throw new Error(`Intersection ${def.id} at ${def.at} is not a junction`);
      ordered.push(tile);
    }
    const derived = [...this.tiles.values()]
      .filter(t => t.neighbors.length >= 3 && !defs.has(tileKey(t.x, t.y)))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    ordered.push(...derived);

    for (const tile of ordered) {
      const key = tileKey(tile.x, tile.y);
      const def = defs.get(key);
      const id = def?.id ?? `x${tile.x}y${tile.y}`;
      const groups = (def?.lightGroups ?? DEFAULT_LIGHT_GROUPS)
        .map(g => ({ id: g.id, approaches: g.approaches.filter(a => tile.neighbors.includes(a)) }))
        .filter(g => g.approaches.length > 0);
      const approachToGroup: Record<Side, string | undefined> = { N: undefined, E: undefined, S: undefined, W: undefined };
      for (const g of groups) for (const a of g.approaches) approachToGroup[a] = g.id;
      const info: IntersectionInfo = { id, x: tile.x, y: tile.y, center: this.tileCenter(tile.x, tile.y), lightGroups: groups, approachToGroup };
      this.intersections.push(info);
      this.intersectionByKey.set(key, info);
      if (this.intersectionById.has(id)) throw new Error(`Duplicate intersection id ${id}`);
      this.intersectionById.set(id, info);
    }
  }

  private buildSpawnPoints(): void {
    for (const def of this.level.spawnPoints) {
      const [x, y] = def.at;
      const tile = this.tileAt(x, y);
      if (!tile) throw new Error(`Spawn point ${def.id} is not on a road`);
      if (!this.isEdge(x, y)) throw new Error(`Spawn point ${def.id} is not on the map edge`);
      if (tile.neighbors.length !== 1) throw new Error(`Spawn point ${def.id} must be at a road end`);
      const heading = tile.neighbors[0];
      const seg = this.segmentForStep(tile, heading)!;
      if (!this.stepAllowed(seg, heading)) throw new Error(`Spawn point ${def.id} faces against a one-way road`);
      const path = this.buildRoutePath(def.at, def.route);
      const info: SpawnPointInfo = { id: def.id, x, y, heading, path };
      this.spawnPoints.push(info);
      if (this.spawnPointById.has(def.id)) throw new Error(`Duplicate spawn point id ${def.id}`);
      this.spawnPointById.set(def.id, info);
    }
  }

  /** Straight-ahead route: follow bends, go straight at intersections, stop at the map edge. */
  defaultTileRoute(start: GridPoint): GridPoint[] {
    const tiles: GridPoint[] = [start];
    const startTile = this.tileAt(start[0], start[1]);
    if (!startTile) throw new Error(`No road at ${start}`);
    if (startTile.neighbors.length !== 1) throw new Error(`Route start ${start} must be a road end`);
    let tile: TileInfo = startTile;
    let heading: Side = tile.neighbors[0];
    const maxSteps = this.width * this.height + 1;
    for (let i = 0; i < maxSteps; i++) {
      let next: Side | undefined;
      if (tile.neighbors.includes(heading)) {
        next = heading;
      } else if (tile.neighbors.length === 2) {
        next = tile.neighbors.find(n => n !== OPPOSITE[heading]);
      }
      if (!next) {
        if (this.isEdge(tile.x, tile.y) && tile.neighbors.length === 1) return tiles;
        throw new Error(`Route from ${start} cannot continue straight at ${tile.x},${tile.y}`);
      }
      const seg = this.segmentForStep(tile, next)!;
      if (!this.stepAllowed(seg, next)) throw new Error(`Route from ${start} drives against one-way road ${seg.id}`);
      const d: Vec2 = SIDE_DIR[next];
      const nextTile = this.tileAt(tile.x + d.x, tile.y + d.y);
      if (!nextTile) throw new Error(`Route from ${start} leaves the road at ${tile.x},${tile.y}`);
      tile = nextTile;
      tiles.push([tile.x, tile.y]);
      heading = next;
    }
    throw new Error(`Route from ${start} does not terminate`);
  }

  /** Expands waypoints into the full list of tiles, validating connectivity and one-way directions. */
  expandWaypoints(start: GridPoint, waypoints: GridPoint[]): GridPoint[] {
    const tiles: GridPoint[] = [start];
    let cur = start;
    for (const wp of waypoints) {
      const dx = Math.sign(wp[0] - cur[0]);
      const dy = Math.sign(wp[1] - cur[1]);
      if (dx !== 0 && dy !== 0) throw new Error(`Waypoint ${wp} is not axis-aligned with ${cur}`);
      if (dx === 0 && dy === 0) continue;
      const side = dirToSide(dx, dy);
      while (cur[0] !== wp[0] || cur[1] !== wp[1]) {
        const tile = this.tileAt(cur[0], cur[1]);
        if (!tile) throw new Error(`No road at ${cur}`);
        const seg = this.segmentForStep(tile, side);
        if (!seg) throw new Error(`No road from ${cur} towards ${side}`);
        if (!this.stepAllowed(seg, side)) throw new Error(`Route drives against one-way road ${seg.id} at ${cur}`);
        cur = [cur[0] + dx, cur[1] + dy];
        tiles.push(cur);
      }
    }
    return tiles;
  }

  buildRoutePath(start: GridPoint, waypoints?: GridPoint[]): RoutePath {
    const tiles = waypoints && waypoints.length > 0 ? this.expandWaypoints(start, waypoints) : this.defaultTileRoute(start);
    if (tiles.length < 2) throw new Error(`Route from ${start} is too short`);
    const last = tiles[tiles.length - 1];
    if (!this.isEdge(last[0], last[1])) throw new Error(`Route from ${start} must end on the map edge (ends at ${last})`);

    const points: Vec2[] = [];
    const markers: { tileIndex: number; enterPointIndex: number; exitPointIndex: number; approach: Side }[] = [];

    const stepSide = (i: number): Side => dirToSide(tiles[i + 1][0] - tiles[i][0], tiles[i + 1][1] - tiles[i][1]);
    const laneOffset = (i: number, side: Side): number => {
      const tile = this.tileAt(tiles[i][0], tiles[i][1])!;
      const seg = this.segmentForStep(tile, side)!;
      return seg.oneWay ? 0 : LANE_OFFSET_TWO_WAY;
    };

    for (let i = 0; i < tiles.length; i++) {
      const [x, y] = tiles[i];
      const entrySide: Side = i === 0 ? stepSide(0) : stepSide(i - 1);
      const exitSide: Side = i === tiles.length - 1 ? entrySide : stepSide(i);
      const entryOffset = i === 0 ? laneOffset(0, entrySide) : laneOffset(i - 1, entrySide);
      const exitOffset = i === tiles.length - 1 ? entryOffset : laneOffset(i, exitSide);
      if (exitSide === OPPOSITE[entrySide]) throw new Error(`U-turn in route at ${x},${y}`);

      const center = this.tileCenter(x, y);
      const entryDir = SIDE_DIR[entrySide];
      const exitDir = SIDE_DIR[exitSide];
      const entry = add(add(center, scale(entryDir, -TILE_SIZE / 2)), scale(rightOf(entryDir), entryOffset));
      const exit = add(add(center, scale(exitDir, TILE_SIZE / 2)), scale(rightOf(exitDir), exitOffset));

      let tilePoints: Vec2[];
      if (entrySide === exitSide) {
        tilePoints = [entry, exit];
      } else {
        const control = vec(entryDir.x !== 0 ? exit.x : entry.x, entryDir.y !== 0 ? exit.y : entry.y);
        tilePoints = quadraticBezier(entry, control, exit, BEND_SUBDIVISIONS);
      }

      const enterPointIndex = points.length > 0 && equals(points[points.length - 1], tilePoints[0]) ? points.length - 1 : points.length;
      for (const p of tilePoints) {
        if (points.length > 0 && equals(points[points.length - 1], p)) continue;
        points.push(p);
      }
      if (this.intersectionByKey.has(tileKey(x, y))) {
        markers.push({ tileIndex: i, enterPointIndex, exitPointIndex: points.length - 1, approach: OPPOSITE[entrySide] });
      }
    }

    const polyline = new Polyline(points);
    const intersections: PathIntersection[] = markers.map(m => {
      const info = this.intersectionByKey.get(pointKey(tiles[m.tileIndex]))!;
      const sEnter = polyline.cumulative[m.enterPointIndex];
      return {
        intersectionId: info.id,
        intersectionIndex: this.intersections.indexOf(info),
        approach: m.approach,
        sStop: sEnter - STOP_LINE_OFFSET,
        sEnter,
        sExit: polyline.cumulative[m.exitPointIndex],
      };
    });
    return { polyline, tiles, intersections };
  }
}

export function segmentAxis(seg: RoadSegmentDef): 'h' | 'v' {
  return seg.from[1] === seg.to[1] ? 'h' : 'v';
}

/** Travel direction of a one-way segment (from -> to). */
export function segmentDirection(seg: RoadSegmentDef): Side {
  return dirToSide(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]);
}
