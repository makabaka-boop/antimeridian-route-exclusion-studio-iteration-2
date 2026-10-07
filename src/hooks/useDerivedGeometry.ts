import { useMemo } from 'react';
import type { MicroPoint } from '../geometry/types';
import { createZone } from '../geometry/zone';
import { createRoute } from '../geometry/route';
import { analyzeRoute, type AnalysisResult } from '../geometry/intercept';
import { buildRoutePieces, buildZonePieces, type RoutePiece, type ZonePiece } from '../geometry/display';
import { compressRoute, type CompressionResult } from '../geometry/compress';

export interface Derived {
  zoneError: string | null;
  routeError: string | null;
  result: AnalysisResult | null;
  routePieces: RoutePiece[];
  zonePieces: ZonePiece[];
  /**
   * 安全压缩预演。仅在请求（preview 标志）且禁区、原航路都有效时计算；
   * 它与原命中区间表完全独立——预演线、保留下标、命中说明来自同一次 compressRoute。
   * 输入（禁区/航路）一旦变化，App 会立即把标志置回 false，旧预演随之撤销。
   */
  compression: CompressionResult | null;
}

/** 从原始录入点到画面/区间表的唯一数据通道，保证两者指向同一条被截航路。 */
export function useDerivedGeometry(zoneRaw: MicroPoint[], routeRaw: MicroPoint[], wantCompression: boolean): Derived {
  return useMemo(() => {
    let zone: ReturnType<typeof createZone> | null = null;
    let route: ReturnType<typeof createRoute> | null = null;
    let zoneError: string | null = null;
    let routeError: string | null = null;

    try {
      zone = createZone(zoneRaw);
    } catch (e) {
      zoneError = e instanceof Error ? e.message : String(e);
    }
    try {
      route = createRoute(routeRaw);
    } catch (e) {
      routeError = e instanceof Error ? e.message : String(e);
    }

    if (!zone || !route) {
      return { zoneError, routeError, result: null, routePieces: [], zonePieces: [], compression: null };
    }

    const result = analyzeRoute(zone.points, zone, route.points);
    const routePieces = buildRoutePieces(route.points, result.segHits);
    const zonePieces = buildZonePieces(zone.points);
    // 原命中区间表保持原口径：仍只描述原航路；压缩结果独立产出
    const compression = wantCompression ? compressRoute(zone, routeRaw) : null;
    return { zoneError, routeError, result, routePieces, zonePieces, compression };
  }, [zoneRaw, routeRaw, wantCompression]);
}
