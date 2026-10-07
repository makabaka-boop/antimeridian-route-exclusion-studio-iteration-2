import { describe, it, expect } from 'vitest';
import type { MicroPoint } from './types';
import { ValidationError } from './types';
import { createZone } from './zone';
import { createRoute } from './route';
import { analyzeRoute } from './intercept';
import { buildRoutePieces, buildZonePieces, splitSubAtDateline } from './display';
import { frac, cmp, eq, fromInt, toNumber } from './fraction';

const d = (v: number): number => Math.round(v * 1_000_000);
const P = (lat: number, lon: number): MicroPoint => ({ lat: d(lat), lon: d(lon) });

const crossingBoxCW: MicroPoint[] = [P(10, 170), P(10, -170), P(0, -170), P(0, 170)];
const eastRoute: MicroPoint[] = [P(5, 150), P(5, -150)];

function run(zone: MicroPoint[], route: MicroPoint[]) {
  const z = createZone(zone);
  const r = createRoute(route);
  return { z, r, a: analyzeRoute(z.points, z, r.points) };
}

describe('禁区校验', () => {
  it('拒绝非凸多边形', () => {
    const concave = [P(0, 0), P(20, 0), P(5, 10), P(20, 20), P(0, 20)];
    expect(() => createZone(concave)).toThrow(ValidationError);
  });

  it('拒绝自交蝴蝶结（转向交替，非凸检查拦截）', () => {
    const bowtie = [P(-10, -10), P(10, 10), P(-10, 10), P(10, -10)];
    expect(() => createZone(bowtie)).toThrow(/非凸/);
  });

  it('非相邻边接触的构造也被拒绝', () => {
    const touch = [P(0, 0), P(20, 20), P(20, 0), P(0, 20)];
    expect(() => createZone(touch)).toThrow(ValidationError);
  });

  it('拒绝恰好 180° 的边（歧义）', () => {
    // 矩形一条长边短弧差恰为 180°（179°E 到 1°W 展开成 +180）
    expect(() => createZone([P(10, 179), P(10, -1), P(0, -1), P(0, 179)])).toThrow(/180/);
    expect(() => createZone([P(0, 0), P(0, 180), P(10, 10)])).toThrow(/180/);
  });

  it('拒绝坐标超界与顶点数越界', () => {
    expect(() => createZone([P(90, 0), P(0, 0), P(0, 10)])).toThrow(/纬度/);
    expect(() => createZone([P(0, 0), P(0, 600), P(10, 10)])).toThrow(/经度/);
    expect(() => createZone([P(0, 0), P(0, 10)])).toThrow(/3～20/);
  });

  it('顺时针跨日界线矩形被统一翻转为逆时针', () => {
    const z = createZone(crossingBoxCW);
    // CCW 检查：第一、二条相邻边叉积为正
    const { points } = z;
    const cr =
      BigInt(points[1].lon - points[0].lon) * BigInt(points[2].lat - points[0].lat) -
      BigInt(points[1].lat - points[0].lat) * BigInt(points[2].lon - points[0].lon);
    expect(cr > 0n).toBe(true);
  });

  it('允许边上共线点（仍为凸、面积非零）', () => {
    expect(() => createZone([P(0, 0), P(10, 0), P(20, 0), P(20, 20), P(0, 20)])).not.toThrow();
  });
});

describe('两侧经度等价表示', () => {
  it('170/-170 与 170/190 给出完全相同的展开禁区', () => {
    const a = createZone(crossingBoxCW);
    const b = createZone([P(10, 170), P(10, 190), P(0, 190), P(0, 170)]);
    expect(b.points.map((p) => `${p.lat},${p.lon}`)).toEqual(a.points.map((p) => `${p.lat},${p.lon}`));
  });

  it('航路 150→-150 与 150→210 的拦截区间一致', () => {
    const a = run(crossingBoxCW, eastRoute).a;
    const b = run(crossingBoxCW, [P(5, 150), P(5, 210)]).a;
    expect(b.intervals.length).toBe(a.intervals.length);
    expect(cmp(b.intervals[0].s0, a.intervals[0].s0)).toBe(0);
    expect(cmp(b.intervals[0].s1, a.intervals[0].s1)).toBe(0);
  });
});

