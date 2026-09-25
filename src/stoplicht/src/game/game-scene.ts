import Phaser from 'phaser';
import type { GameSession } from '../services/game-session';
import { PreferencesStore } from '../services/preferences-store';
import { OPPOSITE, rightOf, SIDE_DIR, SIDES, TILE_SIZE, vehicleKindOf, type IntersectionInfo, type LightColor, type TileInfo, type Vehicle } from '../sim';
import { THEME } from './theme';

/** render scale: pixels per metre (1 tile = 8 m = 64 px at zoom 1) */
export const PX_PER_M = 8;
const TILE_PX = TILE_SIZE * PX_PER_M;
/** pointer movement below this (screen px) counts as a tap, above as a drag */
const DRAG_THRESHOLD = 10;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM = 3;
/** frame rate while nothing moves (before the start, paused, finished, crashed) */
const IDLE_FPS = 5;
/** keep full frame rate this long after any interaction or state change */
const ACTIVE_GRACE_MS = 1500;
/** 'max' mode: effectively uncapped */
const MAX_FPS = 240;

interface SignalGeometry {
  intersectionIndex: number;
  group: string;
  /** stop line centre (px) and its half length along the lane's cross direction */
  bar: { cx: number; cy: number; half: number };
  /** unit vectors: u along the bar, n in the direction of travel (towards the junction) */
  u: { x: number; y: number };
  n: { x: number; y: number };
  /** lantern housing centre (px) */
  lamp: { x: number; y: number };
}

interface VehicleView {
  container: Phaser.GameObjects.Container;
}

interface QueueBadge {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  shown: number;
}

/**
 * Renders the map, vehicles and lights from the simulation state and handles pan/zoom/tap.
 * Contains no game rules: everything is read from the GameSession / Simulation.
 */
export class GameScene extends Phaser.Scene {
  private mapLayer!: Phaser.GameObjects.Graphics;
  private lightsLayer!: Phaser.GameObjects.Graphics;
  private selection!: Phaser.GameObjects.Rectangle;
  /** pulsing marker around the vehicle that decides the finish time */
  private finalMarker!: Phaser.GameObjects.Graphics;
  private crashMarker!: Phaser.GameObjects.Rectangle;
  private vehicleLayer!: Phaser.GameObjects.Layer;
  /** clips vehicles to the map so they appear/disappear exactly at the road's end */
  private mapMaskShape!: Phaser.GameObjects.Graphics;
  private mapMask!: Phaser.Display.Masks.GeometryMask;
  private readonly vehicleViews = new Map<number, VehicleView>();
  private readonly queueBadges = new Map<string, QueueBadge>();
  private signalGeometry: SignalGeometry[] = [];
  private renderedLevelId: string | null = null;
  private fitZoom = 1;
  private crashShown = false;
  private lastSelectedId: string | null = null;

  private dragStart: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private dragging = false;
  private pinchStart: { distance: number; zoom: number } | null = null;
  private appliedFps = 0;
  private idleWake: ReturnType<typeof setTimeout> | null = null;
  private readonly prefs: PreferencesStore;

  constructor(private readonly session: GameSession, prefs?: PreferencesStore) {
    super('game');
    this.prefs = prefs ?? new PreferencesStore();
  }

