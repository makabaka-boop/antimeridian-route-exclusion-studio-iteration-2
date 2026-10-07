import type { MicroPoint, Zone } from './types';
import { shortArcDelta, unwrapChain } from './unwrap';
import { createRoute } from './route';
import { analyzeRoute, type AnalysisResult } from './intercept';

/** 一条候选捷径边的独立判定结论 */
export type EdgeReason = 'ok' | 'ambiguous-180' | 'zero-length' | 'zone-hit';

export interface EdgeCheck {
  from: number;
  to: number;
  safe: boolean;
  reason: EdgeReason;
  /**
   * 触碰禁区时该候选边**独立**的精确裁剪结果（边界计入：单点击中也在其中）；
   * 其余原因为 null。
   */
  hits: AnalysisResult | null;
}

export interface CompressionResult {
  /** 是否存在保留首尾的安全子序列 */
  feasible: boolean;
  /** 安全最优子序列的原航路点下标；无方案时为 null（绝不交付部分航路） */
  kept: number[] | null;
  segmentCount: number | null;
  /** 预演线的展开平面坐标（与 kept 同源、同一次计算产出），仅可行时非空 */
  previewPoints: MicroPoint[];
  /** 全部 i<j 候选边的独立判定，命中说明与预演线取自同一结果 */
  edges: EdgeCheck[];
  message: string;
}

/**
 * 独立检查一条候选捷径边（两个现有航路点）：
 * - 相邻经度按短弧展开：恰好相差 180° 是歧义边，**只淘汰该边**，不影响工作区；
 * - 零长度（含相差整 360° 同一经线）淘汰该边；
 * - 否则按必要世界副本 + 凸多边形精确半平面裁剪，边界计入：
 *   只要存在任何命中区间（含单点擦过）即不安全。
 */
export function checkCompressionEdge(zone: Zone, a: MicroPoint, b: MicroPoint): Omit<EdgeCheck, 'from' | 'to'> {
  // 短弧规则：恰好 ±180° 抛错——只让这条候选边失效
  let delta: number;
  try {
    delta = shortArcDelta(b.lon, a.lon);
  } catch {
    return { safe: false, reason: 'ambiguous-180', hits: null };
  }
  if (a.lat === b.lat && delta === 0) {
    return { safe: false, reason: 'zero-length', hits: null };
  }

  // 与正式航路完全相同的构造与判定通道（createRoute 再做一次短弧展开/零长度校验）
  const route = createRoute([a, b]);
  const hits = analyzeRoute(zone.points, zone, route.points);
  const safe = hits.intervals.length === 0;
  return { safe, reason: safe ? 'ok' : 'zone-hit', hits: safe ? null : hits };
}

/**
 * 安全压缩求解：
 * 只能保留现有航路点的子序列（首尾必含）；每条候选边独立判定。
 * 在全部安全方案中先取航段数最少，再取原下标序列字典序最小；无方案明确报告。
 *
 * 边只从较小下标指向较大下标，构成 DAG：先逆序 DP 求各点到终点的最少边数，
 * 再从起点贪心选择「仍在最短路上的最小下标后继」——即最短前提下的字典序最小序列。
 */
export function compressRoute(zone: Zone, rawRoute: ReadonlyArray<MicroPoint>): CompressionResult {
  const n = rawRoute.length;
  const edges: EdgeCheck[] = [];
  const safe: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const check = checkCompressionEdge(zone, rawRoute[i], rawRoute[j]);
      edges.push({ from: i, to: j, ...check });
      safe[i][j] = check.safe;
    }
  }

  // dist[v]：从 v 到终点 n-1 的最少安全边数；Infinity 表示不可达
  const dist: number[] = new Array(n).fill(Infinity);
  dist[n - 1] = 0;
  for (let v = n - 2; v >= 0; v--) {
    for (let w = v + 1; w < n; w++) {
      if (safe[v][w] && dist[w] + 1 < dist[v]) dist[v] = dist[w] + 1;
    }
  }

  if (!Number.isFinite(dist[0])) {
    return {
      feasible: false,
      kept: null,
      segmentCount: null,
      previewPoints: [],
      edges,
      message:
        `无安全方案：不存在保留首点 0 与尾点 ${n - 1} 的子序列，` +
        '使其每条航段都不进入禁区（触碰边界同样不可用）。不交付任何部分航路。',
    };
  }

  // 字典序最小：每一步选择满足 dist[w] === dist[v]-1 的最小下标 w
  const kept: number[] = [0];
  let v = 0;
  while (v !== n - 1) {
    for (let w = v + 1; w < n; w++) {
      if (safe[v][w] && dist[w] === dist[v] - 1) {
        kept.push(w);
        v = w;
        break;
      }
    }
  }

  // 预演线与保留下标同源：对保留的原始点重新做相邻短弧展开
  const previewPoints = unwrapChain(kept.map((i) => rawRoute[i]));

  return {
    feasible: true,
    kept,
    segmentCount: kept.length - 1,
    previewPoints,
    edges,
    message:
      `安全捷径：${kept.length - 1} 段（原 ${n - 1} 段），保留下标 ${kept.join(' → ')}。` +
      '预演尚未改写原航路，确认后才会采用。',
  };
}
