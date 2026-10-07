import type { Fraction } from './fraction';
import { add, sub, mul, div, fromInt, cmp, eq, gte, floorF, frac } from './fraction';
import type { FPoint, SegHit } from './intercept';
import type { MicroPoint } from './types';
import { md } from './intercept';

/** 一个航段命中区间在日界线处切出的子段（局部 t，闭区间） */
export interface RouteSub {
  t0: Fraction;
  t1: Fraction;
}

/** 一条被截航路在某个经度世界窗口内的画面段（多边形填充条带或折线） */
export interface RoutePiece {
  segIndex: number;
  geo: { p0: FPoint; p1: FPoint }[];
}

/** 禁区在日界线处切出的闭合画面多边形 */
export interface ZonePiece {
  points: FPoint[];
}

const ZERO = frac(0n);
const ONE = frac(1n);
const HALF = frac(1n, 2n);
const BOUND = fromInt(180);
const WORLD = fromInt(360);

const mid = (a: Fraction, b: Fraction): Fraction => mul(add(a, b), HALF);

/** 把命中子区间在 lon=180+360q 处切开，使每段完全落在同一个世界窗口内。 */
export function splitSubAtDateline(a: MicroPoint, b: MicroPoint, t0: Fraction, t1: Fraction): RouteSub[] {
  const lon0 = md(a.lon);
  const lon1 = md(b.lon);
  const dLon = sub(lon1, lon0);
  // 经度不变（含竖直航段）：不存在内部穿越，直接返回原子区间
  if (eq(dLon, ZERO)) return [{ t0, t1 }];
  const lon = (t: Fraction): Fraction => add(lon0, mul(dLon, t));
  const m0 = lon(t0);
  const m1 = lon(t1);

  const crossings: Fraction[] = [];
  const qCenter = Number(floorF(div(add(mid(m0, m1), BOUND), WORLD)));
  for (let q = qCenter - 1; q <= qCenter + 1; q++) {
    const x = add(BOUND, mul(WORLD, fromInt(q)));
    // 穿越点的「整段参数」：t = (x - lon(0)) / (lon(1) - lon(0))，
    // 再换算成子区间局部参数；严格位于子区间内部才算穿越
    const tSeg = div(sub(x, lon0), dLon);
    if (cmp(tSeg, t0) > 0 && cmp(tSeg, t1) < 0) crossings.push(tSeg);
  }
  crossings.sort(cmp);

  const cuts = [t0, ...crossings, t1];
  return cuts.slice(0, -1).map((c, i) => ({ t0: c, t1: cuts[i + 1] }));
}

/**
 * 把展开经度归一化到子片段所在世界窗口 q：映射后落在 (-180, 180]。
 * 与 wrapLon（[-180,180)）的区别在于切点 180+360q 归入窗口**东缘 +180°**，
 * 使日界线两侧的短片段各自贴住所在一侧边缘，而不是被甩到对侧形成横跨整图的长线。
 */
const geoLonInWindow = (lon: Fraction, q: number): Fraction =>
  sub(lon, mul(WORLD, fromInt(q)));

const pointGeoAt = (a: MicroPoint, b: MicroPoint, t: Fraction, q: number): FPoint => {
  const lifted: FPoint = {
    lat: add(md(a.lat), mul(sub(md(b.lat), md(a.lat)), t)),
    lon: add(md(a.lon), mul(sub(md(b.lon), md(a.lon)), t)),
  };
  return { lat: lifted.lat, lon: geoLonInWindow(lifted.lon, q) };
};

/** 子片段中点经度所在的世界窗口编号：中点 ∈ (180+360(q−1), 180+360q] → q */
const windowOf = (a: MicroPoint, b: MicroPoint, t0: Fraction, t1: Fraction): number => {
  const lon = (t: Fraction): Fraction => add(md(a.lon), mul(sub(md(b.lon), md(a.lon)), t));
  return Number(floorF(div(add(mid(lon(t0), lon(t1)), BOUND), WORLD)));
};

/**
 * 由每段命中区间生成画面分段：同一区间在日界线两侧各得一段，
 * 相邻命中（沿航路在顶点处相接）的画面段因此天然在顶点两侧连续，
 * 画面与区间表使用完全相同的 segHits。
 */
