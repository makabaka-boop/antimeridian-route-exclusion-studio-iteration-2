import { ValidationError, type MicroPoint, type Route } from './types';
import { assertCoord, unwrapChain } from './unwrap';

/** 校验航路（2～80 点，整数坐标，相邻短弧展开；重复相邻点视为零长度航段拒绝）。 */
export function createRoute(raw: ReadonlyArray<MicroPoint>): Route {
  if (!Array.isArray(raw)) throw new ValidationError('航路点必须是数组');
  if (raw.length < 2 || raw.length > 80) {
    throw new ValidationError('航路点数必须在 2～80 之间');
  }
  raw.forEach(assertCoord);

  const pts = unwrapChain(raw);
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i].lat === pts[i + 1].lat && pts[i].lon === pts[i + 1].lon) {
      throw new ValidationError(`第 ${i + 1} 航段长度为零（相邻航路点重合）`);
    }
  }
  return { points: pts };
}
