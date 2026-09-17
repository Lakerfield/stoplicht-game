import { resolve } from 'aurelia';
import {
  completeLightSettings,
  RoadNetwork,
  Simulation,
  signalStateAt,
  TICKS_PER_SECOND,
  type CollisionInfo,
  type IntersectionInfo,
  type LevelData,
  type LightSettings,
  type SignalState,
  type SimCounts,
  type SimEvent,
} from '../sim';
import { AudioService } from './audio-service';
import { ProgressStore } from './progress-store';

export type RunState = 'idle' | 'running' | 'paused' | 'finished' | 'crashed';
export type Speed = 1 | 2 | 4;
export const SPEEDS: Speed[] = [1, 2, 4];

export interface RunResult {
  time: number;
  targetTime: number;
  achieved: boolean;
  previousBest: number | null;
  isNewBest: boolean;
}

/** Delay before the game-over dialog covers the crash animation. */
const CRASH_DIALOG_DELAY_MS = 1200;

/** Never simulate more than this many ticks in one frame (tab was hidden, slow device). */
const MAX_TICKS_PER_FRAME = TICKS_PER_SECOND;

/**
 * Shared state bridge between the Aurelia UI and the Phaser scene.
 * Owns the level, the player's light settings, the running simulation and the run controls.
 */
export class GameSession {
  private readonly progress = resolve(ProgressStore);
  readonly audio = resolve(AudioService);
  private readonly frameEvents: SimEvent[] = [];

  level: LevelData | null = null;
  network: RoadNetwork | null = null;
  /** working copy of the player's light settings, keyed by intersection id */
  settings: Record<string, LightSettings> = {};
  sim: Simulation | null = null;
  runState: RunState = 'idle';
  speed: Speed = 1;
  /** mirrors of simulation state, updated once per frame so the UI can observe them cheaply */
  time = 0;
  tick = 0;
  counts: SimCounts = { onMap: 0, queued: 0, pending: 0, total: 0 };
  selectedIntersectionId: string | null = null;
  result: RunResult | null = null;
  collision: CollisionInfo | null = null;
  /** signal state of the selected intersection, refreshed every frame for the panel */
  selectedSignal: SignalState | null = null;
  /** the crash dialog appears a moment after the crash so the animation stays visible */
  crashDialogVisible = false;
  private crashDialogTimer: ReturnType<typeof setTimeout> | null = null;
  /** render interpolation fraction between the previous and the current tick */
  alpha = 0;

  private accumulator = 0;

  /** false for editor test runs: no best times are stored */
  trackProgress = true;

  loadLevel(level: LevelData, options: { trackProgress?: boolean } = {}): void {
    this.level = level;
    this.trackProgress = options.trackProgress ?? true;
    this.network = new RoadNetwork(level);
    const best = this.trackProgress ? this.progress.get(level.id) : undefined;
    this.settings = completeLightSettings(this.network, level, best?.bestSettings);
    this.selectedIntersectionId = null;
    this.rebuild();
  }

  /** settings may be changed before the start and while paused */
  get canEditSettings(): boolean {
    return this.runState === 'idle' || this.runState === 'paused';
  }

  /** settings were changed while paused: the run must restart from t = 0 to stay deterministic */
  settingsDirty = false;

  get needsRestart(): boolean {
    return this.runState === 'paused' && this.settingsDirty;
  }

  get isPlaying(): boolean {
    return this.runState === 'running';
  }

  get isOver(): boolean {
    return this.runState === 'finished' || this.runState === 'crashed';
  }

  get selectedIntersection(): IntersectionInfo | null {
    if (!this.network || !this.selectedIntersectionId) return null;
    return this.network.intersectionById.get(this.selectedIntersectionId) ?? null;
  }

  /** Called by sliders: at t = 0 the light preview follows immediately; while paused a restart is required. */
  settingsChanged(): void {
    if (this.runState === 'idle') this.rebuild();
    else if (this.runState === 'paused') this.settingsDirty = true;
  }

  /** Back to t = 0 with the current settings and run immediately. */
  restart(): void {
    this.rebuild();
    this.start();
  }

  start(): void {
    this.audio.unlock();
    if (this.runState === 'idle' || this.runState === 'paused') this.runState = 'running';
  }

  pause(): void {
    if (this.runState === 'running') this.runState = 'paused';
  }

  togglePlay(): void {
    if (this.runState === 'running') this.pause();
    else if (this.needsRestart) this.restart();
    else this.start();
  }