  create(): void {
    this.mapLayer = this.add.graphics();
    this.lightsLayer = this.add.graphics();
    this.vehicleLayer = this.add.layer();
    this.mapMaskShape = this.make.graphics({ x: 0, y: 0 }, false);
    this.mapMask = this.mapMaskShape.createGeometryMask();
    this.selection = this.add.rectangle(0, 0, TILE_PX + 8, TILE_PX + 8).setStrokeStyle(4, THEME.selection).setVisible(false);
    this.finalMarker = this.add.graphics().setDepth(6);
    this.crashMarker = this.add.rectangle(0, 0, TILE_PX, TILE_PX, THEME.crash, 0.55).setVisible(false);
    this.setupInput();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.wakeNow();
      this.fitCamera(false);
    });
    // Phaser's own listeners only run inside a step, so wake on raw DOM input while the loop sleeps
    const canvas = this.game.canvas;
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'touchstart'] as const) {
      canvas.addEventListener(type, () => this.wakeNow(), { passive: true });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.idleWake) clearTimeout(this.idleWake);
    });
  }

  update(_time: number, delta: number): void {
    this.applyFrameRate();
    const level = this.session.level;
    if (!level || !this.session.network || !this.session.sim) return;
    if (this.renderedLevelId !== level.id) this.buildMap();
    this.session.advance(delta);
    this.drawLights();
    this.drawVehicles();
    this.drawFinalMarker(_time);
    this.drawQueueBadges();
    this.drawSelection();
    this.drawCrash();
  }

  /** Ring plus flag around the last-spawned vehicle: when it leaves the map, the clock stops. */
  private drawFinalMarker(time: number): void {
    const g = this.finalMarker;
    g.clear();
    const sim = this.session.sim!;
    const id = sim.finalVehicleId;
    if (id === null) return;
    const view = this.vehicleViews.get(id);
    const veh = sim.vehicles.find(v => v.id === id);
    if (!view || !veh) return;
    const { x, y } = view.container;
    const pulse = 0.5 + 0.5 * Math.sin(time / 260);
    const radius = Math.max(veh.type.length, 4) * PX_PER_M * 0.75 + 6 + pulse * 3;
    g.lineStyle(3, THEME.selection, 0.9).strokeCircle(x, y, radius);
    g.lineStyle(2, THEME.selection, 0.35).strokeCircle(x, y, radius + 6 + pulse * 4);
    // small flag above the ring
    const fx = x;
    const fy = y - radius - 4;
    g.lineStyle(2, THEME.selection, 1).lineBetween(fx, fy, fx, fy - 16);
    g.fillStyle(THEME.selection, 1).fillTriangle(fx, fy - 16, fx + 12, fy - 12, fx, fy - 8);
  }

  // ---------------------------------------------------------------- spawn queue badges

  /** One badge per spawn point, on the pavement next to the entry lane; shows how many vehicles wait off-map. */
  private buildQueueBadges(): void {
    this.queueBadges.forEach(b => b.container.destroy());
    this.queueBadges.clear();
    const network = this.session.network!;
    for (const sp of network.spawnPoints) {
      const heading = SIDE_DIR[sp.heading];
      const right = rightOf(heading);
      const center = network.tileCenter(sp.x, sp.y);
      const x = (center.x + heading.x * 1.5 + right.x * 6) * PX_PER_M;
      const y = (center.y + heading.y * 1.5 + right.y * 6) * PX_PER_M;
      const bg = this.add.graphics();
      const text = this.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: '700', color: '#1f2937' }).setOrigin(0.5);
      const container = this.add.container(x, y, [bg, text]).setVisible(false).setDepth(5);
      this.queueBadges.set(sp.id, { container, bg, text, shown: -1 });
    }
  }

  private drawQueueBadges(): void {
    const sim = this.session.sim!;
    const counts = sim.queuedBySpawnPoint();
    const zoom = this.cameras.main.zoom;
    const scale = Phaser.Math.Clamp(1 / zoom, 0.8, 2.2);
    for (const [id, badge] of this.queueBadges) {
      const n = counts.get(id) ?? 0;
      if (n === 0) {
        badge.container.setVisible(false);
        badge.shown = 0;
        continue;
      }
      badge.container.setVisible(true).setScale(scale);
      if (badge.shown !== n) {
        badge.shown = n;
        badge.text.setText(`${n}`);
        const w = Math.max(30, badge.text.width + 26);
        const h = 24;
        badge.bg.clear();
        badge.bg.fillStyle(0x000000, 0.12).fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w, h, 12);
        badge.bg.fillStyle(0xffffff, 0.96).fillRoundedRect(-w / 2, -h / 2, w, h, 12);
        badge.bg.lineStyle(1.5, 0x1f2937, 0.35).strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
        // small waiting-car pictogram left of the number
        badge.bg.fillStyle(0x1f2937, 0.85).fillRoundedRect(-w / 2 + 7, -4, 12, 8, 2);
        badge.bg.fillStyle(0xcfe8ff, 1).fillRect(-w / 2 + 15, -2.5, 2.5, 5);
        badge.text.setPosition(7, 0);
      }
    }
  }

  // ---------------------------------------------------------------- frame rate

  /** Frame rate for a running simulation, from the preference ('auto' = 30 on touch devices). */
  private runFps(): number {
    switch (this.prefs.get('fpsMode')) {
      case '30':
        return 30;
      case '60':
        return 60;
      case 'max':
        return MAX_FPS;
      default:
        return this.sys.game.device.input.touch && matchMedia('(pointer: coarse)').matches ? 30 : 60;
    }
  }

  /**
   * Full rate while running or shortly after interaction. When idle the loop is put to sleep after this
   * frame (no requestAnimationFrame at all) and woken by a timer for a single frame at IDLE_FPS.
   */
  private applyFrameRate(): void {
    const active = this.session.runState === 'running' || performance.now() - this.session.activityAt < ACTIVE_GRACE_MS;
    const loop = this.game.loop as Phaser.Core.TimeStep & { _limitRate: number };
    if (active) {
      if (this.idleWake) {
        clearTimeout(this.idleWake);
        this.idleWake = null;
      }
      const target = this.runFps();
      if (target !== this.appliedFps) {
        this.appliedFps = target;
        loop.fpsLimit = target;
        loop._limitRate = 1000 / target;
      }
      return;
    }
    if (this.idleWake) return;
    // this frame still renders; afterwards the loop sleeps until the timer wakes it for the next idle frame
    loop.sleep();
    this.idleWake = setTimeout(() => {
      this.idleWake = null;
      if (!this.sys.isActive()) return;
      loop.wake(true);
    }, 1000 / IDLE_FPS);
  }

  /** Any DOM interaction while asleep must wake the loop immediately (pan, tap, wheel). */
  private wakeNow(): void {
    this.session.touch();
    if (this.idleWake) {
      clearTimeout(this.idleWake);
      this.idleWake = null;
      this.game.loop.wake(true);
    }
  }

  // ---------------------------------------------------------------- map

  private buildMap(): void {
    const level = this.session.level!;
    const network = this.session.network!;
    this.renderedLevelId = level.id;
    const g = this.mapLayer;
    g.clear();

    const w = level.grid.width * TILE_PX;
    const h = level.grid.height * TILE_PX;
    g.fillStyle(THEME.ground, 1).fillRect(0, 0, w, h);
    this.mapMaskShape.clear().fillStyle(0xffffff, 1).fillRect(0, 0, w, h);
    g.lineStyle(1, THEME.groundGrid, 1);
    for (let x = 0; x <= level.grid.width; x++) g.lineBetween(x * TILE_PX, 0, x * TILE_PX, h);
    for (let y = 0; y <= level.grid.height; y++) g.lineBetween(0, y * TILE_PX, w, y * TILE_PX);

    for (const tile of network.tiles.values()) {
      const isJunction = tile.neighbors.length >= 3;
      g.fillStyle(isJunction ? THEME.intersection : THEME.asphalt, 1);
      g.fillRect(tile.x * TILE_PX, tile.y * TILE_PX, TILE_PX, TILE_PX);
    }
    for (const tile of network.tiles.values()) this.drawTileMarkings(tile);
    this.drawDecorations();

    this.signalGeometry = [];
    for (let i = 0; i < network.intersections.length; i++) this.buildSignalGeometry(i, network.intersections[i]);

    this.vehicleViews.forEach(v => v.container.destroy());
    this.vehicleViews.clear();
    this.buildQueueBadges();
    this.crashShown = false;
    this.crashMarker.setVisible(false);
    this.fitCamera(true);
  }

  /**
   * Houses, larger buildings, trees and lawns on the tiles without road. Placement is deterministic
   * (seeded by level id) so a level always looks the same; purely cosmetic.
   */
  private drawDecorations(): void {
    const level = this.session.level!;
    const network = this.session.network!;
    const g = this.mapLayer;
    const rand = seededRandom(level.id);
    const { width, height } = level.grid;
    const isRoad = (x: number, y: number): boolean => network.tiles.has(`${x},${y}`);
    const nearRoad = (x: number, y: number): boolean =>
      isRoad(x - 1, y) || isRoad(x + 1, y) || isRoad(x, y - 1) || isRoad(x, y + 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isRoad(x, y)) continue;
        const px = x * TILE_PX;
        const py = y * TILE_PX;
        const r = rand();
        if (nearRoad(x, y)) {
          if (r < 0.62) this.drawBuilding(g, px, py, rand, this.roadSide(x, y, isRoad));
          else if (r < 0.88) this.drawTrees(g, px, py, rand, 1 + Math.floor(rand() * 2));
          // else: empty lot
        } else if (r < 0.3) {
          this.drawBuilding(g, px, py, rand, null);
        } else if (r < 0.62) {
          this.drawTrees(g, px, py, rand, 1 + Math.floor(rand() * 3));
        } else if (r < 0.74) {
          g.fillStyle(THEME.grass, 1).fillRoundedRect(px + 4, py + 4, TILE_PX - 8, TILE_PX - 8, 6);
          this.drawTrees(g, px, py, rand, 1);
        }
      }
    }
  }

  /** Side of the tile that faces a road, so buildings can turn their front towards it. */
  private roadSide(x: number, y: number, isRoad: (x: number, y: number) => boolean): 'N' | 'E' | 'S' | 'W' | null {
    if (isRoad(x, y + 1)) return 'S';
    if (isRoad(x, y - 1)) return 'N';
    if (isRoad(x + 1, y)) return 'E';
    if (isRoad(x - 1, y)) return 'W';
    return null;
  }

  private drawBuilding(g: Phaser.GameObjects.Graphics, px: number, py: number, rand: () => number, front: 'N' | 'E' | 'S' | 'W' | null): void {
    const inset = 6;
    const maxW = TILE_PX - inset * 2;
    const w = Math.round(maxW * (0.55 + rand() * 0.45));
    const h = Math.round(maxW * (0.55 + rand() * 0.45));
    // hug the road-facing side, jitter along the other axis
    let bx = px + inset + Math.round((maxW - w) * rand());
    let by = py + inset + Math.round((maxW - h) * rand());
    if (front === 'S') by = py + TILE_PX - inset - h;
    if (front === 'N') by = py + inset;
    if (front === 'E') bx = px + TILE_PX - inset - w;
    if (front === 'W') bx = px + inset;
    const fill = THEME.buildingFills[Math.floor(rand() * THEME.buildingFills.length)];
    // drop shadow, body, roof edge
    g.fillStyle(0x000000, 0.12).fillRect(bx + 3, by + 3, w, h);
    g.fillStyle(fill, 1).fillRect(bx, by, w, h);
    g.lineStyle(1.5, THEME.buildingOutline, 0.9).strokeRect(bx, by, w, h);
    const roofStyle = rand();
    if (roofStyle < 0.5) {
      // pitched roof: ridge line across the middle
      const horizontal = w >= h;
      g.lineStyle(1.5, THEME.buildingOutline, 0.6);
      if (horizontal) g.lineBetween(bx + 4, by + h / 2, bx + w - 4, by + h / 2);
      else g.lineBetween(bx + w / 2, by + 4, bx + w / 2, by + h - 4);
      g.fillStyle(THEME.buildingRoof, 0.35).fillRect(bx, by, horizontal ? w : w / 2, horizontal ? h / 2 : h);
    } else {
      // flat roof with a small rooftop box (stairwell / vent)
      const s = Math.min(w, h) * 0.3;
      g.fillStyle(THEME.buildingRoof, 0.5).fillRect(bx + w * 0.15, by + h * 0.15, s, s);
    }
    // a few skylights/windows on larger buildings
    if (w > 28 && h > 28 && rand() < 0.6) {
      g.fillStyle(THEME.window, 0.8);
      const cols = Math.max(1, Math.floor(w / 14));
      const rows = Math.max(1, Math.floor(h / 14));
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          if (rand() < 0.35) continue;
          g.fillRect(bx + 5 + i * ((w - 10) / cols) + 2, by + 5 + j * ((h - 10) / rows) + 2, 4, 4);
        }
      }
    }
  }

  private drawTrees(g: Phaser.GameObjects.Graphics, px: number, py: number, rand: () => number, count: number): void {
    for (let i = 0; i < count; i++) {
      const r = (1.1 + rand() * 0.9) * PX_PER_M;
      const cx = px + r + 2 + rand() * (TILE_PX - 2 * r - 4);
      const cy = py + r + 2 + rand() * (TILE_PX - 2 * r - 4);
      const fill = THEME.treeCanopy[Math.floor(rand() * THEME.treeCanopy.length)];
      g.fillStyle(THEME.treeTrunkShadow, 0.18).fillCircle(cx + 2.5, cy + 2.5, r);
      g.fillStyle(fill, 1).fillCircle(cx, cy, r);
      g.lineStyle(1, THEME.treeOutline, 0.5).strokeCircle(cx, cy, r);
      g.fillStyle(0xffffff, 0.18).fillCircle(cx - r * 0.3, cy - r * 0.3, r * 0.35);
    }
  }

  private drawTileMarkings(tile: TileInfo): void {
    const g = this.mapLayer;
    const network = this.session.network!;
    const cx = (tile.x + 0.5) * TILE_PX;
    const cy = (tile.y + 0.5) * TILE_PX;
    const half = TILE_PX / 2;
    if (tile.neighbors.length >= 3) return; // junction: no markings inside the box

    const straight = tile.neighbors.length === 2 && tile.neighbors[0] === OPPOSITE[tile.neighbors[1]];
    if (tile.neighbors.length === 1 || straight) {
      const axisSide = tile.neighbors[0];
      const horizontal = axisSide === 'E' || axisSide === 'W';
      const seg = network.segmentForStep(tile, axisSide)!;
      g.lineStyle(2, THEME.edgeLine, 0.9);
      if (horizontal) {
        g.lineBetween(cx - half, cy - half + 2, cx + half, cy - half + 2);
        g.lineBetween(cx - half, cy + half - 2, cx + half, cy + half - 2);
      } else {
        g.lineBetween(cx - half + 2, cy - half, cx - half + 2, cy + half);
        g.lineBetween(cx + half - 2, cy - half, cx + half - 2, cy + half);
      }
      if (!seg.oneWay) {
        // dashed centre line: 2 m dash, 2 m gap
        g.lineStyle(2, THEME.laneLine, 0.9);
        const dash = 2 * PX_PER_M;
        for (const start of [1, 5]) {
          const a = start * PX_PER_M;
          if (horizontal) g.lineBetween(cx - half + a, cy, cx - half + a + dash, cy);
          else g.lineBetween(cx, cy - half + a, cx, cy - half + a + dash);
        }
      } else {
        // one-way arrow in the direction of travel
        const dir = SIDE_DIR[network.stepAllowed(seg, axisSide) ? axisSide : OPPOSITE[axisSide]];
        this.drawArrow(cx, cy, dir.x, dir.y, 1.6 * PX_PER_M, THEME.laneLine);
      }
      if (tile.neighbors.length === 1 && network.isEdge(tile.x, tile.y)) {
        // map edge: mark the entry/exit
        g.lineStyle(3, THEME.edgeArrow, 0.8);
        const d = SIDE_DIR[OPPOSITE[axisSide]];
        g.lineBetween(cx + d.x * half - d.y * half, cy + d.y * half - d.x * half, cx + d.x * half + d.y * half, cy + d.y * half + d.x * half);
      }
    } else if (tile.neighbors.length === 2) {
      // bend: outer edge lines only
      g.lineStyle(2, THEME.edgeLine, 0.9);
      for (const side of SIDES) {
        if (tile.neighbors.includes(side)) continue;
        const d = SIDE_DIR[side];
        const inset = 2;
        const px = cx + d.x * (half - inset);
        const py = cy + d.y * (half - inset);
        g.lineBetween(px - d.y * half, py - d.x * half, px + d.y * half, py + d.x * half);
      }
    }
  }

  private drawArrow(x: number, y: number, dx: number, dy: number, size: number, color: number): void {
    const g = this.mapLayer;
    g.fillStyle(color, 0.9);
    const rx = -dy;
    const ry = dx;
    g.fillTriangle(
      x + dx * size, y + dy * size,
      x - dx * size * 0.4 + rx * size * 0.7, y - dy * size * 0.4 + ry * size * 0.7,
      x - dx * size * 0.4 - rx * size * 0.7, y - dy * size * 0.4 - ry * size * 0.7,
    );
  }

  private buildSignalGeometry(index: number, info: IntersectionInfo): void {
    const network = this.session.network!;
    const tile = network.tileAt(info.x, info.y)!;
    for (const approach of SIDES) {
      const group = info.approachToGroup[approach];
      if (!group) continue;
      const seg = network.segmentForStep(tile, approach);
      if (!seg) continue;
      const travel = SIDE_DIR[OPPOSITE[approach]]; // vehicles from this approach travel away from it
      const right = rightOf(travel);
      const laneOffset = seg.oneWay ? 0 : 2;
      const laneHalfWidth = seg.oneWay ? 3.5 : 2;
      const back = 0.5; // stop line offset before the tile edge (m)
      const cx = info.center.x - travel.x * (TILE_SIZE / 2 + back) + right.x * laneOffset;
      const cy = info.center.y - travel.y * (TILE_SIZE / 2 + back) + right.y * laneOffset;
      const lampDist = seg.oneWay ? 6.2 : 4.2 + laneOffset;
      const lampBack = TILE_SIZE / 2 + 3.4; // housing sits a little before the stop line, on the pavement
      this.signalGeometry.push({
        intersectionIndex: index,
        group,
        bar: { cx: cx * PX_PER_M, cy: cy * PX_PER_M, half: laneHalfWidth * PX_PER_M },
        u: right,
        n: travel,
        lamp: {
          x: (info.center.x - travel.x * lampBack + right.x * lampDist) * PX_PER_M,
          y: (info.center.y - travel.y * lampBack + right.y * lampDist) * PX_PER_M,
        },
      });
    }
  }

  // ---------------------------------------------------------------- lights

  private drawLights(): void {
    const g = this.lightsLayer;
    g.clear();
    const states = this.session.network!.intersections.map((_, i) => this.session.signalState(i));
    for (const sg of this.signalGeometry) {
      const color = states[sg.intersectionIndex]?.colors[sg.group] ?? 'red';
      this.drawLightStrip(sg, color);
      this.drawLantern(sg.lamp.x, sg.lamp.y, sg.n, color);
    }
  }

  /** The stop line is the light: a wide glowing strip in the signal colour with a white pictogram. */
  private drawLightStrip(sg: SignalGeometry, color: LightColor): void {
    const g = this.lightsLayer;
    const hex = colorHex(color);
    const { cx, cy, half } = sg.bar;
    const { u, n } = sg;
    const x1 = cx - u.x * half;
    const y1 = cy - u.y * half;
    const x2 = cx + u.x * half;
    const y2 = cy + u.y * half;
    g.lineStyle(9, hex, 0.3).lineBetween(x1, y1, x2, y2);
    g.lineStyle(4.5, hex, 1).lineBetween(x1, y1, x2, y2);

    g.fillStyle(0xffffff, 1);
    g.lineStyle(1.6, 0xffffff, 1);
    if (color === 'red') {
      // two short stop bars across the strip
      for (const d of [-2.6, 2.6]) {
        const bx = cx + u.x * d;
        const by = cy + u.y * d;
        g.lineBetween(bx - n.x * 1.6, by - n.y * 1.6, bx + n.x * 1.6, by + n.y * 1.6);
      }
    } else if (color === 'amber') {
      // triangle pointing away from the junction (against the direction of travel)
      g.fillTriangle(
        cx - n.x * 2, cy - n.y * 2,
        cx + u.x * 2.4 + n.x * 1.8, cy + u.y * 2.4 + n.y * 1.8,
        cx - u.x * 2.4 + n.x * 1.8, cy - u.y * 2.4 + n.y * 1.8,
      );
    } else {
      // chevron pointing into the junction
      const tipX = cx + n.x * 2;
      const tipY = cy + n.y * 2;
      g.lineBetween(cx - u.x * 3 - n.x * 1.4, cy - u.y * 3 - n.y * 1.4, tipX, tipY);
      g.lineBetween(cx + u.x * 3 - n.x * 1.4, cy + u.y * 3 - n.y * 1.4, tipX, tipY);
    }
  }

  /**
   * Classic three-lamp housing, laid along the direction of travel `n` so the red lamp is at the
   * end the traffic drives towards (north approach 180°, east 90°, west 270°). Only the active lamp is lit.
   */
  private drawLantern(x: number, y: number, n: { x: number; y: number }, color: LightColor): void {
    const g = this.lightsLayer;
    const across = 17;
    const along = 44;
    const r = 5;
    const spacing = 13;
    const horizontal = n.x !== 0;
    const w = horizontal ? along : across;
    const h = horizontal ? across : along;
    g.fillStyle(0x000000, 0.15).fillRoundedRect(x - w / 2 + 1.5, y - h / 2 + 1.5, w, h, 5);
    g.fillStyle(THEME.lampHousing, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, 5);
    const lamps: [LightColor, number][] = [
      ['red', spacing],
      ['amber', 0],
      ['green', -spacing],
    ];
    for (const [lampColor, d] of lamps) {
      const lx = x + n.x * d;
      const ly = y + n.y * d;
      const active = lampColor === color;
      if (active) g.fillStyle(colorHex(lampColor), 0.3).fillCircle(lx, ly, r + 4);
      g.fillStyle(active ? colorHex(lampColor) : THEME.lampOff, 1).fillCircle(lx, ly, r);
    }
  }

  // ---------------------------------------------------------------- vehicles

  private drawVehicles(): void {
    const sim = this.session.sim!;
    const alpha = this.session.alpha;
    const seen = new Set<number>();
    for (const veh of sim.vehicles) {
      seen.add(veh.id);
      let view = this.vehicleViews.get(veh.id);
      if (!view) {
        view = this.createVehicleView(veh);
        this.vehicleViews.set(veh.id, view);
      }
      const s = veh.prevS + (veh.s - veh.prevS) * alpha;
      const sMid = s - veh.type.length / 2;
      const p = veh.path.polyline.pointAt(sMid);
      const h = veh.path.polyline.headingAt(sMid);
      view.container.setPosition(p.x * PX_PER_M, p.y * PX_PER_M);
      view.container.setRotation(Math.atan2(h.y, h.x));
    }
    for (const [id, view] of this.vehicleViews) {
      if (!seen.has(id)) {
        view.container.destroy();
        this.vehicleViews.delete(id);
      }
    }
  }

  private createVehicleView(veh: Vehicle): VehicleView {
    const len = veh.type.length * PX_PER_M;
    const wid = (veh.type.width ?? 2) * PX_PER_M;
    const kind = vehicleKindOf(veh.type);
    const color = THEME.vehicleColors[veh.id % THEME.vehicleColors.length];
    const parts: Phaser.GameObjects.GameObject[] = [];
    const rect = (x: number, y: number, w: number, h: number, fill: number, alpha = 1): Phaser.GameObjects.Rectangle =>
      this.add.rectangle(x, y, w, h, fill, alpha);

    switch (kind) {
      case 'truck': {
        parts.push(rect(0, 0, len, wid, THEME.truck).setStrokeStyle(1.5, THEME.outline, 0.7));
        const cabLen = 2.2 * PX_PER_M;
        parts.push(rect(len / 2 - cabLen / 2, 0, cabLen, wid, THEME.truckCab));
        parts.push(rect(len / 2 - cabLen + 4, 0, 4, wid * 0.8, THEME.windshield));
        break;
      }
      case 'bus': {
        parts.push(rect(0, 0, len, wid, THEME.bus).setStrokeStyle(1.5, THEME.outline, 0.7));
        // window strips along both sides and a front windshield
        parts.push(rect(-2, -wid * 0.32, len * 0.8, wid * 0.16, THEME.busWindow, 0.9));
        parts.push(rect(-2, wid * 0.32, len * 0.8, wid * 0.16, THEME.busWindow, 0.9));
        parts.push(rect(len / 2 - 3, 0, 4, wid * 0.8, THEME.windshield));
        break;
      }
      case 'van': {
        parts.push(rect(0, 0, len, wid, color).setStrokeStyle(1.5, THEME.outline, 0.7));
        // boxy cargo part behind the cab
        parts.push(rect(-len * 0.15, 0, len * 0.6, wid * 0.86, THEME.vanBox, 0.95));
        parts.push(rect(len * 0.28, 0, len * 0.12, wid * 0.8, THEME.windshield));
        break;
      }
      case 'tractor': {
        // big rear wheels stick out beyond the body, small front wheels
        parts.push(rect(-len * 0.28, -wid * 0.5, len * 0.3, wid * 0.24, THEME.tractorWheel));
        parts.push(rect(-len * 0.28, wid * 0.5, len * 0.3, wid * 0.24, THEME.tractorWheel));
        parts.push(rect(len * 0.32, -wid * 0.4, len * 0.16, wid * 0.16, THEME.tractorWheel));
        parts.push(rect(len * 0.32, wid * 0.4, len * 0.16, wid * 0.16, THEME.tractorWheel));
        parts.push(rect(0, 0, len * 0.7, wid * 0.6, THEME.tractorBody).setStrokeStyle(1, THEME.outline, 0.7));
        parts.push(rect(-len * 0.28, -wid * 0.5, len * 0.1, wid * 0.1, THEME.tractorHub));
        parts.push(rect(-len * 0.28, wid * 0.5, len * 0.1, wid * 0.1, THEME.tractorHub));
        parts.push(rect(-len * 0.12, 0, len * 0.28, wid * 0.5, THEME.windshield, 0.9));
        break;
      }
      case 'motorcycle': {
        parts.push(rect(0, 0, len, wid * 0.55, THEME.motorBody));
        parts.push(rect(len * 0.38, 0, len * 0.22, wid * 0.7, THEME.motorWheel));
        parts.push(rect(-len * 0.38, 0, len * 0.22, wid * 0.7, THEME.motorWheel));
        // rider: helmet in the vehicle colour
        parts.push(this.add.circle(-len * 0.05, 0, wid * 0.42, color).setStrokeStyle(1, THEME.outline, 0.8));
        break;
      }
      default: {
        parts.push(rect(0, 0, len, wid, color).setStrokeStyle(1.5, THEME.outline, 0.7));
        parts.push(rect(len * 0.18, 0, len * 0.16, wid * 0.8, THEME.windshield));
        parts.push(rect(-len * 0.3, 0, len * 0.1, wid * 0.8, THEME.windshield, 0.7));
      }
    }
    const container = this.add.container(0, 0, parts);
    container.setMask(this.mapMask);
    this.vehicleLayer.add(container);
    return { container };
  }

  // ---------------------------------------------------------------- overlays

  private drawSelection(): void {
    const info = this.session.selectedIntersection;
    if (!info) {
      this.selection.setVisible(false);
      this.lastSelectedId = null;
      return;
    }
    const x = info.center.x * PX_PER_M;
    const y = info.center.y * PX_PER_M;
    this.selection.setPosition(x, y).setVisible(true);
    if (this.lastSelectedId !== info.id) {
      this.lastSelectedId = info.id;
      // narrow screens: the bottom sheet covers the lower half, so show the junction in the upper part
      if (this.scale.width < 768) {
        const cam = this.cameras.main;
        cam.pan(x, y + 0.2 * cam.displayHeight, 350, 'Sine.easeInOut');
      }
    }
  }

  private drawCrash(): void {
    const collision = this.session.collision;
    if (!collision) {
      if (this.crashShown) {
        this.crashShown = false;
        this.crashMarker.setVisible(false);
        this.tweens.killTweensOf(this.crashMarker);
      }
      return;
    }
    if (this.crashShown) return;
    this.crashShown = true;
    const info = this.session.network!.intersectionById.get(collision.intersectionId);
    if (!info) return;
    const x = info.center.x * PX_PER_M;
    const y = info.center.y * PX_PER_M;
    this.crashMarker.setPosition(x, y).setAlpha(0.6).setVisible(true);
    this.tweens.add({ targets: this.crashMarker, alpha: { from: 0.7, to: 0.2 }, duration: 500, yoyo: true, repeat: -1 });
    this.cameras.main.shake(350, 0.012);
    this.cameras.main.pan(x, y, 500, 'Sine.easeInOut');
  }

  // ---------------------------------------------------------------- camera & input

  /** Zoom so the whole map fits the viewport (leaving room for the HUD); optionally recentre. */
  private fitCamera(recentre: boolean): void {
    const level = this.session.level;
    if (!level) return;
    const cam = this.cameras.main;
    const mapW = level.grid.width * TILE_PX;
    const mapH = level.grid.height * TILE_PX;
    const availW = Math.max(200, this.scale.width - 32);
    const availH = Math.max(200, this.scale.height - 220);
    this.fitZoom = Phaser.Math.Clamp(Math.min(availW / mapW, availH / mapH), 0.2, 1.5);
    if (recentre || cam.zoom < this.fitZoom * MIN_ZOOM_FACTOR) cam.setZoom(this.fitZoom);
    this.updateBounds();
    if (recentre) cam.centerOn(mapW / 2, mapH / 2);
  }

  private updateBounds(): void {
    const level = this.session.level;
    if (!level) return;
    const cam = this.cameras.main;
    const mapW = level.grid.width * TILE_PX;
    const mapH = level.grid.height * TILE_PX;
    // margin large enough that the map can always be centred in the viewport
    const margin = Math.max(cam.displayWidth, cam.displayHeight);
    cam.setBounds(-margin, -margin, mapW + 2 * margin, mapH + 2 * margin);
  }

  private setZoom(zoom: number, focusX?: number, focusY?: number): void {
    const cam = this.cameras.main;
    const clamped = Phaser.Math.Clamp(zoom, this.fitZoom * MIN_ZOOM_FACTOR, MAX_ZOOM);
    if (focusX !== undefined && focusY !== undefined) {
      const before = cam.getWorldPoint(focusX, focusY);
      cam.setZoom(clamped);
      this.updateBounds();
      const after = cam.getWorldPoint(focusX, focusY);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    } else {
      cam.setZoom(clamped);
      this.updateBounds();
    }
  }

  private setupInput(): void {
    const cam = this.cameras.main;
    this.input.addPointer(1);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      this.session.touch();
      const active = this.activePointers();
      if (active.length >= 2) {
        this.pinchStart = { distance: pointerDistance(active[0], active[1]), zoom: cam.zoom };
        this.dragStart = null;
        return;
      }
      this.dragStart = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
      this.dragging = false;
    });

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.session.touch();
      const active = this.activePointers();
      if (this.pinchStart && active.length >= 2) {
        const d = pointerDistance(active[0], active[1]);
        const mid = { x: (active[0].x + active[1].x) / 2, y: (active[0].y + active[1].y) / 2 };
        this.setZoom((this.pinchStart.zoom * d) / this.pinchStart.distance, mid.x, mid.y);
        return;
      }
      if (!this.dragStart || !p.isDown) return;
      const dx = p.x - this.dragStart.x;
      const dy = p.y - this.dragStart.y;
      if (!this.dragging && dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) this.dragging = true;
      if (this.dragging) {
        cam.scrollX = this.dragStart.scrollX - dx / cam.zoom;
        cam.scrollY = this.dragStart.scrollY - dy / cam.zoom;
      }
    });

    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
      if (this.pinchStart) {
        if (this.activePointers().length < 2) this.pinchStart = null;
        this.dragStart = null;
        return;
      }
      if (this.dragStart && !this.dragging) this.tapAt(p.x, p.y);
      this.dragStart = null;
      this.dragging = false;
    });

    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      this.session.touch();
      const factor = dy > 0 ? 1 / 1.15 : 1.15;
      this.setZoom(cam.zoom * factor, p.x, p.y);
    });
  }

  private activePointers(): Phaser.Input.Pointer[] {
    return this.input.manager.pointers.filter(p => p.isDown);
  }

  private tapAt(screenX: number, screenY: number): void {
    const network = this.session.network;
    if (!network) return;
    const world = this.cameras.main.getWorldPoint(screenX, screenY);
    const tx = Math.floor(world.x / TILE_PX);
    const ty = Math.floor(world.y / TILE_PX);
    // generous hit area: the intersection tile plus half a tile around it
    let hit: IntersectionInfo | null = null;
    for (const info of network.intersections) {
      const dx = Math.abs(world.x / TILE_PX - (info.x + 0.5));
      const dy = Math.abs(world.y / TILE_PX - (info.y + 0.5));
      if (dx <= 1 && dy <= 1) hit = info;
      if (info.x === tx && info.y === ty) {
        hit = info;
        break;
      }
    }
    this.session.selectIntersection(hit?.id ?? null);
  }
}

/** Small deterministic PRNG (mulberry32) seeded from a string; render-only, never used by the simulation. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function colorHex(color: LightColor): number {
  return color === 'green' ? THEME.green : color === 'amber' ? THEME.amber : THEME.red;
}

function pointerDistance(a: Phaser.Input.Pointer, b: Phaser.Input.Pointer): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

