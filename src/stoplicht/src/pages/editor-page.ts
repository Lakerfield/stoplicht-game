import { IRouter } from '@aurelia/router';
import { ProxyObservable } from '@aurelia/runtime';
import { resolve } from 'aurelia';
import { EditorStore } from '../services/editor-store';
import { LevelLoader, validateLevel, type LevelManifestEntry } from '../services/level-loader';
import {
  DEFAULT_CONSTANTS,
  DEFAULT_LIGHT_GROUPS,
  DEFAULT_VEHICLE_TYPES,
  LEVEL_FORMAT_VERSION,
  RoadNetwork,
  segmentAxis,
  segmentDirection,
  SIDE_DIR,
  vehicleKindOf,
  type GridPoint,
  type IntersectionDef,
  type LevelData,
  type LightParam,
  type RoadSegmentDef,
  type Side,
  type SpawnDef,
  type SpawnPointDef,
  type TileInfo,
} from '../sim';

export type EditorTool = 'road' | 'erase' | 'direction' | 'inspect';

/** SVG units per tile */
export const EDITOR_TILE = 40;

interface TileView {
  x: number;
  y: number;
  junction: boolean;
}

interface ArrowView {
  x: number;
  y: number;
  angle: number;
}

interface SpawnPointView {
  id: string;
  x: number;
  y: number;
  angle: number;
}

interface IntersectionView {
  id: string;
  x: number;
  y: number;
}

interface TimelineRow {
  id: string;
  y: number;
  items: { x: number; truck: boolean; spawn: SpawnDef }[];
}

const TIMELINE_LEFT = 40;
const TIMELINE_WIDTH = 940;
const TIMELINE_ROW = 24;
const DRAG_THRESHOLD_PX = 4;

const SIDE_ANGLE: Record<Side, number> = { E: 0, S: 90, W: 180, N: 270 };

export function newLevel(width = 13, height = 9): LevelData {
  return {
    formatVersion: LEVEL_FORMAT_VERSION,
    id: 'nieuw-level',
    name: 'Nieuw level',
    grid: { width, height },
    roads: [],
    intersections: [],
    spawnPoints: [],
    spawns: [],
    vehicleTypes: structuredClone(DEFAULT_VEHICLE_TYPES),
    constants: structuredClone(DEFAULT_CONSTANTS),
    targetTime: 60,
    collisionMode: 'mild',
    defaultLightSettings: {},
  };
}

/**
 * Hidden level editor (dev tool). Roads are drawn as segments; intersections and spawn points
 * are derived from the geometry and reconciled with the existing definitions to keep ids stable.
 */
export class EditorPage {
  private readonly store = resolve(EditorStore);
  private readonly loader = resolve(LevelLoader);
  private readonly router = resolve(IRouter);

  level: LevelData = withDefaultTypes(this.store.current ?? newLevel());
  tool: EditorTool = 'road';
  errors: string[] = [];
  selectedIntersectionId: string | null = null;
  svg?: SVGSVGElement;
  timelineSvg?: SVGSVGElement;
  standardLevels: LevelManifestEntry[] = [];
  standardLevelId = '';
  /** popup for starting a new (empty) level; replaces the current one */
  newLevelOpen = false;
  newGrid = { width: 13, height: 9 };
  importError: string | null = null;

  tiles: TileView[] = [];
  arrows: ArrowView[] = [];
  spawnPointViews: SpawnPointView[] = [];
  intersectionViews: IntersectionView[] = [];
  gridLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  drag: { start: GridPoint; end: GridPoint } | null = null;

  generator = { spawnPoint: '', vehicleType: 'car', start: 0, interval: 4, count: 5 };

  /** spawn point whose vehicle list is open in a popup */
  spawnPointDialog: string | null = null;
  /** single spawn being edited in a popup */
  editingSpawn: SpawnDef | null = null;
  private timelineDrag: { spawn: SpawnDef; startClientX: number; origTime: number; moved: boolean } | null = null;

