import { describe, it, expect } from 'vitest';
import type { MicroPoint } from './types';
import { createZone } from './zone';
import { createRoute } from './route';
import { analyzeRoute } from './intercept';
import { buildRoutePieces, buildZonePieces } from './display';
import { cmp, eq, fromInt, toNumber, frac } from './fraction';

const d = (v: number): number => Math.round(v * 1_000_000);
const P = (lat: number, lon: number): MicroPoint => ({ lat: d(lat), lon: d(lon) });

/** 等距圆柱投影（与 Chart.tsx 相同，W=1080）下的 x 坐标 */
const xProj = (lonDeg: number): number => ((lonDeg - -180) / 360) * 1080;

/** 把「原始点 → 校验 → 分析 → 画面分段」整条通道跑一遍，任何异常都会让用例失败。 */
function pipeline(zone: MicroPoint[], route: MicroPoint[]) {
  const z = createZone(zone);
  const r = createRoute(route);
  const a = analyzeRoute(z.points, z, r.points);
  const routePieces = buildRoutePieces(r.points, a.segHits);
  const zonePieces = buildZonePieces(z.points);
  return { z, r, a, routePieces, zonePieces };
}

/** 收集所有命中画面段的数值端点（度）。 */
const drawnLines = (routePieces: ReturnType<typeof buildRoutePieces>) =>
  routePieces.flatMap((pc) =>
    pc.geo.map((s) => ({
      lon0: toNumber(s.p0.lon),
      lat0: toNumber(s.p0.lat),
      lon1: toNumber(s.p1.lon),
      lat1: toNumber(s.p1.lat),
    })),
  );

describe('验收一：经度不变、纬度穿过禁区的竖直命中段', () => {
  // 禁区 172°E～183°（177°W），0°～10°N；航路沿 175°E 从 5°S 竖直穿到 15°N。
  const zone = [P(10, 172), P(10, 183), P(0, 183), P(0, 172)];
  const route = [P(-5, 175), P(15, 175)];

  it('整页分析与分段不抛异常', () => {
    expect(() => pipeline(zone, route)).not.toThrow();
  });

  it('命中参数：t∈[1/4, 3/4]（0° 进入、10° 离开）', () => {
    const { a } = pipeline(zone, route);
    expect(a.intervals).toHaveLength(1);
    expect(a.segHits[0]).toHaveLength(1);
    expect(cmp(a.segHits[0][0].t0, frac(1n, 4n))).toBe(0);
    expect(cmp(a.segHits[0][0].t1, frac(3n, 4n))).toBe(0);
    const iv = a.intervals[0];
    expect(eq(iv.enter.geo.lat, fromInt(0))).toBe(true);
    expect(eq(iv.exit.geo.lat, fromInt(10))).toBe(true);
    expect(eq(iv.enter.geo.lon, fromInt(175))).toBe(true);
    expect(eq(iv.exit.geo.lon, fromInt(175))).toBe(true);
  });

  it('画面只有一个竖直片段，端点与见证一致，且不跨日界线', () => {
    const { routePieces, a } = pipeline(zone, route);
    expect(routePieces).toHaveLength(1);
    const lines = drawnLines(routePieces);
    expect(lines).toHaveLength(1);
    expect(lines[0].lon0).toBeCloseTo(175, 6);
    expect(lines[0].lon1).toBeCloseTo(175, 6);
    expect(lines[0].lat0).toBeCloseTo(0, 6);
    expect(lines[0].lat1).toBeCloseTo(10, 6);
    // 投影上不成横线、更不横跨整图
    expect(Math.abs(xProj(lines[0].lon1) - xProj(lines[0].lon0))).toBe(0);
    // 画面端点集合包含进入/离开见证
    const iv = a.intervals[0];
    const endpoints = lines.flatMap((l) => [`${l.lat0.toFixed(6)},${l.lon0.toFixed(6)}`, `${l.lat1.toFixed(6)},${l.lon1.toFixed(6)}`]);
    for (const w of [iv.enter.geo, iv.exit.geo]) {
      expect(endpoints).toContain(`${toNumber(w.lat).toFixed(6)},${toNumber(w.lon).toFixed(6)}`);
    }
  });
});

