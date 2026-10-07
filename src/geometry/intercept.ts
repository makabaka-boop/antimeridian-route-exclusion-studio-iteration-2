import type { Fraction } from './fraction';
import type { MicroPoint } from './types';
import { frac, fromInt, add, sub, mul, div, lerp, cmp, eq, lt, gt, lte, gte, minF, maxF, wrapLon } from './fraction';
import { WORLD } from './unwrap';

const MICRO = 1_000_000n;
const UNIT: Fraction = frac(1n);
const ZERO: Fraction = frac(0n);
const WORLD_DEG: Fraction = frac(BigInt(WORLD), MICRO);

/** microdegree 整数转「度」分数。 */
export const md = (v: number | bigint): Fraction => frac(BigInt(v), MICRO);

/** 二维分数点 */
export interface FPoint {
  lat: Fraction;
  lon: Fraction;
}

/** 一段在某世界副本内的命中区间（局部参数 t∈[0,1]，闭区间，边界计入）。 */
export interface SegHit {
  segIndex: number;
  t0: Fraction;
  t1: Fraction;
  /** 命中来自的世界副本编号 k（禁区经度整体平移 360°·k） */
  copyK: number;
}

/** 相邻区间合并后的全局禁区区间 */
export interface GlobalInterval {
  s0: Fraction;
  s1: Fraction;
  enter: Witness;
  exit: Witness;
}

export interface Witness {
  /** 全局航路参数（点索引） */
  s: Fraction;
  segIndex: number;
  /** 段内局部参数 */
  t: Fraction;
  /** 展开平面上的位置（度） */
  lifted: FPoint;
  /** 归一化到 [-180,180) 的经度（度），用于画面 */
  geo: FPoint;
}

/** 向下取整为 Number（k 范围很小）。 */
const floorNum = (f: Fraction): number => {
  const q = f.n / f.d;
  const r = f.n % f.d;
  return Number(r < 0n ? q - 1n : q);
};

/** 检查航路展开后需要的世界副本 k，使平移后的禁区 bbox 与航段外包盒相交。 */
export function copyKsForSegment(
  zone: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  a: MicroPoint,
  b: MicroPoint,
): number[] {
  const segMinLat = Math.min(a.lat, b.lat);
  const segMaxLat = Math.max(a.lat, b.lat);
  if (segMaxLat < zone.minLat || segMinLat > zone.maxLat) return [];

  const segMinLon = md(Math.min(a.lon, b.lon));
  const segMaxLon = md(Math.max(a.lon, b.lon));
  const zMin = md(zone.minLon);
  const zMax = md(zone.maxLon);

  // zMin + 360k <= segMaxLon  →  k <= (segMaxLon - zMin)/360
  // zMax + 360k >= segMinLon  →  k >= (segMinLon - zMax)/360
  const kLo = div(sub(segMinLon, zMax), WORLD_DEG);
  const kHi = div(sub(segMaxLon, zMin), WORLD_DEG);
  const lo = Math.ceil(floorNum(kLo) - 1);
  const hi = Math.floor(floorNum(kHi) + 1);

  const ks: number[] = [];
  for (let k = lo; k <= hi; k++) {
    const shift = mul(WORLD_DEG, fromInt(k));
    if (lte(add(zMin, shift), segMaxLon) && gte(add(zMax, shift), segMinLon)) {
      ks.push(k);
    }
  }
  return ks;
}

/**
 * 凸多边形（CCW）裁剪参数线段 p(t)=a + (b-a)t，返回落在内部的 t 闭区间。
 * 每条有向边 e0→e1 的内侧满足 cross(e1-e0, p-e0) >= 0（边界计入）。
 * 全部比较用整数/分数精确完成；空集返回 null。
 */
export function clipSegmentWithConvex(
  a: FPoint,
  b: FPoint,
  poly: FPoint[],
): { t0: Fraction; t1: Fraction } | null {
  let lo: Fraction = ZERO;
  let hi: Fraction = UNIT;

  for (let i = 0; i < poly.length; i++) {
    const e0 = poly[i];
    const e1 = poly[(i + 1) % poly.length];
    const ex = sub(e1.lon, e0.lon);
    const ey = sub(e1.lat, e0.lat);
    const ax = sub(a.lon, e0.lon);
    const ay = sub(a.lat, e0.lat);
    const vx = sub(b.lon, a.lon);
    const vy = sub(b.lat, a.lat);
    // f(t) = cross(edge, p(t)-e0) = num + den*t
    const num = sub(mul(ex, ay), mul(ey, ax));
    const den = sub(mul(ex, vy), mul(ey, vx));

    if (eq(den, ZERO)) {
      // 与边平行：起点在外侧（严格）则整段在外
      if (lt(num, ZERO)) return null;
      continue;
    }
    // f(t)=0 的精确根
    const t = div(mul(num, fromInt(-1)), den);
    if (gt(den, ZERO)) {
      // f 递增：f>=0 要求 t >= root
      lo = maxF(lo, t);
    } else {
      // f 递减：f>=0 要求 t <= root
      hi = minF(hi, t);
    }
    if (cmp(lo, hi) > 0) return null;
  }
  return { t0: lo, t1: hi };
}

