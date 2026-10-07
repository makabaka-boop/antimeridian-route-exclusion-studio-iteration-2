import type { MicroPoint, Zone } from './types';
import { createRoute } from './route';
import { shortArcDelta, unwrapChain, WORLD } from './unwrap';
import { copyKsForSegment, clipSegmentWithConvex, md, type FPoint } from './intercept';
import { add, eq, fromInt, mul, frac } from './fraction';

const WORLD_DEG = frac(BigInt(WORLD), 1_000_000n);

/** 候选捷径边的判定结果。ok 之外的原因都会淘汰该边（且只淘汰该边）。 */
export type VerdictReason =
  | 'ok' // 安全：全程严格在禁区外
  | 'ambiguous-180' // 两端经度恰好相差 180°：短弧解释歧义
  | 'zero-length' // 展开后两端重合：零长度航段
  | 'zone-hit' // 穿过禁区内部（区间长度 > 0）
  | 'zone-touch'; // 擦触禁区边界（单点接触；边界同样不可用）

export interface EdgeVerdict {
  from: number;
  to: number;
  ok: boolean;
  reason: VerdictReason;
}

export interface CompressResult {
  /** 最优保留的原航点下标（含首尾，升序）；null = 无安全方案 */
  kept: number[] | null;
  /** 保留点的原始录入坐标（确认时原样替换航路）；无方案时为空 */
  keptPoints: MicroPoint[];
  /** 预演折线：保留点按相邻短弧展开后的平面坐标（micro°）；无方案时为空 */
  preview: MicroPoint[];
  /** 全部候选边的判定（命中说明的数据源，与预演线、保留下标同属一份结果） */
  verdicts: EdgeVerdict[];
}

/**
 * 单条候选捷径边的安全判定：独立按现有规则检查——
 * 短弧展开（恰好 180° 只淘汰本边）、必要世界副本、精确禁区裁剪。
 * 与区间表「边界计入」的口径不同：压缩要求全程严格在禁区外，
 * 擦触边界（裁剪区间退化为单点）同样不可用。
 */
export function checkCandidateEdge(zone: Zone, basePoly: FPoint[], a: MicroPoint, b: MicroPoint): VerdictReason {
  let delta: number;
  try {
    delta = shortArcDelta(b.lon, a.lon);
  } catch {
    return 'ambiguous-180';
  }
  const au = { lat: a.lat, lon: a.lon };
  const bu = { lat: b.lat, lon: a.lon + delta };
  if (au.lat === bu.lat && au.lon === bu.lon) return 'zero-length';

  const fa: FPoint = { lat: md(au.lat), lon: md(au.lon) };
  const fb: FPoint = { lat: md(bu.lat), lon: md(bu.lon) };
  let touch = false;
  for (const k of copyKsForSegment(zone, au, bu)) {
    const shift = mul(WORLD_DEG, fromInt(k));
    const poly = basePoly.map((p) => ({ lat: p.lat, lon: add(p.lon, shift) }));
    const clip = clipSegmentWithConvex(fa, fb, poly);
    if (clip) {
      if (!eq(clip.t0, clip.t1)) return 'zone-hit';
      touch = true;
    }
  }
  return touch ? 'zone-touch' : 'ok';
}

/** 字典序比较（等长或不等长下标序列通用）：-1 / 0 / 1 */
export const lexCmp = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
};

/**
 * 安全压缩：从现有航点中保留包含首尾点的子序列，使每条新航段都安全。
 * 在所有安全方案中先取航段数最少者，再取下标序列字典序最小者；
 * 无方案时 kept 为 null（不交付部分航路）。
 * 候选边只引用现有航点，恰好 180° 的边只淘汰该边，不影响其余判定。
 */
export function compressRoute(zone: Zone, routeRaw: MicroPoint[]): CompressResult {
  const route = createRoute(routeRaw); // 与主通道同一份校验；非法输入在此抛出
  const pts = route.points;
  const n = pts.length;
  const basePoly: FPoint[] = zone.points.map((p) => ({ lat: md(p.lat), lon: md(p.lon) }));

  // 全部候选边 i→j（i<j）的判定
  const ok: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const verdicts: EdgeVerdict[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const reason = checkCandidateEdge(zone, basePoly, routeRaw[i], routeRaw[j]);
      ok[i][j] = reason === 'ok';
      verdicts.push({ from: i, to: j, ok: ok[i][j], reason });
    }
  }

  // 边只从低下标指向高下标：按下标顺序做 DAG 最短路径。
  // dp[i] = (航段数最少, 同航段数下字典序最小) 的 0→i 方案。
  // 最优子结构成立：追加同一条边 j→i 时，航段数与字典序的比较都只看前缀。
  const dp: ({ legs: number; seq: number[] } | null)[] = new Array(n).fill(null);
  dp[0] = { legs: 0, seq: [0] };
  for (let i = 1; i < n; i++) {
    let best: { legs: number; seq: number[] } | null = null;
    for (let j = 0; j < i; j++) {
      const prev = dp[j];
      if (!prev || !ok[j][i]) continue;
      const cand = { legs: prev.legs + 1, seq: [...prev.seq, i] };
      if (!best || cand.legs < best.legs || (cand.legs === best.legs && lexCmp(cand.seq, best.seq) < 0)) {
        best = cand;
      }
    }
    dp[i] = best;
  }

  const finalPlan = dp[n - 1];
  const kept = finalPlan ? finalPlan.seq : null;
  const keptPoints = kept ? kept.map((i) => ({ ...routeRaw[i] })) : [];
  // 预演折线按保留子序列重新短弧展开（每条保留边都已通过 180° 检查，不会抛错）
  const preview = kept ? unwrapChain(keptPoints) : [];
  return { kept, keptPoints, preview, verdicts };
}