  readonly tools: { id: EditorTool; label: string; icon: string }[] = [
    { id: 'road', label: 'editor.tool.road', icon: '🛣' },
    { id: 'erase', label: 'editor.tool.erase', icon: '⌫' },
    { id: 'direction', label: 'editor.tool.direction', icon: '↔' },
    { id: 'inspect', label: 'editor.tool.inspect', icon: '👆' },
  ];

  constructor() {
    this.rebuild();
  }

  async attached(): Promise<void> {
    this.applyViewBoxes();
    try {
      this.standardLevels = (await this.loader.getManifest()).levels;
    } catch {
      this.standardLevels = [];
    }
  }

  // ------------------------------------------------------------ derived views

  get viewBox(): string {
    return `0 0 ${this.level.grid.width * EDITOR_TILE} ${this.level.grid.height * EDITOR_TILE}`;
  }

  get tile(): number {
    return EDITOR_TILE;
  }

  get dragPreview(): { x: number; y: number; w: number; h: number } | null {
    if (!this.drag) return null;
    const [ax, ay] = this.drag.start;
    const [bx, by] = this.drag.end;
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    return { x: x * EDITOR_TILE, y: y * EDITOR_TILE, w: (Math.abs(bx - ax) + 1) * EDITOR_TILE, h: (Math.abs(by - ay) + 1) * EDITOR_TILE };
  }

  get vehicleTypeIds(): string[] {
    return Object.keys(this.level.vehicleTypes);
  }

  get lightParams(): LightParam[] {
    return ['green', 'offset'];
  }

  get invalidSpawnCount(): number {
    const ids = new Set(this.level.spawnPoints.map(p => p.id));
    return this.level.spawns.filter(s => !ids.has(s.spawnPoint) || !this.level.vehicleTypes[s.vehicleType]).length;
  }

  get timelineMax(): number {
    const last = this.level.spawns.reduce((m, s) => Math.max(m, s.time), 0);
    return Math.max(10, Math.ceil((last + 5) / 10) * 10);
  }

  get timelineRows(): TimelineRow[] {
    return this.level.spawnPoints.map((p, row) => ({
      id: p.id,
      y: 16 + row * TIMELINE_ROW,
      items: this.level.spawns
        .filter(s => s.spawnPoint === p.id)
        .map(s => ({ x: this.timeToX(s.time), truck: this.isTruckType(s.vehicleType), spawn: s })),
    }));
  }

  get timelineHeight(): number {
    return 30 + this.level.spawnPoints.length * TIMELINE_ROW;
  }

  get timelineTicks(): { x: number; label: number }[] {
    const max = this.timelineMax;
    const step = max <= 60 ? 10 : 20;
    const out: { x: number; label: number }[] = [];
    for (let t = 0; t <= max; t += step) out.push({ x: this.timeToX(t), label: t });
    return out;
  }

  get rowHeight(): number {
    return TIMELINE_ROW;
  }

  /** spawns of the point shown in the popup, in time order */
  get dialogSpawns(): SpawnDef[] {
    return this.level.spawns.filter(s => s.spawnPoint === this.spawnPointDialog).sort((a, b) => a.time - b.time);
  }

  get dialogSpawnPoint(): SpawnPointDef | undefined {
    return this.level.spawnPoints.find(p => p.id === this.spawnPointDialog);
  }

  spawnCount(pointId: string): number {
    return this.level.spawns.filter(s => s.spawnPoint === pointId).length;
  }

  /** long vehicles get bigger dots on the timeline and are what shift-click adds */
  isTruckType(typeId: string): boolean {
    const t = this.level.vehicleTypes[typeId];
    if (!t) return false;
    const kind = vehicleKindOf(t);
    return kind === 'truck' || kind === 'bus';
  }

  private timeToX(time: number): number {
    return TIMELINE_LEFT + (time / this.timelineMax) * TIMELINE_WIDTH;
  }

  /** Intersections that are locked/unlocked etc. are level-wide; the selection only scrolls the list. */
  get selectedIntersection(): IntersectionDef | undefined {
    return this.level.intersections?.find(i => i.id === this.selectedIntersectionId);
  }

  // ------------------------------------------------------------ pointer input on the canvas

