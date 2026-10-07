import { useMemo } from 'react';
import type { MicroPoint, Route, Zone } from '../geometry/types';
import { createZone } from '../geometry/zone';
import { createRoute } from '../geometry/route';
import { analyzeRoute, type AnalysisResult } from '../geometry/intercept';
import { buildRoutePieces, buildZonePieces, type RoutePiece, type ZonePiece } from '../geometry/display';

export interface Derived {
  zoneError: string | null;
  routeError: string | null;
  /** 校验通过的禁区/航路（压缩预演与画面共用同一份几何对象） */
  zone: Zone | null;
  route: Route | null;
  result: AnalysisResult | null;
  routePieces: RoutePiece[];
  zonePieces: ZonePiece[];
}

/** 从原始录入点到画面/区间表的唯一数据通道，保证两者指向同一条被截航路。 */
export function useDerivedGeometry(zoneRaw: MicroPoint[], routeRaw: MicroPoint[]): Derived {
  return useMemo(() => {
    let zone: Zone | null = null;
    let route: Route | null = null;
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
      return { zoneError, routeError, zone, route, result: null, routePieces: [], zonePieces: [] };
    }

    const result = analyzeRoute(zone.points, zone, route.points);
    const routePieces = buildRoutePieces(route.points, result.segHits);
    const zonePieces = buildZonePieces(zone.points);
    return { zoneError, routeError, zone, route, result, routePieces, zonePieces };
  }, [zoneRaw, routeRaw]);
}
