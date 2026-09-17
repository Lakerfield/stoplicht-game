/**
 * Geometry helpers for the simulation core.
 * Determinism: only + - * / and Math.sqrt are used (bit-exact under IEEE 754 on every platform).
 * Never use Math.sin/cos/pow/atan2 in this module or anywhere in src/sim.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function equals(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Perpendicular pointing to the right of a heading (screen coordinates, y down). */
export function rightOf(dir: Vec2): Vec2 {
  return { x: -dir.y, y: dir.x };
}

/** Polyline with cumulative arc length; positions are addressed by distance `s` along it. */
export class Polyline {
  readonly points: Vec2[];
  readonly cumulative: number[];
  readonly length: number;

  constructor(points: Vec2[]) {
    if (points.length < 2) throw new Error('Polyline needs at least two points');
    this.points = points;
    this.cumulative = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += dist(points[i - 1], points[i]);
      this.cumulative.push(total);
    }
    this.length = total;
  }

  /** Index of the segment containing s (clamped). */
  segmentIndexAt(s: number): number {
    const cum = this.cumulative;
    let lo = 0;
    let hi = cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Point at distance s; extrapolates linearly beyond both ends (vehicles enter/leave the map). */
  pointAt(s: number): Vec2 {
    const i = this.segmentIndexAt(s);
    const a = this.points[i];
    const b = this.points[i + 1];
    const segLen = this.cumulative[i + 1] - this.cumulative[i];
    const t = segLen > 0 ? (s - this.cumulative[i]) / segLen : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /** Unit heading at distance s. */
  headingAt(s: number): Vec2 {
    const i = this.segmentIndexAt(s);
    const a = this.points[i];
    const b = this.points[i + 1];
    const len = this.cumulative[i + 1] - this.cumulative[i];
    if (len === 0) return { x: 1, y: 0 };
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  }
}

/** Quadratic Bézier sampled at n+1 evenly spaced parameters (deterministic: only * and +). */
export function quadraticBezier(p0: Vec2, c: Vec2, p2: Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const w0 = u * u;
    const w1 = 2 * u * t;
    const w2 = t * t;
    out.push({ x: w0 * p0.x + w1 * c.x + w2 * p2.x, y: w0 * p0.y + w1 * c.y + w2 * p2.y });
  }
  return out;
}
