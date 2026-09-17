import { describe, expect, it } from 'vitest';
import { DT, Simulation, simulateLevel, TICKS_PER_SECOND, type LightSettings } from '../../src/sim';
import { crossLevel, doubleLevel } from './fixtures';

const alwaysGreenB: Record<string, LightSettings> = { k1: { green: { A: 1, B: 600 }, offset: -3 } };

function trace(sim: Simulation): string {
  const parts: string[] = [];
  while (sim.status === 'active' && sim.tick < TICKS_PER_SECOND * 600) {
    sim.step();
    for (const v of sim.vehicles) parts.push(`${sim.tick}:${v.id}:${v.s}:${v.v}`);
  }
  return parts.join('|');
}

describe('Simulation', () => {
  it('finishes immediately for a level without vehicles', () => {
    const r = simulateLevel(crossLevel([]), {});
    expect(r.status).toBe('finished');
    expect(r.time).toBe(0);
  });

  it('a single car on a green road crosses the map at top speed', () => {
    const level = crossLevel([{ time: 0, spawnPoint: 'W', vehicleType: 'car' }]);
    const r = simulateLevel(level, alwaysGreenB);
    expect(r.status).toBe('finished');
    // 88 m of road + 4.5 m vehicle length at 14 m/s
    expect(r.time).toBeCloseTo((88 + 4.5) / 14, 1);
  });

  it('is deterministic: identical inputs give an identical per-tick trace', () => {
    const level = crossLevel([
      { time: 0, spawnPoint: 'W', vehicleType: 'car' },
      { time: 0.5, spawnPoint: 'W', vehicleType: 'truck' },
      { time: 1, spawnPoint: 'N', vehicleType: 'car' },
      { time: 2, spawnPoint: 'S', vehicleType: 'car' },
      { time: 2, spawnPoint: 'E', vehicleType: 'car' },
    ]);
    const a = trace(new Simulation(level, level.defaultLightSettings));
    const b = trace(new Simulation(level, level.defaultLightSettings));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(1000);
  });

  it('stops exactly at the stop line on red and continues on green', () => {
    const level = crossLevel([{ time: 0, spawnPoint: 'W', vehicleType: 'car' }]);
    // A green 0-20 s, so B (E-W) is red for the first 22 s
    const sim = new Simulation(level, { k1: { green: { A: 20, B: 10 }, offset: 0 } });
    const sStop = sim.network.spawnPointById.get('W')!.path.intersections[0].sStop;
    let stoppedAt: number | undefined;
    while (sim.tick < 20 * TICKS_PER_SECOND) {
      sim.step();
      const car = sim.vehicles[0];
      expect(car.s).toBeLessThanOrEqual(sStop);
      if (car.v === 0 && stoppedAt === undefined) stoppedAt = sim.time;
    }
    expect(sim.vehicles[0].s).toBe(sStop);
    expect(stoppedAt).toBeDefined();
    // braking from 14 m/s at 4 m/s² takes 3.5 s; stop line at 39.5 m is reached around t ≈ 4.6 s
    expect(stoppedAt!).toBeGreaterThan(4);
    expect(stoppedAt!).toBeLessThan(6);
    // green for B starts at 22 s; reaction time 0.3 s
    while (sim.tick < 22.2 * TICKS_PER_SECOND) sim.step();
    expect(sim.vehicles[0].v).toBe(0);
    while (sim.tick < 22.5 * TICKS_PER_SECOND) sim.step();
    expect(sim.vehicles[0].v).toBeGreaterThan(0);
    const r = sim.run();
    expect(r.status).toBe('finished');
  });

  it('a car that is too close to stop when the light changes drives on', () => {
    const level = crossLevel([{ time: 0, spawnPoint: 'W', vehicleType: 'car' }]);
    // B green until t = 3 s: the car is then at ~42 m/s*3 = 42 m... use 2.5 s -> 35 m, 4.5 m before the line
    const sim = new Simulation(level, { k1: { green: { A: 10, B: 2.5 }, offset: -12 } });
    const r = sim.run();
    expect(r.status).toBe('finished');
    expect(r.time).toBeCloseTo((88 + 4.5) / 14, 1);
  });

  it('keeps the minimum gap behind a stopped leader and starts with reaction delay', () => {
    const level = crossLevel([
      { time: 0, spawnPoint: 'W', vehicleType: 'car' },
      { time: 0.6, spawnPoint: 'W', vehicleType: 'car' },
      { time: 1.2, spawnPoint: 'W', vehicleType: 'truck' },
    ]);
    const sim = new Simulation(level, { k1: { green: { A: 20, B: 30 }, offset: 0 } });
    let ticksBothStopped = 0;
    let leaderMovedTick: number | undefined;
    let followerMovedTick: number | undefined;
    while (sim.status === 'active' && sim.tick < 60 * TICKS_PER_SECOND) {
      sim.step();
      for (const v of sim.vehicles) {
        if (v.leader) {
          expect(v.s).toBeLessThanOrEqual(v.leader.s - v.leader.type.length - v.type.minGap + 1e-9);
        }
      }
      const [first, second] = sim.vehicles;
      if (first && second && first.v === 0 && second.v === 0) {
        ticksBothStopped++;
        expect(second.s).toBeCloseTo(first.s - first.type.length - second.type.minGap, 9);
      }
      if (first && ticksBothStopped > 0 && leaderMovedTick === undefined && first.v > 0) leaderMovedTick = sim.tick;
      if (second && leaderMovedTick !== undefined && followerMovedTick === undefined && second.v > 0) followerMovedTick = sim.tick;
    }
    expect(ticksBothStopped).toBeGreaterThan(60);
    expect(followerMovedTick! - leaderMovedTick!).toBeGreaterThanOrEqual(Math.round(0.3 / DT));
    expect(sim.status).toBe('finished');
  });

  it('queues spawns off-map when the road is blocked and lets the clock run', () => {
    const spawns = Array.from({ length: 12 }, (_, i) => ({ time: i * 0.5, spawnPoint: 'W', vehicleType: 'car' }));
    const level = crossLevel(spawns);
    const sim = new Simulation(level, { k1: { green: { A: 40, B: 30 }, offset: 0 } });
    while (sim.tick < 10 * TICKS_PER_SECOND) sim.step();
    const c = sim.counts();
    expect(c.pending).toBe(0);
    expect(c.queued).toBeGreaterThan(0);
    expect(c.onMap + c.queued).toBe(12);
    // 39.5 m of road before the stop line fits at most 6 cars of 4.5 m + 1.5 m gap
    expect(c.onMap).toBeLessThanOrEqual(7);
    const r = sim.run();
    expect(r.status).toBe('finished');
    expect(r.time).toBeGreaterThan(42);
  });

  it('detects a collision when a blocked intersection is entered by cross traffic (strict)', () => {
    const spawns = [
      ...[0, 1, 2, 3, 4].map(t => ({ time: t, spawnPoint: 'W', vehicleType: 'car' })),
      { time: 12, spawnPoint: 'N1', vehicleType: 'car' },
    ];
    const r = simulateLevel(doubleLevel(spawns), doubleLevel([]).defaultLightSettings);
    expect(r.status).toBe('crashed');
    expect(r.collision?.intersectionId).toBe('k1');
    expect(r.collision?.vehicleIds.length).toBeGreaterThanOrEqual(2);
    expect(r.time).toBeGreaterThan(14);
    expect(r.time).toBeLessThan(17);
  });

  it('in mild mode cross traffic waits for the blocked intersection instead', () => {
    const spawns = [
      ...[0, 1, 2, 3, 4].map(t => ({ time: t, spawnPoint: 'W', vehicleType: 'car' })),
      { time: 12, spawnPoint: 'N1', vehicleType: 'car' },
    ];
    const level = doubleLevel(spawns, { collisionMode: 'mild' });
    const r = simulateLevel(level, level.defaultLightSettings);
    expect(r.status).toBe('finished');
  });

  it('speed multiplier does not exist in the core: results depend on ticks only', () => {
    const level = crossLevel([
      { time: 0, spawnPoint: 'N', vehicleType: 'car' },
      { time: 0, spawnPoint: 'W', vehicleType: 'car' },
    ]);
    const r1 = simulateLevel(level, level.defaultLightSettings);
    const r2 = simulateLevel(level, level.defaultLightSettings);
    expect(r1).toEqual(r2);
  });
});
