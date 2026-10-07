import { describe, it, expect } from 'vitest';
import type { MicroPoint, Zone } from './types';
import { createZone } from './zone';
import { createRoute } from './route';
import { analyzeRoute, md } from './intercept';
import { compressRoute, checkCandidateEdge, lexCmp, type CompressResult } from './compress';
import { unwrapChain } from './unwrap';
import { cmp, fromInt, eq } from './fraction';

const d = (v: number): number => Math.round(v * 1_000_000);
const P = (lat: number, lon: number): MicroPoint => ({ lat: d(lat), lon: d(lon) });

const farZone = [P(40, 40), P(40, 50), P(50, 50), P(50, 40)];
const box20 = [P(0, 0), P(0, 20), P(20, 20), P(20, 0)];
const crossingBoxCW = [P(10, 170), P(10, -170), P(0, -170), P(0, 170)];

const verdictOf = (zone: Zone, route: MicroPoint[], i: number, j: number) =>
  checkCandidateEdge(zone, zone.points.map((p) => ({ lat: md(p.lat), lon: md(p.lon) })), route[i], route[j]);

/** 独立暴力枚举：所有包含首尾点的子序列，逐一检查每条边，取（航段数, 字典序）最优。 */
function bruteForce(zone: Zone, route: MicroPoint[]): number[] | null {
  const n = route.length;
  let best: number[] | null = null;
  const middle = n - 2;
  for (let mask = 0; mask < 1 << middle; mask++) {
    const seq = [0];
    for (let i = 1; i <= middle; i++) if ((mask >> (i - 1)) & 1) seq.push(i);
    seq.push(n - 1);
    let safe = true;
    for (let k = 0; k + 1 < seq.length; k++) {
      if (verdictOf(zone, route, seq[k], seq[k + 1]) !== 'ok') {
        safe = false;
        break;
      }
    }
    if (!safe) continue;
    if (!best || seq.length < best.length || (seq.length === best.length && lexCmp(seq, best) < 0)) {
      best = seq;
    }
  }
  return best;
}

const expectSamePlan = (got: CompressResult, want: number[] | null) => {
  if (want === null) {
    expect(got.kept).toBeNull();
    expect(got.keptPoints).toEqual([]);
    expect(got.preview).toEqual([]);
  } else {
    expect(got.kept).toEqual(want);
    expect(got.kept![0]).toBe(0);
  }
};

describe('安全压缩：基本求解', () => {
  it('共线冗余点：直达边安全时压到只剩首尾', () => {
    const z = createZone(farZone);
    const r = compressRoute(z, [P(0, 0), P(0, 10), P(0, 20), P(0, 30)]);
    expectSamePlan(r, [0, 3]);
    expect(r.keptPoints).toEqual([P(0, 0), P(0, 30)]);
  });

  it('禁区挡住直达捷径：保留绕行的中间点', () => {
    const zone = [P(-5, 5), P(-5, 15), P(5, 15), P(5, 5)];
    const route = [P(0, 0), P(12, 10), P(0, 20)];
    const z = createZone(zone);
    const r = compressRoute(z, route);
    expectSamePlan(r, [0, 1, 2]);
    expect(verdictOf(z, route, 0, 2)).toBe('zone-hit');
    expect(verdictOf(z, route, 0, 1)).toBe('ok');
    expect(verdictOf(z, route, 1, 2)).toBe('ok');
  });

  it('同航段数取下标字典序最小：[0,1,3] 胜过 [0,2,3]', () => {
    const zone = [P(-1, 5), P(-1, 15), P(1, 15), P(1, 5)];
    const route = [P(0, 0), P(20, -10), P(20, 10), P(0, 20)];
    const z = createZone(zone);
    // 只有 0→3 被禁区挡住，[0,1,3] 与 [0,2,3] 同为 2 航段
    expect(verdictOf(z, route, 0, 3)).toBe('zone-hit');
    const r = compressRoute(z, route);
    expectSamePlan(r, [0, 1, 3]);
  });

  it('两点航路：直达安全即 [0,1]，被挡即无方案', () => {
    const zFar = createZone(farZone);
    expectSamePlan(compressRoute(zFar, [P(0, 0), P(0, 10)]), [0, 1]);
    const zBlock = createZone([P(-5, 2), P(-5, 8), P(5, 8), P(5, 2)]);
    expectSamePlan(compressRoute(zBlock, [P(0, 0), P(0, 10)]), null);
  });

  it('不改动输入（确认前原航路不变）', () => {
    const zone = farZone.map((p) => ({ ...p }));
    const route = [P(0, 0), P(0, 10), P(0, 20)];
    const zoneSnap = JSON.stringify(zone);
    const routeSnap = JSON.stringify(route);
    compressRoute(createZone(zone), route);
    expect(JSON.stringify(route)).toBe(routeSnap);
    expect(JSON.stringify(zone)).toBe(zoneSnap);
  });
});