describe('跨日界线拦截', () => {
  it('横穿航路：展开后从 150°E 向东 60° 到 210°（即 150°W），在 170°E 进入、190°（170°W）离开', () => {
    const { a } = run(crossingBoxCW, eastRoute);
    expect(a.intervals).toHaveLength(1);
    const iv = a.intervals[0];
    expect(cmp(iv.enter.t, frac(1n, 3n))).toBe(0);
    expect(cmp(iv.exit.t, frac(2n, 3n))).toBe(0);
    expect(eq(iv.enter.geo.lon, fromInt(170))).toBe(true);
    expect(eq(iv.exit.geo.lon, fromInt(-170))).toBe(true);
    expect(eq(iv.enter.geo.lat, fromInt(5))).toBe(true);
  });

  it('世界副本外的航路无命中', () => {
    const { a } = run(crossingBoxCW, [P(5, 100), P(5, 140)]);
    expect(a.intervals).toHaveLength(0);
  });

  it('副本数恰好为必要值：纯竖直航段只在一个世界副本内命中', () => {
    const { a } = run(crossingBoxCW, [P(5, 190), P(-5, 190)]);
    // 190° == -170°，在边界上（矩形边界），应恰好命中一次（区间不被重复副本叠加）
    expect(a.intervals.length).toBe(1);
    expect(a.segHits[0]).toHaveLength(1);
  });
});

describe('顶点擦过', () => {
  it('只接触一个顶点：两段沿两条边的外向延长线在矩形角点擦过，合并为单点区间', () => {
    // 矩形 0°~20°，西南角 (lat0, lon0)：南段沿西边界外向延长，西段沿南边界外向延长
    const box = [P(0, 0), P(20, 0), P(20, 20), P(0, 20)];
    const route = [P(-20, 0), P(0, 0), P(0, -20)];
    const { a } = run(box, route);
    expect(a.intervals).toHaveLength(1);
    const iv = a.intervals[0];
    expect(cmp(iv.s0, iv.s1)).toBe(0);
    expect(cmp(iv.enter.t, frac(1n))).toBe(0);
    expect(eq(iv.enter.geo.lat, fromInt(0))).toBe(true);
    expect(eq(iv.enter.geo.lon, fromInt(0))).toBe(true);
  });

  it('从顶点旁边经过（严格外侧）无命中', () => {
    const box = [P(0, 0), P(20, 0), P(20, 20), P(0, 20)];
    // 擦过折线整体向西南平移 1°，全程严格在外
    const route = [P(-20, -1), P(0, -21)];
    const { a } = run(box, route);
    expect(a.intervals).toHaveLength(0);
  });
});

describe('沿边行走', () => {
  it('与边界重合的整段计入禁区，延长线上的部分不计入', () => {
    const box = [P(0, 0), P(20, 0), P(20, 20), P(0, 20)];
    const route = [P(10, -20), P(10, 0), P(10, 20), P(10, 40)];
    const { a } = run(box, route);
    // 段0 端点接触 → 单点；段1 全段；段2 端点接触；相邻区间在航路点相接合并为一个
    expect(a.intervals).toHaveLength(1);
    const iv = a.intervals[0];
    // 段1（点1→点2）沿边 lon=10 从 lat0 到 20 全段在内：s∈[1,2]
    expect(cmp(iv.s0, fromInt(1))).toBe(0);
    expect(cmp(iv.s1, fromInt(2))).toBe(0);
  });
});

describe('跨线闭合环（多段航路）', () => {
  it('在 180° 两侧各进入一次，中间离开把区间分开', () => {
    const route = [P(5, 160), P(5, 175), P(5, -175), P(5, -160), P(-10, -160), P(-10, 160)];
    const { a } = run(crossingBoxCW, route);
    // 段0：160→175，170~175 在内；段1 全段；段2 全段；段3 到-160 出禁区；段4/5 在禁区外
    expect(a.intervals).toHaveLength(1);
    const iv = a.intervals[0];
    // 进入 s0 = 0 + (170-160)/(175-160) = 2/3
    expect(cmp(iv.s0, frac(2n, 3n))).toBe(0);
    // 段3：175 unwrap→185，-160 unwrap→200（短弧 +15），禁区展开到 190，
    // 离开参数 t=(190-185)/15=1/3，s1=3+1/3=7/3
    expect(cmp(iv.s1, frac(7n, 3n))).toBe(0);
  });
});

