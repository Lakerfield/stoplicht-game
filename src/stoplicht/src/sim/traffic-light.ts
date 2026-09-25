import { secondsToTicks } from './defaults';
import type { LevelConstants, LightSettings } from './level-schema';
import type { IntersectionInfo } from './road-network';

export type LightColor = 'green' | 'amber' | 'red';

/** Integer-tick signal schedule of one intersection; the cycle runs green(g0), amber(g0), green(g1), amber(g1), ... */
export interface SignalPlan {
  groups: string[];
  greenTicks: number[];
  amberTicks: number[];
  offsetTicks: number;
  cycleTicks: number;
}

export interface SignalState {
  /** group currently green, or null during clearance */
  greenGroup: string | null;
  /** group whose clearance (amber) is running, or null */
  amberGroup: string | null;
  colors: Record<string, LightColor>;
  /** position within the cycle, ticks */
  cycleTick: number;
  /** ticks until the current state changes */
  ticksRemaining: number;
}

export function buildSignalPlan(intersection: IntersectionInfo, settings: LightSettings, constants: LevelConstants): SignalPlan {
  const groups = intersection.lightGroups.map(g => g.id);
  const greenTicks = groups.map(id => {
    const g = settings.green[id];
    if (g === undefined) throw new Error(`Missing green time for group ${id} at intersection ${intersection.id}`);
    return Math.max(1, secondsToTicks(g));
  });
  const amberTicks = groups.map(id => Math.max(1, secondsToTicks(settings.amber?.[id] ?? constants.clearanceTime)));
  let cycleTicks = 0;
  for (let i = 0; i < groups.length; i++) cycleTicks += greenTicks[i] + amberTicks[i];
  return { groups, greenTicks, amberTicks, offsetTicks: secondsToTicks(settings.offset), cycleTicks };
}

export function signalStateAt(plan: SignalPlan, tick: number): SignalState {
  const cycle = plan.cycleTicks;
  const cycleTick = (((tick - plan.offsetTicks) % cycle) + cycle) % cycle;
  const colors: Record<string, LightColor> = {};
  for (const g of plan.groups) colors[g] = 'red';

  let start = 0;
  for (let i = 0; i < plan.groups.length; i++) {
    const g = plan.groups[i];
    const greenEnd = start + plan.greenTicks[i];
    if (cycleTick < greenEnd) {
      colors[g] = 'green';
      return { greenGroup: g, amberGroup: null, colors, cycleTick, ticksRemaining: greenEnd - cycleTick };
    }
    const clearEnd = greenEnd + plan.amberTicks[i];
    if (cycleTick < clearEnd) {
      colors[g] = 'amber';
      return { greenGroup: null, amberGroup: g, colors, cycleTick, ticksRemaining: clearEnd - cycleTick };
    }
    start = clearEnd;
  }
  // unreachable for a well-formed plan
  return { greenGroup: null, amberGroup: null, colors, cycleTick, ticksRemaining: 0 };
}