describe('安全压缩：跨日界线与等价经度', () => {
  const routeCross = [P(5, 160), P(20, 175), P(20, -175), P(5, -160)];

  it('向北绕行的航路：直达边横穿跨线禁区被淘汰，最优 [0,1,3]', () => {
    const z = createZone(crossingBoxCW);
    const r = compressRoute(z, routeCross);
    expectSamePlan(r, [0, 1, 3]);
    expect(verdictOf(z, routeCross, 0, 3)).toBe('zone-hit');
    // 预演折线按保留子序列重新短弧展开：160 → 175 → 200（即 -160）
    expect(r.preview.map((p) => p.lon)).toEqual([d(160), d(175), d(200)]);
    expect(r.preview.map((p) => p.lat)).toEqual([d(5), d(20), d(5)]);
  });

  it('日界线两侧等价经度（-170/-175/-160 与 190/185/200）给出完全相同的结果', () => {
    const zoneEq = [P(10, 170), P(10, 190), P(0, 190), P(0, 170)];
    const routeEq = [P(5, 160), P(20, 175), P(20, 185), P(5, 200)];
    const a = compressRoute(createZone(crossingBoxCW), routeCross);
    const b = compressRoute(createZone(zoneEq), routeEq);
    expect(b.kept).toEqual(a.kept);
    expect(b.verdicts.map((v) => `${v.from},${v.to},${v.reason}`)).toEqual(
      a.verdicts.map((v) => `${v.from},${v.to},${v.reason}`),
    );
    // 展开后的预演折线也一致（等价表示展开到同一条折线）
    expect(b.preview).toEqual(a.preview);
    // 保留点保持各自原始录入：等价形式不被改写
    expect(b.keptPoints).toEqual([P(5, 160), P(20, 175), P(5, 200)]);
    expect(a.keptPoints).toEqual([P(5, 160), P(20, 175), P(5, -160)]);
  });

  it('恰好 180° 的候选捷径只淘汰该边，工作区不失效', () => {
    const route = [P(10, 170), P(10, -175), P(10, -10)];
    const z = createZone(farZone);
    // 相邻边均合法（15°、165°），候选边 0→2 恰好 180°
    expect(() => createRoute(route)).not.toThrow();
    const r = compressRoute(z, route);
    expect(verdictOf(z, route, 0, 2)).toBe('ambiguous-180');
    expect(verdictOf(z, route, 0, 1)).toBe('ok');
    expect(verdictOf(z, route, 1, 2)).toBe('ok');
    expectSamePlan(r, [0, 1, 2]);
    // 原分析通道照常工作（原命中区间表口径不变）
    const zz = createZone(farZone);
    const rr = createRoute(route);
    expect(() => analyzeRoute(zz.points, zz, rr.points)).not.toThrow();
  });

  it('展开后重合的候选边判零长度，同样只淘汰该边', () => {
    // 530° 与 170° 是同一经线：候选边 0→2 展开后两端重合
    const route = [P(5, 170), P(10, 200), P(5, 530)];
    const z = createZone(farZone);
    expect(verdictOf(z, route, 0, 2)).toBe('zero-length');
    expectSamePlan(compressRoute(z, route), [0, 1, 2]);
  });
});