describe('画面分段与区间表同源', () => {
  it('被截航路在日界线处切成两段，各自落在窗口两侧', () => {
    const { r, a } = run(crossingBoxCW, eastRoute);
    const pieces = buildRoutePieces(r.points, a.segHits);
    expect(pieces).toHaveLength(1);
    const segs = pieces[0].geo;
    // 命中区间 t∈[1/3,2/3]（lon 170→190），内部在 lon=180 穿越一次 → 两个画面段；
    // 切点必须贴住各自一侧的窗口边缘（西侧 +180°、东侧 −180°），不得连成横跨整图的长线
    expect(segs).toHaveLength(2);
    expect(toNumber(segs[0].p0.lon)).toBeCloseTo(170, 6);
    expect(toNumber(segs[0].p1.lon)).toBeCloseTo(180, 6);
    expect(toNumber(segs[1].p0.lon)).toBeCloseTo(-180, 6);
    expect(toNumber(segs[1].p1.lon)).toBeCloseTo(-170, 6);
    for (const s of segs) {
      expect(Math.abs(toNumber(s.p1.lon) - toNumber(s.p0.lon))).toBeLessThan(180);
    }
  });

  it('禁区在日界线处切成两个闭合多边形片，分居左右边缘', () => {
    const z = createZone(crossingBoxCW);
    const pieces = buildZonePieces(z.points);
    expect(pieces).toHaveLength(2);
    const allLons = pieces.flatMap((p) => p.points.map((q) => toNumber(q.lon)));
    expect(Math.max(...allLons)).toBeGreaterThan(169);
    expect(Math.min(...allLons)).toBeLessThan(-169);
  });

  it('splitSubAtDateline 对不跨线区间不切分', () => {
    const z = createZone([P(0, 0), P(10, 0), P(10, 10), P(0, 10)]);
    const r = createRoute([P(5, -5), P(5, 5)]);
    const a = analyzeRoute(z.points, z, r.points);
    const subs = splitSubAtDateline(r.points[0], r.points[1], a.segHits[0][0].t0, a.segHits[0][0].t1);
    expect(subs).toHaveLength(1);
  });

  it('画面段经纬度并集 == 区间表区间的参数点像（参数级一致性）', () => {
    const { r, a } = run(crossingBoxCW, eastRoute);
    const pieces = buildRoutePieces(r.points, a.segHits);
    const drawn = new Set<string>();
    for (const piece of pieces) {
      for (const seg of piece.geo) {
        for (const p of [seg.p0, seg.p1]) {
          drawn.add(`${toNumber(p.lat).toFixed(6)},${toNumber(p.lon).toFixed(6)}`);
        }
      }
    }
    for (const iv of a.intervals) {
      for (const w of [iv.enter.geo, iv.exit.geo]) {
        expect(drawn.has(`${toNumber(w.lat).toFixed(6)},${toNumber(w.lon).toFixed(6)}`)).toBe(true);
      }
    }
  });
});

describe('必要的世界副本与边界表示', () => {
  it('航路点直接用 +540° 边界录入（与 180° 等价，卷绕到 -180°）', () => {
    // 510° = 150°E 短弧展开；540° 与 -180° 同一经线
    const { a } = run(crossingBoxCW, [P(5, 510), P(5, 540)]);
    expect(a.intervals).toHaveLength(1);
    const iv = a.intervals[0];
    expect(eq(iv.exit.geo.lon, fromInt(-180))).toBe(true);
  });

  it('一条航段在两个世界副本中的命中区间分别记录（不相互吞并）', () => {
    // 宽 30° 禁区 [160..190]（跨线），航段从 170° 向西画到 170°E 绕世界一整圈不可能由单段表达；
    // 改为：竖直航段在副本边界 lon=190（=-170）上命中时只属于一个副本；
    // 水平航段 170→185 只在 k=0 命中，不产生 k=-1 的重复。
    const { a } = run(crossingBoxCW, [P(5, 170), P(5, 185)]);
    expect(a.segHits[0]).toHaveLength(1);
    expect(cmp(a.intervals[0].s0, frac(0n))).toBe(0);
    expect(cmp(a.intervals[0].s1, frac(1n))).toBe(0);
  });

  it('跨线闭合环：展开后经度跨度 ≥180° 的凸多边形拒绝（世界副本重叠歧义）', () => {
    // 相邻短弧差均 <180°，但矩形宽度恰为 180°：170°E 到 350°E（-10°）
    expect(() => createZone([P(10, 170), P(10, -10), P(0, -10), P(0, 170)])).toThrow(/180|跨度/);
  });

  it('正常跨线闭合环通过校验，且在日界线两侧各成一片', () => {
    const z = createZone([P(10, -170), P(10, 170), P(0, 170), P(0, -170)]);
    expect(buildZonePieces(z.points)).toHaveLength(2);
  });
});
