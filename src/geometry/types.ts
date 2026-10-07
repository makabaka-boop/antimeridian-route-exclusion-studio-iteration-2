/**
 * 坐标以「整数百万分之一度」存储（microdegrees）。
 * 纬度允许范围：±80°；经度允许范围：±540°（用于容纳跨日界线的直接录入）。
 */
export interface MicroPoint {
  /** 纬度，百万分之一度 */
  lat: number;
  /** 经度，百万分之一度 */
  lon: number;
}

/** 凸禁区（已通过校验并统一为逆时针、按短弧展开后的平面多边形） */
export interface Zone {
  /** 展开到平面上的顶点（逆时针），lon 可能超出 ±180°，但多边形宽度 < 180° */
  points: MicroPoint[];
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** 航路（已通过校验、按相邻短弧展开的折线） */
export interface Route {
  points: MicroPoint[];
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
