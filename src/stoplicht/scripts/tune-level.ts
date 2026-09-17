/**
 * Dev tool: searches good light settings for a level and reports the best time found.
 * Usage: npx vite-node -c scripts/vite-node.config.ts scripts/tune-level.ts public/levels/level2.json [evaluations]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { RoadNetwork, simulateLevel, type LevelData, type LightSettings } from '../src/sim';

const file = process.argv[2];
const budget = Number(process.argv[3] ?? 1500);
const apply = process.argv.includes('--apply');
const level = JSON.parse(readFileSync(file, 'utf8')) as LevelData;
const network = new RoadNetwork(level);
const ids = network.intersections.map(i => i.id);
const groups = network.intersections.map(i => i.lightGroups.map(g => g.id));

type Settings = Record<string, LightSettings>;
const clone = (s: Settings): Settings => JSON.parse(JSON.stringify(s));

function evaluate(s: Settings): number {
  const r = simulateLevel(level, s, 60 * 900);
  return r.status === 'finished' ? r.time : 9999 + r.time;
}

// deterministic PRNG so runs are reproducible
let seed = 12345;
const rand = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const round1 = (x: number): number => Math.round(x * 10) / 10;
const { greenRange, offsetRange } = level.constants;

function randomSettings(): Settings {
  const s: Settings = {};
  ids.forEach((id, i) => {
    s[id] = { green: {}, offset: round1(offsetRange.min + rand() * (offsetRange.max - offsetRange.min) * 0.5) };
    for (const g of groups[i]) s[id].green[g] = round1(3 + rand() * 25);
  });
  return s;
}

function neighbours(s: Settings, step: number): Settings[] {
  const out: Settings[] = [];
  ids.forEach((id, i) => {
    for (const g of groups[i]) {
      for (const d of [-step, step]) {
        const n = clone(s);
        n[id].green[g] = round1(Math.min(greenRange.max, Math.max(greenRange.min, n[id].green[g] + d)));
        out.push(n);
      }
    }
    for (const d of [-step, step]) {
      const n = clone(s);
      n[id].offset = round1(Math.min(offsetRange.max, Math.max(offsetRange.min, n[id].offset + d)));
      out.push(n);
    }
  });
  return out;
}

let evaluations = 0;
function descend(start: Settings): { s: Settings; t: number } {
  let best = { s: start, t: evaluate(start) };
  evaluations++;
  for (const step of [4, 2, 1, 0.5]) {
    let improved = true;
    while (improved && evaluations < budget) {
      improved = false;
      for (const n of neighbours(best.s, step)) {
        const t = evaluate(n);
        evaluations++;
        if (t < best.t) {
          best = { s: n, t };
          improved = true;
        }
      }
    }
  }
  return best;
}

const defaultTime = evaluate(level.defaultLightSettings);
let overall = descend(clone(level.defaultLightSettings));
while (evaluations < budget) {
  const r = descend(randomSettings());
  if (r.t < overall.t) overall = r;
}
console.log(`level ${level.id}: intersections ${ids.join(', ')}; vehicles ${level.spawns.length}`);
console.log(`default settings: ${defaultTime.toFixed(2)} s (target ${level.targetTime} s)`);
console.log(`best found (${evaluations} evaluations): ${overall.t.toFixed(2)} s`);
console.log(JSON.stringify(overall.s));

if (apply && overall.t < 9999) {
  // target ≈ best + 8%, but always clearly below what the default settings achieve
  let target = overall.t * 1.08;
  if (defaultTime < 9999 && target > defaultTime * 0.95) target = (overall.t + defaultTime) / 2;
  target = Math.ceil(target * 2) / 2;
  level.targetTime = target;
  writeFileSync(file, JSON.stringify(level, null, 1) + '\n');
  console.log(`applied target ${target} s`);
}