describe('安全压缩：边界擦触同样不可用', () => {
  const grazeRoute = [P(-20, 0), P(0, 0), P(0, -20)]; // 中点恰好是禁区西南角

  it('擦过顶点的两条边都被淘汰，不擦边的直达捷径保留', () => {
    const z = createZone(box20);
    expect(verdictOf(z, grazeRoute, 0, 1)).toBe('zone-touch');
    expect(verdictOf(z, grazeRoute, 1, 2)).toBe('zone-touch');
    expect(verdictOf(z, grazeRoute, 0, 2)).toBe('ok');
    expectSamePlan(compressRoute(z, grazeRoute), [0, 2]);
  });

  it('原命中区间表保持原口径：边界计入，顶点擦过仍是单点区间', () => {
    const z = createZone(box20);
    const r = createRoute(grazeRoute);
    const a = analyzeRoute(z.points, z, r.points);
    expect(a.intervals).toHaveLength(1);
    expect(cmp(a.intervals[0].s0, fromInt(1))).toBe(0);
    expect(cmp(a.intervals[0].s1, fromInt(1))).toBe(0);
    expect(eq(a.intervals[0].enter.geo.lat, fromInt(0))).toBe(true);
    expect(eq(a.intervals[0].enter.geo.lon, fromInt(0))).toBe(true);
  });

  it('沿边行走的航路：整段重合边不可用，且无安全方案', () => {
    const route = [P(10, -20), P(10, 0), P(10, 20), P(10, 40)];
    const z = createZone(box20);
    expect(verdictOf(z, route, 1, 2)).toBe('zone-hit'); // 与边重合段
    expect(verdictOf(z, route, 0, 1)).toBe('zone-touch'); // 端点落在边上
    expectSamePlan(compressRoute(z, route), null);
  });
});

describe('安全压缩：不可行与结果完整性', () => {
  it('途经禁区内部且无绕行点：明确无方案，不交付部分航路', () => {
    const zone = [P(-30, -30), P(-30, 30), P(30, 30), P(30, -30)];
    const route = [P(0, -40), P(0, 0), P(0, 40)];
    const z = createZone(zone);
    const r = compressRoute(z, route);
    expectSamePlan(r, null);
    expect(verdictOf(z, route, 0, 1)).toBe('zone-hit');
    expect(verdictOf(z, route, 1, 2)).toBe('zone-hit');
    expect(verdictOf(z, route, 0, 2)).toBe('zone-hit');
  });

  it('预演线、保留下标与命中说明来自同一结果', () => {
    const z = createZone(crossingBoxCW);
    const route = [P(5, 160), P(20, 175), P(20, -175), P(5, -160)];
    const r = compressRoute(z, route);
    expect(r.kept).not.toBeNull();
    const kept = r.kept!;
    // 保留点 = 原始航点按下标取出（原始录入坐标，不改写）
    expect(r.keptPoints).toEqual(kept.map((i) => route[i]));
    // 预演折线 = 保留点的短弧展开（独立重算一致）
    expect(r.preview).toEqual(unwrapChain(r.keptPoints));
    // 相邻预演点经度差都在 (-180°,180°) 内
    for (let i = 0; i + 1 < r.preview.length; i++) {
      expect(Math.abs(r.preview[i + 1].lon - r.preview[i].lon)).toBeLessThan(d(180));
    }
    // 命中说明覆盖全部候选边，且与独立判定一致
    expect(r.verdicts).toHaveLength((route.length * (route.length - 1)) / 2);
    for (const v of r.verdicts) {
      expect(v.reason).toBe(verdictOf(z, route, v.from, v.to));
      expect(v.ok).toBe(v.reason === 'ok');
    }
  });
});