describe('验收二：跨线航段的非对称命中子区间', () => {
  // 航路 170°E→190°（170°W），禁区 172°E→183°（177°W）；
  // 区间表给出整段参数 0.1（172°）到 0.65（183°）。
  const zone = [P(10, 172), P(10, 183), P(0, 183), P(0, 172)];
  const route = [P(5, 170), P(5, 190)];

  it('整页分析与分段不抛异常', () => {
    expect(() => pipeline(zone, route)).not.toThrow();
  });

  it('命中参数恰为 1/10 到 13/20（0.1、0.65 的约分分数）', () => {
    const { a } = pipeline(zone, route);
    expect(a.segHits[0]).toHaveLength(1);
    const h = a.segHits[0][0];
    expect(cmp(h.t0, frac(1n, 10n))).toBe(0);
    expect(cmp(h.t1, frac(13n, 20n))).toBe(0);
    const iv = a.intervals[0];
    expect(eq(iv.enter.geo.lon, fromInt(172))).toBe(true);
    expect(eq(iv.exit.geo.lon, fromInt(-177))).toBe(true);
  });

  it('日界线两侧各一个短片段：172→180 与 -180→-177，片数与端点精确', () => {
    const { routePieces } = pipeline(zone, route);
    expect(routePieces).toHaveLength(1);
    const lines = drawnLines(routePieces);
    expect(lines).toHaveLength(2);
    // 按 x 排序后断言（西侧片在右缘、东侧片在左缘，顺序不做假设）
    const byLon0 = [...lines].sort((u, v) => v.lon0 - u.lon0);
    expect(byLon0[0].lon0).toBeCloseTo(172, 6);
    expect(byLon0[0].lon1).toBeCloseTo(180, 6);
    expect(byLon0[1].lon0).toBeCloseTo(-180, 6);
    expect(byLon0[1].lon1).toBeCloseTo(-177, 6);
    for (const l of lines) {
      expect(l.lat0).toBeCloseTo(5, 6);
      expect(l.lat1).toBeCloseTo(5, 6);
    }
  });

  it('SVG 投影中不出现横跨整图的命中线（片段投影宽度 ≪ 半幅）', () => {
    const { routePieces } = pipeline(zone, route);
    for (const l of drawnLines(routePieces)) {
      const width = Math.abs(xProj(l.lon1) - xProj(l.lon0));
      // 西侧 8°、东侧 3°；无论如何不可能达到跨图的 ~1020px
      expect(width).toBeLessThan(180 / 360 * 1080);
      expect(width).toBeCloseTo((Math.abs(l.lon1 - l.lon0) / 360) * 1080, 6);
    }
  });

  it('等价经度表示（终点录成 -170°）给出相同片与端点', () => {
    const a = pipeline(zone, route);
    const b = pipeline(zone, [P(5, 170), P(5, -170)]);
    const la = drawnLines(a.routePieces).map((l) => `${l.lon0},${l.lon1}`).sort();
    const lb = drawnLines(b.routePieces).map((l) => `${l.lon0},${l.lon1}`).sort();
    expect(lb).toEqual(la);
    expect(cmp(b.a.intervals[0].s0, a.a.intervals[0].s0)).toBe(0);
    expect(cmp(b.a.intervals[0].s1, a.a.intervals[0].s1)).toBe(0);
  });
});

describe('验收三：禁区仅以一条边贴住 180°（不跨线）', () => {
  // 禁区 170°E～180°，0°～10°N；东边界恰好贴在日界线上，本体完全在西半球侧。
  const zone = [P(10, 170), P(10, 180), P(0, 180), P(0, 170)];

  it('整页分析与分段不抛异常，且只有实际占地的一片，无零面积幽灵片', () => {
    expect(() => pipeline(zone, [P(5, 175), P(5, 180)])).not.toThrow();
    const { zonePieces } = pipeline(zone, [P(5, 175), P(5, 180)]);
    expect(zonePieces).toHaveLength(1);
    const lons = zonePieces[0].points.map((q) => toNumber(q.lon));
    expect(Math.max(...lons)).toBeCloseTo(180, 6);
    expect(Math.min(...lons)).toBeCloseTo(170, 6);
  });

  it('对侧（-180° 边缘附近）不出现任何禁区顶点', () => {
    const { zonePieces } = pipeline(zone, [P(5, 175), P(5, 180)]);
    const allLons = zonePieces.flatMap((pc) => pc.points.map((q) => toNumber(q.lon)));
    expect(allLons.every((x) => x > 0)).toBe(true);
  });

  it('边界命中语义不变：航路止于贴线边（闭区间，边界计入）仍命中且分数输出不变', () => {
    const { a } = pipeline(zone, [P(5, 175), P(5, 180)]);
    expect(a.intervals).toHaveLength(1);
    const iv = a.intervals[0];
    // 从 175 到 180 全段在禁区内：s∈[0,1]，离开见证落在 180° 边上（归一化为 -180°）
    expect(cmp(iv.s0, frac(0n))).toBe(0);
    expect(cmp(iv.s1, frac(1n))).toBe(0);
    expect(eq(iv.exit.geo.lon, fromInt(-180))).toBe(true);
    // 分数原样约分输出
    expect(`${iv.enter.t.n}/${iv.enter.t.d}`).toBe('0/1');
    expect(`${iv.exit.t.n}/${iv.exit.t.d}`).toBe('1/1');
  });

  it('贴线禁区与跨线禁区的片数可区分：跨线同形状（170～190）仍是两片', () => {
    const z = createZone([P(10, 170), P(10, 190), P(0, 190), P(0, 170)]);
    expect(buildZonePieces(z.points)).toHaveLength(2);
  });
});

describe('验收四：非跨线航段兼容性', () => {
  const zone = [P(10, 0), P(10, 10), P(0, 10), P(0, 0)];

  it('普通水平航段不切分，单片段端点即见证', () => {
    const { a, routePieces } = pipeline(zone, [P(5, -5), P(5, 15)]);
    expect(a.segHits[0]).toHaveLength(1);
    expect(cmp(a.segHits[0][0].t0, frac(1n, 4n))).toBe(0);
    expect(cmp(a.segHits[0][0].t1, frac(3n, 4n))).toBe(0);
    const lines = drawnLines(routePieces);
    expect(lines).toHaveLength(1);
    expect(lines[0].lon0).toBeCloseTo(0, 6);
    expect(lines[0].lon1).toBeCloseTo(10, 6);
  });

  it('普通竖直航段（不跨线）同样不抛异常、不切分', () => {
    const { routePieces } = pipeline(zone, [P(-5, 5), P(15, 5)]);
    const lines = drawnLines(routePieces);
    expect(lines).toHaveLength(1);
    expect(lines[0].lat0).toBeCloseTo(0, 6);
    expect(lines[0].lat1).toBeCloseTo(10, 6);
  });
});