  onPointerDown(event: PointerEvent): void {
    const tile = this.tileFromEvent(event);
    if (!tile) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    if (this.tool === 'road') {
      this.drag = { start: tile, end: tile };
    } else if (this.tool === 'erase') {
      this.eraseAt(tile);
    } else if (this.tool === 'direction') {
      this.cycleDirection(tile);
    } else {
      this.inspect(tile);
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.drag) return;
    const tile = this.tileFromEvent(event);
    if (!tile) return;
    this.drag = { start: this.drag.start, end: this.constrain(this.drag.start, tile) };
  }

  onPointerUp(): void {
    if (!this.drag) return;
    const { start, end } = this.drag;
    this.drag = null;
    if (start[0] === end[0] && start[1] === end[1]) return;
    this.addSegment(start, end);
  }

  /** Maps a pointer position to a grid tile via the SVG's own screen transform (robust to centring/scaling). */
  private tileFromEvent(event: PointerEvent): GridPoint | null {
    const ctm = this.svg?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const x = Math.floor(p.x / EDITOR_TILE);
    const y = Math.floor(p.y / EDITOR_TILE);
    return [clamp(x, 0, this.level.grid.width - 1), clamp(y, 0, this.level.grid.height - 1)];
  }

  private constrain(start: GridPoint, end: GridPoint): GridPoint {
    const dx = Math.abs(end[0] - start[0]);
    const dy = Math.abs(end[1] - start[1]);
    return dx >= dy ? [end[0], start[1]] : [start[0], end[1]];
  }

  // ------------------------------------------------------------ road editing

  /** Adds a two-way segment, merging it with collinear segments it overlaps or touches. */
  addSegment(a: GridPoint, b: GridPoint): void {
    const horizontal = a[1] === b[1];
    const line = horizontal ? a[1] : a[0];
    let lo = Math.min(horizontal ? a[0] : a[1], horizontal ? b[0] : b[1]);
    let hi = Math.max(horizontal ? a[0] : a[1], horizontal ? b[0] : b[1]);
    const keep: RoadSegmentDef[] = [];
    for (const seg of this.level.roads) {
      const segHorizontal = segmentAxis(seg) === 'h';
      const segLine = segHorizontal ? seg.from[1] : seg.from[0];
      if (segHorizontal !== horizontal || segLine !== line) {
        keep.push(seg);
        continue;
      }
      const s0 = Math.min(segHorizontal ? seg.from[0] : seg.from[1], segHorizontal ? seg.to[0] : seg.to[1]);
      const s1 = Math.max(segHorizontal ? seg.from[0] : seg.from[1], segHorizontal ? seg.to[0] : seg.to[1]);
      if (s1 < lo - 1 || s0 > hi + 1) {
        keep.push(seg);
        continue;
      }
      lo = Math.min(lo, s0);
      hi = Math.max(hi, s1);
    }
    keep.push({
      id: this.nextRoadId(keep),
      from: horizontal ? [lo, line] : [line, lo],
      to: horizontal ? [hi, line] : [line, hi],
    });
    this.level.roads = keep;
    this.rebuild();
  }

  eraseAt([x, y]: GridPoint): void {
    const out: RoadSegmentDef[] = [];
    const usedIds = new Set(this.level.roads.map(r => r.id));
    const freshId = (): string => {
      for (let n = 1; ; n++) {
        if (!usedIds.has(`r${n}`)) {
          usedIds.add(`r${n}`);
          return `r${n}`;
        }
      }
    };
    let changed = false;
    for (const seg of this.level.roads) {
      if (!covers(seg, x, y)) {
        out.push(seg);
        continue;
      }
      changed = true;
      const horizontal = segmentAxis(seg) === 'h';
      const pos = horizontal ? x : y;
      const f = horizontal ? seg.from[0] : seg.from[1];
      const t = horizontal ? seg.to[0] : seg.to[1];
      const dir = Math.sign(t - f);
      const make = (v: number): GridPoint => (horizontal ? [v, seg.from[1]] : [seg.from[0], v]);
      // parts before and after the erased tile, keeping the from -> to orientation; drop single-tile leftovers
      const parts: [number, number][] = [
        [f, pos - dir],
        [pos + dir, t],
      ];
      let first = true;
      for (const [a, b] of parts) {
        if ((b - a) * dir < 1) continue;
        out.push({ ...seg, id: first ? seg.id : freshId(), from: make(a), to: make(b) });
        first = false;
      }
    }
    if (changed) {
      this.level.roads = out;
      this.rebuild();
    }
  }