describe('安全压缩：短航路全子序列枚举核对最优性', () => {
  const cases: { name: string; zone: MicroPoint[]; route: MicroPoint[] }[] = [
    { name: '共线冗余', zone: farZone, route: [P(0, 0), P(0, 10), P(0, 20), P(0, 30)] },
    { name: '禁区挡道', zone: [P(-5, 5), P(-5, 15), P(5, 15), P(5, 5)], route: [P(0, 0), P(12, 10), P(0, 20)] },
    { name: '字典序平局', zone: [P(-1, 5), P(-1, 15), P(1, 15), P(1, 5)], route: [P(0, 0), P(20, -10), P(20, 10), P(0, 20)] },
    { name: '跨线绕行', zone: crossingBoxCW, route: [P(5, 160), P(20, 175), P(20, -175), P(5, -160)] },
    { name: '顶点擦过', zone: box20, route: [P(-20, 0), P(0, 0), P(0, -20)] },
    { name: '沿边行走', zone: box20, route: [P(10, -20), P(10, 0), P(10, 20), P(10, 40)] },
    { name: '180° 候选边', zone: farZone, route: [P(10, 170), P(10, -175), P(10, -10)] },
    { name: '不可行', zone: [P(-30, -30), P(-30, 30), P(30, 30), P(30, -30)], route: [P(0, -40), P(0, 0), P(0, 40)] },
    {
      name: '跨线闭合环场景',
      zone: crossingBoxCW,
      route: [P(5, 160), P(5, 175), P(5, -175), P(5, -160), P(-10, -160), P(-10, 160)],
    },
  ];

  for (const c of cases) {
    it(`求解器 == 暴力枚举：${c.name}`, () => {
      const z = createZone(c.zone);
      const got = compressRoute(z, c.route);
      expect(got.kept).toEqual(bruteForce(z, c.route));
    });
  }

  // 确定性伪随机航路：相邻步长有界（<180°），生成即可通过校验
  const genRoute = (seed: number, n: number, lonBase: number): MicroPoint[] => {
    let s = seed;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const pts: MicroPoint[] = [];
    let lat = Math.round((rnd() * 2 - 1) * 50);
    let lon = lonBase;
    for (let i = 0; i < n; i++) {
      pts.push(P(lat, lon));
      let dLat = Math.round((rnd() * 2 - 1) * 40);
      const dLon = Math.round((rnd() * 2 - 1) * 60);
      if (dLat === 0 && dLon === 0) dLat = 1;
      lat = Math.max(-75, Math.min(75, lat + dLat));
      lon += dLon;
    }
    return pts;
  };

  const randomCases: { name: string; zone: MicroPoint[]; route: MicroPoint[] }[] = [
    { name: '伪随机 8 点（本初子午线附近）', zone: [P(-10, -20), P(-10, 20), P(10, 20), P(10, -20)], route: genRoute(7, 8, -100) },
    { name: '伪随机 9 点（日界线附近）', zone: crossingBoxCW, route: genRoute(42, 9, 150) },
    { name: '伪随机 10 点（日界线附近）', zone: crossingBoxCW, route: genRoute(2026, 10, 170) },
  ];

  for (const c of randomCases) {
    it(`求解器 == 暴力枚举：${c.name}`, () => {
      const z = createZone(c.zone);
      expect(() => createRoute(c.route)).not.toThrow();
      const got = compressRoute(z, c.route);
      expect(got.kept).toEqual(bruteForce(z, c.route));
    });
  }

  it('最优性细节：保留序列含首尾、严格递增、航段数最少', () => {
    const z = createZone(crossingBoxCW);
    const route = genRoute(99, 9, 155);
    const got = compressRoute(z, route);
    const best = bruteForce(z, route);
    expect(got.kept).toEqual(best);
    if (got.kept) {
      expect(got.kept[0]).toBe(0);
      expect(got.kept[got.kept.length - 1]).toBe(route.length - 1);
      for (let i = 0; i + 1 < got.kept.length; i++) {
        expect(got.kept[i + 1]).toBeGreaterThan(got.kept[i]);
      }
    }
  });
});
