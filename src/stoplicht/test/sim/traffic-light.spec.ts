import { describe, expect, it } from 'vitest';
import { buildSignalPlan, RoadNetwork, signalStateAt, TICKS_PER_SECOND } from '../../src/sim';
import { crossLevel } from './fixtures';

describe('traffic light schedule', () => {
  const net = new RoadNetwork(crossLevel([]));
  const level = crossLevel([]);
  const plan = buildSignalPlan(net.intersections[0], { green: { A: 10, B: 5 }, offset: 3 }, level.constants);

  it('cycles green A, amber A, green B, amber B', () => {
    expect(plan.cycleTicks).toBe((10 + 2 + 5 + 2) * TICKS_PER_SECOND);
    const t = (s: number) => signalStateAt(plan, Math.round((s + 3) * TICKS_PER_SECOND));
    expect(t(0).colors).toEqual({ A: 'green', B: 'red' });
    expect(t(9.99).greenGroup).toBe('A');
    expect(t(10).colors).toEqual({ A: 'amber', B: 'red' });
    expect(t(11.99).greenGroup).toBeNull();
    expect(t(12).colors).toEqual({ A: 'red', B: 'green' });
    expect(t(17).colors).toEqual({ A: 'red', B: 'amber' });
    expect(t(19).colors).toEqual({ A: 'green', B: 'red' });
  });

  it('handles the offset, including before t = offset', () => {
    // at t=0 we are 3 s before the cycle start, i.e. in the last 3 s of amber B / green... cycle is 19 s: 19-3 = 16 -> green B (12..17)
    expect(signalStateAt(plan, 0).greenGroup).toBe('B');
    expect(signalStateAt(plan, 3 * TICKS_PER_SECOND).greenGroup).toBe('A');
  });
});
