import { describe, it, expect } from 'vitest';
import type { MicroPoint, Zone } from './types';
import { createZone } from './zone';
import { createRoute } from './route';
import { analyzeRoute } from './intercept';
import { shortArcDelta, unwrapChain } from './unwrap';
import { compressRoute, checkCompressionEdge } from './compress';
import { cmp, eq, fromInt } from './fraction';

const d = (v: number): number => Math.round(v * 1_000_000);
const P = (lat: number, lon: number): MicroPoint => ({ lat: d(lat), lon: d(lon) });

const box = (latLo: number, latHi: number, lonLo: number, lonHi: number): MicroPoint[] => [
  P(latHi, lonLo), P(latHi, lonHi), P(latLo, lonHi), P(latLo, lonLo),
];

/**
 * 独立参照判定：不复用 compress.ts，只用短弧规则 + analyzeRoute 原语，
 * 判断两个现有航点连成的候选边是否安全（边界计入）。
 */
function refEdgeSafe(z: Zone, a: MicroPoint, b: MicroPoint): boolean {
  let delta: number;
  try {
    delta = shortArcDelta(b.lon, a.lon);
  } catch {
    return false; // 恰好 180°：只淘汰该边
  }
  if (a.lat === b.lat && delta === 0) return false;
  const lifted = [a, { lat: b.lat, lon: a.lon + delta }];
  return analyzeRoute(z.points, z, lifted).intervals.length === 0;
}

const lexLess = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
};

/** 枚举含首尾的全部子序列，独立求「段数最少、下标字典序最小」的最优解。 */
function bruteForce(z: Zone, route: MicroPoint[]): { feasible: boolean; kept: number[] | null } {
  const n = route.length;
  const safe: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) safe[i][j] = refEdgeSafe(z, route[i], route[j]);
  }
  let best: number[] | null = null;
  const m = n - 2;
  for (let mask = 0; mask < 1 << m; mask++) {
    const seq = [0];
    for (let k = 0; k < m; k++) if (mask & (1 << k)) seq.push(k + 1);
    seq.push(n - 1);
    let ok = true;
    for (let k = 0; k < seq.length - 1; k++) {
      if (!safe[seq[k]][seq[k + 1]]) { ok = false; break; }
    }
    if (ok && (best === null || seq.length < best.length || (seq.length === best.length && lexLess(seq, best)))) {
      best = seq;
    }
  }
  return best ? { feasible: true, kept: best } : { feasible: false, kept: null };
}

const expectMatchesBruteForce = (zRaw: MicroPoint[], route: MicroPoint[]) => {
  const z = createZone(zRaw);
  // 工作区本身合法（校验通道不抛错）
  expect(() => createRoute(route)).not.toThrow();
  const got = compressRoute(z, route);
  const ref = bruteForce(z, route);
  expect(got.feasible).toBe(ref.feasible);
  expect(got.kept).toEqual(ref.kept);
  if (ref.feasible) {
    expect(got.segmentCount).toBe(ref.kept!.length - 1);
    expect(got.kept![0]).toBe(0);
    expect(got.kept![got.kept!.length - 1]).toBe(route.length - 1);
    expect(got.previewPoints).toHaveLength(got.kept!.length);
    // 预演展开坐标 == 对保留下标原始点重新短弧展开
    const reUnwrap = unwrapChain(got.kept!.map((i) => route[i]));
    expect(got.previewPoints).toEqual(reUnwrap);
    // 预演线的每条航段再独立裁剪一次：全程不进入禁区
    for (let i = 0; i < got.previewPoints.length - 1; i++) {
      const an = analyzeRoute(z.points, z, [got.previewPoints[i], got.previewPoints[i + 1]]);
      expect(an.intervals).toHaveLength(0);
    }
  } else {
    // 无方案：明确报告，不交付部分航路
    expect(got.kept).toBeNull();
    expect(got.segmentCount).toBeNull();
    expect(got.previewPoints).toEqual([]);
    expect(got.message).toMatch(/无安全方案/);
  }
  return got;
};

