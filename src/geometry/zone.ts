import { ValidationError, type MicroPoint, type Zone } from './types';
import { assertCoord, shortArcDelta, unwrapChain, HALF_WORLD } from './unwrap';

/** 整数叉积 (b-a) × (c-a)：零表示共线，正数表示 c 在有向边 a→b 左侧（CCW 内侧）。 */
export function cross(a: MicroPoint, b: MicroPoint, c: MicroPoint): bigint {
  return (
    BigInt(b.lon - a.lon) * BigInt(c.lat - a.lat) -
    BigInt(b.lat - a.lat) * BigInt(c.lon - a.lon)
  );
}

/** 有向线段 p1→p2 与 p3→p4 是否相交（含端点、含共线重叠）——纯整数方向判定。 */
export function segmentsIntersect(p1: MicroPoint, p2: MicroPoint, p3: MicroPoint, p4: MicroPoint): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);

  if (((d1 > 0n && d2 < 0n) || (d1 < 0n && d2 > 0n)) &&
      ((d3 > 0n && d4 < 0n) || (d3 < 0n && d4 > 0n))) {
    return true;
  }
  // 落在边界上的情况（端点接触/共线重叠）
  const onSeg = (p: MicroPoint, a: MicroPoint, b: MicroPoint): boolean =>
    Math.min(a.lon, b.lon) <= p.lon && p.lon <= Math.max(a.lon, b.lon) &&
    Math.min(a.lat, b.lat) <= p.lat && p.lat <= Math.max(a.lat, b.lat);
  if (d1 === 0n && onSeg(p1, p3, p4)) return true;
  if (d2 === 0n && onSeg(p2, p3, p4)) return true;
  if (d3 === 0n && onSeg(p3, p1, p2)) return true;
  if (d4 === 0n && onSeg(p4, p1, p2)) return true;
  return false;
}

/**
 * 校验凸禁区并构造展开后的平面多边形：
 * - 3～20 个整数坐标顶点，纬度 ±80°、经度 ±540°；
 * - 相邻经度（含闭合边）按短弧展开，恰好 180° 的边拒绝（闭合边过宽也拒绝）；
 * - 拒绝零长度边、自交、非凸（允许边上的共线点）、退化零面积。
 * 输出统一为逆时针（CCW）顺序。
 */
export function createZone(raw: ReadonlyArray<MicroPoint>): Zone {
  if (!Array.isArray(raw)) throw new ValidationError('禁区顶点必须是数组');
  if (raw.length < 3 || raw.length > 20) {
    throw new ValidationError('禁区顶点数必须在 3～20 之间');
  }
  raw.forEach(assertCoord);

  const pts = unwrapChain(raw);

  // 闭合边也必须走短弧（且不能恰好 180°）。正常凸多边形跨度 < 180° 时此差与短弧一致；
  // 顶点顺序绕到世界另一侧、或闭合跨度 ≥180° 时在此被拒绝。
  const closeDelta = shortArcDelta(pts[0].lon, pts[pts.length - 1].lon);
  if (pts[pts.length - 1].lon + closeDelta !== pts[0].lon) {
    throw new ValidationError('闭合边不是相邻经度的短弧展开（跨越 ≥180°，或跨线闭合环方向错误），拒绝');
  }

  // 零长度边
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a.lat === b.lat && a.lon === b.lon) {
      throw new ValidationError(`第 ${i + 1} 条边长度为零（相邻顶点重合）`);
    }
  }

  // 凸性：连续叉积符号一致（允许共线点）
  const n = pts.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = cross(pts[i], pts[(i + 1) % n], pts[(i + 2) % n]);
    if (c === 0n) continue;
    const s = c > 0n ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) {
      throw new ValidationError('禁区非凸：连续转向符号不一致');
    }
  }
  if (sign === 0) throw new ValidationError('禁区退化：全部顶点共线，面积为零');

  // 自交检查（整数方向判定）：所有非相邻边对。
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = (i + 1) % n === j || (j + 1) % n === i;
      if (adjacent) continue;
      if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) {
        throw new ValidationError('禁区自交：非相邻边相交');
      }
    }
  }

  const ordered: MicroPoint[] = sign > 0 ? pts : [...pts].reverse();

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of ordered) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  if (maxLon - minLon >= HALF_WORLD) {
    throw new ValidationError('禁区经度跨度 ≥180°：世界副本会重叠，解释歧义，拒绝');
  }

  return { points: ordered, minLat, maxLat, minLon, maxLon };
}