  /** Back to t = 0, keeping the player's settings. */
  reset(): void {
    this.rebuild();
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  selectIntersection(id: string | null): void {
    this.selectedIntersectionId = id;
    this.syncMirrors();
  }

  signalState(intersectionIndex: number): SignalState | null {
    if (!this.sim) return null;
    return signalStateAt(this.sim.plans[intersectionIndex], this.sim.tick);
  }

  /** Advances the simulation by real elapsed time; called from the render loop. */
  advance(deltaMs: number): void {
    const sim = this.sim;
    if (!sim) return;
    if (this.runState !== 'running') {
      this.syncMirrors();
      this.audio.onFrame([], sim.vehicles.length, 0, false);
      return;
    }
    this.accumulator += (deltaMs / 1000) * this.speed;
    let ticks = Math.floor(this.accumulator * TICKS_PER_SECOND);
    if (ticks > MAX_TICKS_PER_FRAME) {
      ticks = MAX_TICKS_PER_FRAME;
      this.accumulator = ticks / TICKS_PER_SECOND;
    }
    this.frameEvents.length = 0;
    for (let i = 0; i < ticks && sim.status === 'active'; i++) {
      sim.step();
      for (const e of sim.events) this.frameEvents.push(e);
    }
    this.accumulator -= ticks / TICKS_PER_SECOND;
    this.audio.onFrame(this.frameEvents, sim.vehicles.length, sim.meanSpeed(), true);
    this.alpha = Math.min(1, Math.max(0, this.accumulator * TICKS_PER_SECOND));
    this.syncMirrors();
    if (sim.status === 'finished') this.finish();
    else if (sim.status === 'crashed') this.crash();
  }

  private rebuild(): void {
    if (!this.level || !this.network) return;
    this.sim = new Simulation(this.level, cloneSettings(this.settings), this.network);
    this.runState = 'idle';
    this.accumulator = 0;
    this.alpha = 0;
    this.result = null;
    this.collision = null;
    this.settingsDirty = false;
    this.crashDialogVisible = false;
    if (this.crashDialogTimer) {
      clearTimeout(this.crashDialogTimer);
      this.crashDialogTimer = null;
    }
    this.syncMirrors();
  }

  private syncMirrors(): void {
    if (!this.sim) return;
    if (this.time !== this.sim.time) this.time = this.sim.time;
    if (this.tick !== this.sim.tick) this.tick = this.sim.tick;
    const counts = this.sim.counts();
    const c = this.counts;
    if (c.onMap !== counts.onMap || c.queued !== counts.queued || c.pending !== counts.pending || c.total !== counts.total) {
      this.counts = counts;
    }
    const info = this.selectedIntersection;
    const signal = info ? this.signalState(this.network!.intersections.indexOf(info)) : null;
    const prev = this.selectedSignal;
    if (!signal || !prev || signal.cycleTick !== prev.cycleTick || signal.greenGroup !== prev.greenGroup || signal.amberGroup !== prev.amberGroup) {
      this.selectedSignal = signal;
    }
  }

  private finish(): void {
    const sim = this.sim!;
    const level = this.level!;
    this.runState = 'finished';
    this.alpha = 1;
    const time = sim.finishTime ?? sim.time;
    this.time = time;
    const previous = this.trackProgress ? this.progress.get(level.id) : undefined;
    const achieved = time <= level.targetTime;
    const isNewBest = !previous || time < previous.bestTime;
    this.result = { time, targetTime: level.targetTime, achieved, previousBest: previous?.bestTime ?? null, isNewBest };
    this.audio.playFinish(achieved);
    if (!this.trackProgress) return;
    if (isNewBest) {
      this.progress.save(level.id, {
        bestTime: time,
        bestSettings: cloneSettings(this.settings),
        achieved: achieved || previous?.achieved === true,
      });
    } else if (achieved && previous && !previous.achieved) {
      this.progress.save(level.id, { ...previous, achieved: true });
    }
  }

  private crash(): void {
    this.runState = 'crashed';
    this.alpha = 1;
    this.collision = this.sim?.collision ?? null;
    this.audio.playCrash();
    this.crashDialogTimer = setTimeout(() => {
      this.crashDialogVisible = true;
      this.crashDialogTimer = null;
    }, CRASH_DIALOG_DELAY_MS);
  }
}

export function cloneSettings(settings: Record<string, LightSettings>): Record<string, LightSettings> {
  const out: Record<string, LightSettings> = {};
  for (const [id, s] of Object.entries(settings)) {
    out[id] = { green: { ...s.green }, offset: s.offset };
  }
  return out;
}
