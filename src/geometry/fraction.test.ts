import { describe, it, expect } from 'vitest';
import { frac, add, cmp, wrapLon, toFixed } from './fraction';

describe('Fraction（约分分数）', () => {
  it('自动约分并统一符号到分母为正', () => {
    expect(frac(6n, -9n)).toEqual({ n: -2n, d: 3n });
    expect(frac(-6n, -9n)).toEqual({ n: 2n, d: 3n });
  });

  it('精确比较 1/3 与 333333333.../1e...', () => {
    const a = frac(1n, 3n);
    const b = frac(333333333333333333n, 1000000000000000000n);
    expect(cmp(a, b)).toBe(1);
  });

  it('wrapLon 卷绕到 [-180,180)，-180 与 180 等价', () => {
    expect(cmp(wrapLon(frac(180n)), frac(-180n))).toBe(0);
    expect(cmp(wrapLon(frac(540n)), frac(-180n))).toBe(0);
    expect(cmp(wrapLon(frac(-540n)), frac(-180n))).toBe(0);
    expect(cmp(wrapLon(frac(190n)), frac(-170n))).toBe(0);
    expect(
      cmp(wrapLon(add(frac(-190n), frac(1n, 1000000n))), add(frac(170n), frac(1n, 1000000n))),
    ).toBe(0);
  });

  it('toFixed 四舍五入', () => {
    expect(toFixed(frac(-1n, 3n), 4)).toBe('-0.3333');
    expect(toFixed(frac(2n, 3n), 4)).toBe('0.6667');
  });
});