describe('安全压缩：短航路枚举全部子序列核对最优性', () => {
  it('绕开盒子的折线：直连穿区，需保留一个绕行点', () => {
    // 禁区 lon[0,10] lat[0,10]；航路从西南到东北，折线绕到北侧
    const z = box(0, 10, 0, 10);
    const route = [P(-10, -10), P(20, 0), P(20, 10), P(20, 20)];
    expectMatchesBruteForce(z, route);
  });

  it('多余共线航点全部可删：最优就是首→尾一条边', () => {
    const z = box(0, 10, 0, 10);
    const route = [P(-5, -20), P(-5, -10), P(-5, 0), P(-5, 10), P(-5, 20)];
    const got = expectMatchesBruteForce(z, route);
    expect(got.kept).toEqual([0, 4]);
    expect(got.segmentCount).toBe(1);
  });

  it('字典序决胜：东西两条绕行路同为两段，选下标更小的西侧点', () => {
    // 竖墙禁区 lon[-10,10] lat[0,10]；1=西侧绕行点，2=东侧绕行点
    const z = box(0, 10, -10, 10);
    const route = [P(-20, 0), P(0, -30), P(0, 30), P(20, 0)];
    const got = expectMatchesBruteForce(z, route);
    expect(got.kept).toEqual([0, 1, 3]);
  });

  it('跨日界线禁区附近的多点航路（冗余点在禁区南侧）', () => {
    const z = [P(10, 170), P(10, -170), P(0, -170), P(0, 170)];
    const route = [P(-5, 160), P(-5, 170), P(-5, 175), P(-5, -175), P(-5, -160)];
    const got = expectMatchesBruteForce(z, route);
    expect(got.kept).toEqual([0, 4]);
  });

  it('两点航路：唯一子序列就是自身', () => {
    const z = box(0, 10, 0, 10);
    const got = expectMatchesBruteForce(z, [P(-10, -10), P(-10, 20)]);
    expect(got.kept).toEqual([0, 1]);
  });

  it('随机短航路与枚举参照逐例一致（含可行/不可行/并列）', () => {
    let seed = 0x12345678;
    const rnd = () => {
      // 确定性 LCG
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const zRaw = box(0, 12, -10, 10);
    const z = createZone(zRaw);
    let checked = 0;
    let feasibleCount = 0;
    for (let iter = 0; iter < 300 && checked < 120; iter++) {
      const n = 3 + Math.floor(rnd() * 4); // 3～6 点
      const route: MicroPoint[] = [];
      for (let i = 0; i < n; i++) {
        route.push(P(Math.round(-30 + rnd() * 60), Math.round(-30 + rnd() * 60)));
      }
      // 只在合法工作区上比较
      try {
        createRoute(route);
      } catch {
        continue;
      }
      const got = compressRoute(z, route);
      const ref = bruteForce(z, route);
      expect(got.feasible).toBe(ref.feasible);
      expect(got.kept).toEqual(ref.kept);
      if (got.feasible) feasibleCount++;
      checked++;
    }
    expect(checked).toBeGreaterThan(80);
    expect(feasibleCount).toBeGreaterThan(0);
  });
});

describe('安全压缩：日界线两侧等价经度', () => {
  const zA = [P(10, 170), P(10, -170), P(0, -170), P(0, 170)];
  // 同形状禁区，东侧录成 190
  const zB = [P(10, 170), P(10, 190), P(0, 190), P(0, 170)];

  it('170/-170 与 170/190 录入的航路给出相同保留下标', () => {
    const routeA = [P(-5, 160), P(-5, 170), P(-5, 175), P(-5, -175), P(-5, -160)];
    const routeB = [P(-5, 160), P(-5, 170), P(-5, 175), P(-5, 185), P(-5, 200)];
    const a = compressRoute(createZone(zA), routeA);
    const b = compressRoute(createZone(zB), routeB);
    expect(b.kept).toEqual(a.kept);
    expect(b.segmentCount).toBe(a.segmentCount);
    expect(b.previewPoints.map((q) => `${q.lat},${q.lon}`)).toEqual(
      a.previewPoints.map((q) => `${q.lat},${q.lon}`),
    );
  });

  it('对应候选边的安全判定与命中见证在两种经度表示下完全一致', () => {
    const routeA = [P(-5, 160), P(-5, 172), P(15, -172), P(-5, -160)];
    const routeB = [P(-5, 160), P(-5, 172), P(15, 188), P(-5, 200)];
    const ca = compressRoute(createZone(zA), routeA);
    const cb = compressRoute(createZone(zB), routeB);
    const ea = ca.edges.filter((e) => !e.safe);
    const eb = cb.edges.filter((e) => !e.safe);
    expect(ea.length).toBe(eb.length);
    const mapA = new Map(ea.map((e) => [`${e.from}-${e.to}`, e]));
    for (const e of eb) {
      const other = mapA.get(`${e.from}-${e.to}`);
      expect(other).toBeDefined();
      expect(e.reason).toBe(other!.reason);
      expect(e.hits?.intervals.length ?? 0).toBe(other!.hits?.intervals.length ?? 0);
      for (let k = 0; k < (e.hits?.intervals.length ?? 0); k++) {
        const iv = e.hits!.intervals[k];
        const ov = other!.hits!.intervals[k];
        expect(cmp(iv.enter.geo.lon, ov.enter.geo.lon)).toBe(0);
        expect(cmp(iv.exit.geo.lon, ov.exit.geo.lon)).toBe(0);
        expect(eq(iv.enter.geo.lat, ov.enter.geo.lat)).toBe(true);
      }
    }
  });
});

describe('安全压缩：边界擦过同样不可用', () => {
  const z = createZone(box(0, 20, 0, 20));

  it('只碰一个角点的候选边：判定不安全，命中区间退化为单点', () => {
    const c = checkCompressionEdge(z, P(-20, 20), P(0, 0));
    expect(c.safe).toBe(false);
    expect(c.reason).toBe('zone-hit');
    expect(c.hits!.intervals).toHaveLength(1);
    const iv = c.hits!.intervals[0];
    expect(cmp(iv.s0, iv.s1)).toBe(0); // 单点擦过
    expect(eq(iv.enter.geo.lon, fromInt(0))).toBe(true);
    expect(eq(iv.enter.geo.lat, fromInt(0))).toBe(true);
  });

  it('整体严格在禁区外的对照边安全', () => {
    const c = checkCompressionEdge(z, P(-20, 20), P(-1, -1));
    expect(c.safe).toBe(true);
    expect(c.hits).toBeNull();
  });

  it('贴着边界行走（共边一段）也不可用：压到禁区边上的捷径被淘汰', () => {
    // 禁区南边界 lat=0, lon[0,20]；候选边从 (0,-20) 到 (0,30) 沿西边界 lon=0 走，
    // lat∈[0,20] 一段压在禁区边上，必须判不安全
    const c = checkCompressionEdge(z, P(0, -20), P(0, 30));
    expect(c.safe).toBe(false);
    expect(c.reason).toBe('zone-hit');
    expect(c.hits!.intervals.length).toBeGreaterThan(0);
    // 该命中是一段非退化区间（不是单点）：进入 t=2/5、离开 t=4/5
    const iv = c.hits!.intervals[0];
    expect(cmp(iv.s0, iv.s1)).toBe(-1);
    expect(cmp(iv.enter.t, fromInt(0))).not.toBe(0);
  });

  it('绕行路径的整体最优性与枚举一致（边界擦过迫使选择外侧点）', () => {
    // 0→2 沿 lon=0 压禁区西边界，必须改走西侧点 1
    const zRaw = box(0, 20, 0, 20);
    const route = [P(-20, 0), P(-20, -20), P(30, 0)];
    const got = expectMatchesBruteForce(zRaw, route);
    expect(got.kept).toEqual([0, 1, 2]);
  });
});

describe('安全压缩：恰好 180° 的候选边只淘汰该边', () => {
  const zRaw = [P(10, 170), P(10, -170), P(0, -170), P(0, 170)];

  it('非相邻点相差整 180°：原工作区仍然有效，仅该候选边标为歧义', () => {
    // 全部航点在 lat=-20（禁区南侧），原航路相邻短弧合法；
    // 点0(lon0)→点3(lon180) 恰好相差 180°。
    const route = [P(-20, 0), P(-20, 170), P(-20, -170), P(-20, 180)];
    expect(() => createZone(zRaw)).not.toThrow();
    expect(() => createRoute(route)).not.toThrow();

    const c = compressRoute(createZone(zRaw), route);
    const edge03 = c.edges.find((e) => e.from === 0 && e.to === 3)!;
    expect(edge03.safe).toBe(false);
    expect(edge03.reason).toBe('ambiguous-180');
    expect(edge03.hits).toBeNull();

    // 其余候选边照常判定，方案仍可行（绕开歧义边）
    expect(c.feasible).toBe(true);
    for (let i = 0; i < c.kept!.length - 1; i++) {
      expect(c.kept![i] === 0 && c.kept![i + 1] === 3).toBe(false);
    }
  });

  it('180° 歧义边不影响枚举最优性核对', () => {
    const route = [P(-20, 0), P(-20, 170), P(-20, -170), P(-20, 180)];
    expectMatchesBruteForce(zRaw, route);
  });

  it('零长度候选边（同一经线、相差整 360°）只淘汰该边', () => {
    const z = createZone(box(0, 10, 0, 10));
    const c = checkCompressionEdge(z, P(5, 0), P(5, 360));
    expect(c.safe).toBe(false);
    expect(c.reason).toBe('zero-length');
  });
});

describe('安全压缩：不可行结果明确报告', () => {
  it('首点落在禁区内：任何含首尾的子序列都不安全', () => {
    const zRaw = box(0, 20, 0, 20);
    const route = [P(5, 5), P(25, 5)];
    const got = expectMatchesBruteForce(zRaw, route);
    expect(got.feasible).toBe(false);
    expect(got.message).toMatch(/不交付任何部分航路/);
  });

  it('禁区墙隔开首尾且无绕行点：两点航路直连穿区即不可行', () => {
    const zRaw = box(0, 10, -10, 10);
    const route = [P(-20, 0), P(20, 0)];
    expect(() => createRoute(route)).not.toThrow();
    const got = compressRoute(createZone(zRaw), route);
    expect(got.feasible).toBe(false);
    expect(got.kept).toBeNull();
    // 原航路工作区不受影响：原命中区间仍照常给出（原口径）
    const z = createZone(zRaw);
    const an = analyzeRoute(z.points, z, createRoute(route).points);
    expect(an.intervals.length).toBeGreaterThan(0);
  });
});
