import { describe, expect, it } from 'vitest';
import { RoadNetwork, TILE_SIZE, type LevelData } from '../../src/sim';
import { crossLevel } from './fixtures';

describe('RoadNetwork', () => {
  const net = new RoadNetwork(crossLevel([]));

  it('derives the intersection from crossing roads', () => {
    expect(net.intersections.map(i => i.id)).toEqual(['k1']);
    expect(net.intersections[0].approachToGroup).toEqual({ N: 'A', S: 'A', E: 'B', W: 'B' });
  });

  it('builds straight paths from edge to edge with lane offset (right-hand traffic)', () => {
    const w = net.spawnPointById.get('W')!;
    expect(w.heading).toBe('E');
    expect(w.path.polyline.length).toBe(11 * TILE_SIZE);
    // eastbound lane is 2 m south (y+) of the road centre line y = 4.5 * 8 = 36
    expect(w.path.polyline.pointAt(10)).toEqual({ x: 10, y: 38 });
    const n = net.spawnPointById.get('N')!;
    expect(n.path.polyline.length).toBe(9 * TILE_SIZE);
    // southbound lane is 2 m west (x-) of centre line x = 44
    expect(n.path.polyline.pointAt(10)).toEqual({ x: 42, y: 10 });
  });

  it('marks the intersection zone along the path', () => {
    const w = net.spawnPointById.get('W')!;
    expect(w.path.intersections).toHaveLength(1);
    const pi = w.path.intersections[0];
    expect(pi.intersectionId).toBe('k1');
    expect(pi.approach).toBe('W');
    expect(pi.sEnter).toBe(5 * TILE_SIZE);
    expect(pi.sExit).toBe(6 * TILE_SIZE);
    expect(pi.sStop).toBe(5 * TILE_SIZE - 0.5);
  });

  it('follows a bend between two segments', () => {
    const level: LevelData = crossLevel([], {
      roads: [
        { id: 'a', from: [0, 4], to: [5, 4] },
        { id: 'b', from: [5, 4], to: [5, 8] },
      ],
      intersections: [],
      spawnPoints: [{ id: 'W', at: [0, 4] }],
      defaultLightSettings: {},
    });
    const bent = new RoadNetwork(level);
    expect(bent.intersections).toHaveLength(0);
    const path = bent.spawnPointById.get('W')!.path;
    expect(path.tiles).toEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [5, 5], [5, 6], [5, 7], [5, 8]]);
    const end = path.polyline.pointAt(path.polyline.length);
    expect(end.y).toBe(9 * TILE_SIZE);
    // heading south, right-hand lane lies 2 m west of the column centre line x = 5.5 * 8 = 44
    expect(end.x).toBe(42);
  });

  it('rejects driving against a one-way road', () => {
    const level = crossLevel([], {
      roads: [
        { id: 'h', from: [10, 4], to: [0, 4], oneWay: true },
        { id: 'v', from: [5, 0], to: [5, 8] },
      ],
    });
    expect(() => new RoadNetwork(level)).toThrow(/one-way/);
  });
});
