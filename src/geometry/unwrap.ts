import { ValidationError } from './types';

/** 单位：百万分之一度 */
export const MAX_LAT = 80_000_000;
export const MIN_LAT = -80_000_000;
export const MAX_LON = 540_000_000;
export const MIN_LON = -540_000_000;
export const HALF_WORLD = 180_000_000; // 恰好相差 180° 的边是歧义边
export const WORLD = 360_000_000;

/**
 * 把 lon 短弧修正到 prev 附近：返回 (-180°, 180°) 内的差值（百万分之一度）。
 * 恰好 ±180° 拒绝——两个世界副本给出的解释不同，无法判定。
 */
export function shortArcDelta(lon: number, prev: number): number {
  let d = lon - prev;
  while (d <= -HALF_WORLD) d += WORLD;
  while (d >= HALF_WORLD) d -= WORLD;
  if (Math.abs(d) === HALF_WORLD) {
    throw new ValidationError('相邻经度恰好相差 180°：边在日界线两侧等价但解释歧义，拒绝录入');
  }
  return d;
}

/**
 * 按相邻经度短弧展开一条点序列（可变 lon，lat 原样保留）。
 * 起点保持原始数值，使「±180° 两侧等价表示」展开到同一条折线。
 */
export function unwrapChain(pts: ReadonlyArray<{ lat: number; lon: number }>): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      out.push({ lat: pts[i].lat, lon: pts[i].lon });
    } else {
      const prev = out[i - 1].lon;
      out.push({ lat: pts[i].lat, lon: prev + shortArcDelta(pts[i].lon, prev) });
    }
  }
  return out;
}

/** 整数（microdegree）范围校验。 */
export function assertCoord(p: unknown): asserts p is { lat: number; lon: number } {
  if (typeof p !== 'object' || p === null) throw new ValidationError('坐标必须是对象 {lat, lon}');
  const q = p as { lat?: unknown; lon?: unknown };
  if (typeof q.lat !== 'number' || typeof q.lon !== 'number') {
    throw new ValidationError('纬度、经度必须是数字（百万分之一度整数）');
  }
  if (!Number.isInteger(q.lat) || !Number.isInteger(q.lon)) {
    throw new ValidationError('坐标必须是整数百万分之一度');
  }
  if (q.lat < MIN_LAT || q.lat > MAX_LAT) {
    throw new ValidationError(`纬度 ${q.lat} 超出 ±80°（±80000000）`);
  }
  if (q.lon < MIN_LON || q.lon > MAX_LON) {
    throw new ValidationError(`经度 ${q.lon} 超出 ±540°（±540000000）`);
  }
}