const pointAt = (a: MicroPoint, b: MicroPoint, t: Fraction): FPoint => ({
  lat: lerp(md(a.lat), md(b.lat), t),
  lon: lerp(md(a.lon), md(b.lon), t),
});

const makeWitness = (segIndex: number, t: Fraction, a: MicroPoint, b: MicroPoint): Witness => {
  const lifted = pointAt(a, b, t);
  return {
    s: add(fromInt(segIndex), t),
    segIndex,
    t,
    lifted,
    geo: { lat: lifted.lat, lon: wrapLon(lifted.lon) },
  };
};

/** 合并同一航段内来自不同世界副本的命中区间（区间相接即合并——边界属于禁区）。 */
export function mergeSegHits(hits: SegHit[]): SegHit[] {
  if (hits.length <= 1) return hits;
  const sorted = [...hits].sort((x, y) => cmp(x.t0, y.t0));
  const out: SegHit[] = [{ ...sorted[0] }];
  for (const h of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (lte(h.t0, last.t1)) {
      last.t1 = maxF(last.t1, h.t1);
    } else {
      out.push({ ...h });
    }
  }
  return out;
}

export interface AnalysisResult {
  /** 每段的命中区间（局部 t，已合并所有必要副本） */
  segHits: SegHit[][];
  /** 相邻区间合并后的全局区间及进入/离开见证 */
  intervals: GlobalInterval[];
}

/**
 * 主判定：航段与禁区均按展开后的经纬平面直线解释，检查必要的世界副本，
 * 整数方向判定 + 约分分数求每段位于禁区内的参数区间，边界计入。
 */
export function analyzeRoute(
  zonePts: MicroPoint[],
  zoneBox: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  routePts: MicroPoint[],
): AnalysisResult {
  const basePoly: FPoint[] = zonePts.map((p) => ({ lat: md(p.lat), lon: md(p.lon) }));

  const segHits: SegHit[][] = [];
  for (let i = 0; i < routePts.length - 1; i++) {
    const a = routePts[i];
    const b = routePts[i + 1];
    const hits: SegHit[] = [];
    for (const k of copyKsForSegment(zoneBox, a, b)) {
      const shift = mul(WORLD_DEG, fromInt(k));
      const poly = basePoly.map((p) => ({ lat: p.lat, lon: add(p.lon, shift) }));
      const fa: FPoint = { lat: md(a.lat), lon: md(a.lon) };
      const fb: FPoint = { lat: md(b.lat), lon: md(b.lon) };
      const clip = clipSegmentWithConvex(fa, fb, poly);
      if (clip) hits.push({ segIndex: i, t0: clip.t0, t1: clip.t1, copyK: k });
    }
    segHits.push(mergeSegHits(hits));
  }

  // 拍平为全局参数 s = segIndex + t，相邻（端点重合）即合并。
  type Flat = { s0: Fraction; s1: Fraction; seg0: number; t0: Fraction; seg1: number; t1: Fraction };
  const flat: Flat[] = [];
  segHits.forEach((hits, i) => {
    for (const h of hits) flat.push({ s0: add(fromInt(i), h.t0), s1: add(fromInt(i), h.t1), seg0: i, t0: h.t0, seg1: i, t1: h.t1 });
  });
  flat.sort((x, y) => cmp(x.s0, y.s0));

  const merged: Flat[] = [];
  for (const f of flat) {
    const last = merged[merged.length - 1];
    if (last && lte(f.s0, last.s1)) {
      if (gt(f.s1, last.s1)) {
        last.s1 = f.s1;
        last.seg1 = f.seg1;
        last.t1 = f.t1;
      }
    } else {
      merged.push({ ...f });
    }
  }

  const intervals: GlobalInterval[] = merged.map((m) => ({
    s0: m.s0,
    s1: m.s1,
    enter: makeWitness(m.seg0, m.t0, routePts[m.seg0], routePts[m.seg0 + 1]),
    exit: makeWitness(m.seg1, m.t1, routePts[m.seg1], routePts[m.seg1 + 1]),
  }));

  return { segHits, intervals };
}