export function buildRoutePieces(routePts: MicroPoint[], segHits: SegHit[][]): RoutePiece[] {
  const pieces: RoutePiece[] = [];
  for (let i = 0; i < routePts.length - 1; i++) {
    const a = routePts[i];
    const b = routePts[i + 1];
    const geo: { p0: FPoint; p1: FPoint }[] = [];
    for (const h of segHits[i]) {
      for (const s of splitSubAtDateline(a, b, h.t0, h.t1)) {
        // 按子片段所在窗口归一化，日界线切点贴住本侧边缘，杜绝横跨整图的连线
        const q = windowOf(a, b, s.t0, s.t1);
        geo.push({ p0: pointGeoAt(a, b, s.t0, q), p1: pointGeoAt(a, b, s.t1, q) });
      }
    }
    if (geo.length) pieces.push({ segIndex: i, geo });
  }
  return pieces;
}

/** 凸/一般多边形按半平面 (cross(edge, p-a) >= 0) 裁剪（Sutherland–Hodgman，分数精确）。 */
export function clipPolygon(poly: FPoint[], ax: Fraction, ay: Fraction, ex: Fraction, ey: Fraction): FPoint[] {
  const inside = (p: FPoint): boolean => {
    const c = sub(mul(ex, sub(p.lat, ay)), mul(ey, sub(p.lon, ax)));
    return gte(c, ZERO);
  };
  const intersect = (p: FPoint, q: FPoint): FPoint => {
    const px = sub(p.lon, ax);
    const py = sub(p.lat, ay);
    const dx = sub(q.lon, p.lon);
    const dy = sub(q.lat, p.lat);
    // cross(e, P + d*t - a) = 0 → t = -cross(e,P-a)/cross(e,d)
    const num = sub(mul(ex, py), mul(ey, px));
    const den = sub(mul(ex, dy), mul(ey, dx));
    const t = div(mul(num, fromInt(-1)), den);
    return { lon: add(p.lon, mul(dx, t)), lat: add(p.lat, mul(dy, t)) };
  };

  const out: FPoint[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const cin = inside(cur);
    const pin = inside(prev);
    if (cin) {
      if (!pin) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (pin) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

/**
 * 禁区在日界线处分段：把展开多边形分别裁到窗口 lon<=180 与 lon>=-180，
 * 两侧裁剪结果各自平移一个世界副本后归一化绘制。多边形宽度 <180°，最多两片。
 */
export function buildZonePieces(zonePts: MicroPoint[]): ZonePiece[] {
  const poly: FPoint[] = zonePts.map((p) => ({ lat: md(p.lat), lon: md(p.lon) }));
  const pieces: ZonePiece[] = [];

  // 右窗口副本：lon - 360k <= 180，取能盖住主体的 k
  const lons = poly.map((p) => p.lon);
  const kRef = Number(floorF(div(add(lons.reduce((x, y) => (cmp(x, y) > 0 ? x : y)), BOUND), WORLD)));

  for (const kShift of [kRef, kRef - 1, kRef + 1]) {
    const moved = poly.map((p) => ({ lat: p.lat, lon: sub(p.lon, mul(WORLD, fromInt(kShift))) }));
    // 裁掉 lon > 180：沿 180° 边向上（内侧在左＝西）
    let c = clipPolygon(moved, BOUND, ZERO, ZERO, ONE);
    // 裁掉 lon < -180：沿 -180° 边向下（内侧在左＝东）
    c = clipPolygon(c, sub(ZERO, BOUND), ZERO, ZERO, sub(ZERO, ONE));
    if (c.length >= 3) {
      const area = polygonArea(c);
      // 面积必须按值比较（分数运算结果恒为新对象，引用比较会漏掉共线零面积片）；
      // 禁区仅以一条边贴住 180° 时对侧裁剪退化为零面积，在此丢弃，不生成幽灵片。
      if (!eq(area, ZERO) && !pieces.some((pc) => samePiece(pc.points, c))) {
        pieces.push({ points: c });
      }
    }
  }
  return pieces;
}

const polygonArea = (poly: FPoint[]): Fraction => {
  let a = ZERO;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a = add(a, sub(mul(p.lon, q.lat), mul(q.lon, p.lat)));
  }
  return a;
};

const samePiece = (a: FPoint[], b: FPoint[]): boolean =>
  a.length === b.length && a.every((p, i) => eq(p.lon, b[i].lon) && eq(p.lat, b[i].lat));