  /** two-way -> one-way (from→to) -> one-way reversed -> two-way */
  cycleDirection([x, y]: GridPoint): void {
    const seg = this.level.roads.find(s => covers(s, x, y));
    if (!seg) return;
    if (!seg.oneWay) {
      seg.oneWay = true;
    } else if (!seg.reversedOnce) {
      const from = seg.from;
      seg.from = seg.to;
      seg.to = from;
      seg.reversedOnce = true;
    } else {
      delete seg.oneWay;
      delete seg.reversedOnce;
    }
    this.rebuild();
  }

  private inspect([x, y]: GridPoint): void {
    const point = this.level.spawnPoints.find(p => p.at[0] === x && p.at[1] === y);
    if (point) {
      this.openSpawnPoint(point.id);
      return;
    }
    const hit = this.level.intersections?.find(i => i.at[0] === x && i.at[1] === y);
    this.selectedIntersectionId = hit?.id ?? null;
  }

  private nextRoadId(existing: RoadSegmentDef[]): string {
    const ids = new Set(existing.map(r => r.id));
    for (let n = 1; ; n++) if (!ids.has(`r${n}`)) return `r${n}`;
  }

  // ------------------------------------------------------------ derive intersections & spawn points

  /** Re-derives intersections, spawn points and views from the road geometry; keeps ids where possible. */
  rebuild(): void {
    const errors: string[] = [];
    let probe: RoadNetwork;
    try {
      probe = new RoadNetwork({ ...this.level, intersections: [], spawnPoints: [] });
    } catch (e) {
      this.errors = [e instanceof Error ? e.message : String(e)];
      return;
    }

    // intersections
    const oldDefs = this.level.intersections ?? [];
    const defs: IntersectionDef[] = [];
    for (const info of probe.intersections) {
      const existing = oldDefs.find(d => d.at[0] === info.x && d.at[1] === info.y);
      defs.push(existing ?? { id: nextLetterId([...oldDefs, ...defs].map(d => d.id)), at: [info.x, info.y], lightGroups: structuredClone(DEFAULT_LIGHT_GROUPS) });
    }
    this.level.intersections = defs;
    const defaults: LevelData['defaultLightSettings'] = {};
    for (const d of defs) {
      const green: Record<string, number> = {};
      for (const g of d.lightGroups ?? DEFAULT_LIGHT_GROUPS) green[g.id] = this.level.defaultLightSettings[d.id]?.green[g.id] ?? 10;
      defaults[d.id] = { green, offset: this.level.defaultLightSettings[d.id]?.offset ?? 0 };
    }
    this.level.defaultLightSettings = defaults;
    if (this.selectedIntersectionId && !defs.some(d => d.id === this.selectedIntersectionId)) this.selectedIntersectionId = null;

    // spawn points: road ends on the map edge where traffic may enter
    const oldPoints = this.level.spawnPoints;
    const points: SpawnPointDef[] = [];
    const spawnViews: SpawnPointView[] = [];
    const sortedTiles = [...probe.tiles.values()].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const tile of sortedTiles) {
      if (!probe.isEdge(tile.x, tile.y) || tile.neighbors.length !== 1) continue;
      const heading = tile.neighbors[0];
      const seg = probe.segmentForStep(tile, heading)!;
      if (!probe.stepAllowed(seg, heading)) continue;
      const existing = oldPoints.find(p => p.at[0] === tile.x && p.at[1] === tile.y);
      const def = existing ?? { id: nextId('', [...oldPoints, ...points].map(p => p.id)), at: [tile.x, tile.y] as GridPoint };
      points.push(def);
      spawnViews.push({ id: def.id, x: (tile.x + 0.5) * EDITOR_TILE, y: (tile.y + 0.5) * EDITOR_TILE, angle: SIDE_ANGLE[heading] });
      try {
        probe.buildRoutePath(def.at, def.route);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    this.level.spawnPoints = points;
    this.spawnPointViews = spawnViews;
    if (!points.some(p => p.id === this.generator.spawnPoint)) this.generator.spawnPoint = points[0]?.id ?? '';

    // views
    this.tiles = sortedTiles.map(t => ({ x: t.x, y: t.y, junction: t.neighbors.length >= 3 }));
    this.arrows = this.buildArrows(probe);
    this.intersectionViews = defs.map(d => ({ id: d.id, x: (d.at[0] + 0.5) * EDITOR_TILE, y: (d.at[1] + 0.5) * EDITOR_TILE }));
    this.gridLines = [];
    for (let x = 0; x <= this.level.grid.width; x++) this.gridLines.push({ x1: x * EDITOR_TILE, y1: 0, x2: x * EDITOR_TILE, y2: this.level.grid.height * EDITOR_TILE });
    for (let y = 0; y <= this.level.grid.height; y++) this.gridLines.push({ x1: 0, y1: y * EDITOR_TILE, x2: this.level.grid.width * EDITOR_TILE, y2: y * EDITOR_TILE });

    const ids = new Set(points.map(p => p.id));
    for (const s of this.level.spawns) {
      if (!ids.has(s.spawnPoint)) errors.push(`Spawn op t=${s.time} verwijst naar onbekend spawnpunt ${s.spawnPoint}`);
    }
    if (points.length === 0) errors.push('Geen spawnpunten: teken een weg tot aan de rand van de map.');
    this.errors = [...new Set(errors)];
    this.save();
    this.applyViewBoxes();
  }

  /** `viewBox` is case-sensitive and HTML templates lowercase attribute names, so set it imperatively. */
  private applyViewBoxes(): void {
    this.svg?.setAttribute('viewBox', this.viewBox);
    this.timelineSvg?.setAttribute('viewBox', `0 0 1000 ${this.timelineHeight}`);
  }

  private buildArrows(probe: RoadNetwork): ArrowView[] {
    const out: ArrowView[] = [];
    for (const seg of this.level.roads) {
      if (!seg.oneWay) continue;
      const side = segmentDirection(seg);
      const d = SIDE_DIR[side];
      let x = seg.from[0];
      let y = seg.from[1];
      for (;;) {
        const tile: TileInfo | undefined = probe.tileAt(x, y);
        if (tile && tile.neighbors.length < 3) out.push({ x: (x + 0.5) * EDITOR_TILE, y: (y + 0.5) * EDITOR_TILE, angle: SIDE_ANGLE[side] });
        if (x === seg.to[0] && y === seg.to[1]) break;
        x += d.x;
        y += d.y;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ level fields

  changed(): void {
    this.save();
  }

  resizeGrid(): void {
    const w = clamp(Math.round(this.level.grid.width), 3, 40);
    const h = clamp(Math.round(this.level.grid.height), 3, 40);
    this.level.grid = { width: w, height: h };
    this.level.roads = this.level.roads
      .map(seg => ({
        ...seg,
        from: [clamp(seg.from[0], 0, w - 1), clamp(seg.from[1], 0, h - 1)] as GridPoint,
        to: [clamp(seg.to[0], 0, w - 1), clamp(seg.to[1], 0, h - 1)] as GridPoint,
      }))
      .filter(seg => seg.from[0] !== seg.to[0] || seg.from[1] !== seg.to[1]);
    this.rebuild();
  }

  toggleLocked(param: LightParam): void {
    const locked = new Set(this.level.constants.lockedParams ?? []);
    if (locked.has(param)) locked.delete(param);
    else locked.add(param);
    this.level.constants.lockedParams = [...locked];
    if (this.level.constants.lockedParams.length === 0) delete this.level.constants.lockedParams;
    this.save();
  }

  isLocked(param: LightParam): boolean {
    return this.level.constants.lockedParams?.includes(param) ?? false;
  }

  // ------------------------------------------------------------ spawns

  addGenerated(): void {
    const g = this.generator;
    if (!g.spawnPoint || !this.level.vehicleTypes[g.vehicleType]) return;
    const spawns: SpawnDef[] = [];
    for (let i = 0; i < clamp(Math.round(g.count), 1, 200); i++) {
      spawns.push({ time: round1(g.start + i * Math.max(0.1, g.interval)), spawnPoint: g.spawnPoint, vehicleType: g.vehicleType });
    }
    this.level.spawns = [...this.level.spawns, ...spawns];
    this.sortSpawns();
  }

  addSingleSpawn(): void {
    const g = this.generator;
    if (!g.spawnPoint) return;
    this.level.spawns = [...this.level.spawns, { time: round1(g.start), spawnPoint: g.spawnPoint, vehicleType: g.vehicleType }];
    this.sortSpawns();
  }

  clearSpawns(): void {
    this.level.spawns = [];
    this.save();
  }

  pruneInvalidSpawns(): void {
    const ids = new Set(this.level.spawnPoints.map(p => p.id));
    this.level.spawns = this.level.spawns.filter(s => ids.has(s.spawnPoint) && this.level.vehicleTypes[s.vehicleType]);
    this.rebuild();
  }

  sortSpawns(): void {
    this.level.spawns = [...this.level.spawns].sort((a, b) => a.time - b.time || a.spawnPoint.localeCompare(b.spawnPoint));
    this.save();
  }

  // ------------------------------------------------------------ popups

  openSpawnPoint(id: string, event?: Event): void {
    event?.stopPropagation();
    this.generator.spawnPoint = id;
    this.spawnPointDialog = id;
    this.editingSpawn = null;
  }

  openSpawn(spawn: SpawnDef): void {
    this.editingSpawn = raw(spawn);
  }

  closeDialogs(): void {
    this.spawnPointDialog = null;
    this.editingSpawn = null;
  }

  deleteEditingSpawn(): void {
    if (!this.editingSpawn) return;
    this.level.spawns = this.level.spawns.filter(s => s !== this.editingSpawn);
    this.editingSpawn = null;
    this.rebuild();
  }

  removeSpawnObject(spawn: SpawnDef): void {
    const target = raw(spawn);
    this.level.spawns = this.level.spawns.filter(s => s !== target);
    this.save();
  }

  clearSpawnsFor(pointId: string): void {
    this.level.spawns = this.level.spawns.filter(s => s.spawnPoint !== pointId);
    this.save();
  }

  // ------------------------------------------------------------ timeline interaction

  /** Click on an empty spot in a row adds a car at that time (0.5 s grid); shift adds a truck. */
  onTimelineRowDown(row: TimelineRow, event: PointerEvent): void {
    if (this.timelineDrag) return;
    const t = Math.max(0, Math.round(this.timeFromClientX(event.clientX) * 2) / 2);
    const truck = this.vehicleTypeIds.find(id => this.isTruckType(id));
    const car = this.vehicleTypeIds.find(id => !this.isTruckType(id)) ?? this.vehicleTypeIds[0];
    const vehicleType = event.shiftKey && truck ? truck : car;
    if (!vehicleType) return;
    this.level.spawns = [...this.level.spawns, { time: t, spawnPoint: row.id, vehicleType }];
    this.sortSpawns();
  }

  onDotDown(spawn: SpawnDef, event: PointerEvent): void {
    event.stopPropagation();
    this.timelineSvg?.setPointerCapture(event.pointerId);
    this.timelineDrag = { spawn: raw(spawn), startClientX: event.clientX, origTime: spawn.time, moved: false };
  }

  onTimelineMove(event: PointerEvent): void {
    const drag = this.timelineDrag;
    if (!drag) return;
    if (Math.abs(event.clientX - drag.startClientX) > DRAG_THRESHOLD_PX) drag.moved = true;
    if (!drag.moved) return;
    const dt = this.timeFromClientX(event.clientX) - this.timeFromClientX(drag.startClientX);
    drag.spawn.time = round1(Math.max(0, drag.origTime + dt));
  }

  onTimelineUp(): void {
    const drag = this.timelineDrag;
    if (!drag) return;
    this.timelineDrag = null;
    if (drag.moved) this.sortSpawns();
    else this.openSpawn(drag.spawn);
  }

  private timeFromClientX(clientX: number): number {
    const ctm = this.timelineSvg?.getScreenCTM();
    if (!ctm) return 0;
    const x = new DOMPoint(clientX, 0).matrixTransform(ctm.inverse()).x;
    return ((x - TIMELINE_LEFT) / TIMELINE_WIDTH) * this.timelineMax;
  }

  // ------------------------------------------------------------ actions

  test(): void {
    this.save();
    void this.router.load('play/editor');
  }

  backToMenu(): void {
    void this.router.load('');
  }

  exportJson(): void {
    const blob = new Blob([JSON.stringify(this.exportLevel(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.level.id || 'level'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async importJson(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const level = validateLevel(JSON.parse(await file.text()) as LevelData);
      this.level = withDefaultTypes(level);
      this.importError = null;
      this.rebuild();
    } catch (e) {
      this.importError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Copies a standard level into the editor under a new id/name so the original stays untouched. */
  async cloneStandard(): Promise<void> {
    if (!this.standardLevelId) return;
    try {
      this.level = withDefaultTypes(cloneLevel(await this.loader.load(this.standardLevelId)));
      this.importError = null;
      this.rebuild();
    } catch (e) {
      this.importError = e instanceof Error ? e.message : String(e);
    }
  }

  askNewLevel(): void {
    this.newGrid = { width: this.level.grid.width, height: this.level.grid.height };
    this.newLevelOpen = true;
  }

  cancelNewLevel(): void {
    this.newLevelOpen = false;
  }

  /** Replaces the whole level by an empty one of the chosen size (after confirmation). */
  createNewLevel(): void {
    this.newLevelOpen = false;
    this.closeDialogs();
    const w = clamp(Math.round(this.newGrid.width) || 13, 3, 40);
    const h = clamp(Math.round(this.newGrid.height) || 9, 3, 40);
    this.level = withDefaultTypes(newLevel(w, h));
    this.selectedIntersectionId = null;
    this.rebuild();
  }

  private exportLevel(): LevelData {
    const level = structuredClone(this.level);
    for (const seg of level.roads) delete seg.reversedOnce;
    return level;
  }

  private save(): void {
    this.store.save(this.level);
    this.timelineSvg?.setAttribute('viewBox', `0 0 1000 ${this.timelineHeight}`);
  }
}

/**
 * Objects read inside observed getters are Aurelia proxies; unwrap before identity comparisons
 * against the raw objects in level.spawns.
 */
function raw<T extends object>(value: T): T {
  return ProxyObservable.getRaw(value);
}

function covers(seg: RoadSegmentDef, x: number, y: number): boolean {
  const [x0, y0] = seg.from;
  const [x1, y1] = seg.to;
  return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1);
}

function nextId(prefix: string, used: string[]): string {
  const set = new Set(used);
  for (let n = 1; ; n++) if (!set.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** A, B, ... Z, AA, AB, ... — first one not in use. */
function nextLetterId(used: string[]): string {
  const set = new Set(used);
  for (let i = 0; ; i++) {
    let n = i + 1;
    let out = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      out = String.fromCharCode(65 + r) + out;
      n = Math.floor((n - 1) / 26);
    }
    if (!set.has(out)) return out;
  }
}

/** Deep copy with a fresh id and "(kopie)" name, so saving/exporting never masquerades as the original. */
export function cloneLevel(level: LevelData): LevelData {
  const copy = structuredClone(level);
  copy.id = `${level.id}-kopie`;
  copy.name = `${level.name} (kopie)`;
  return copy;
}

/** The editor always offers every default vehicle type, also for levels that only use a few. */
function withDefaultTypes(level: LevelData): LevelData {
  for (const [id, def] of Object.entries(DEFAULT_VEHICLE_TYPES)) {
    level.vehicleTypes[id] ??= structuredClone(def);
  }
  return level;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
