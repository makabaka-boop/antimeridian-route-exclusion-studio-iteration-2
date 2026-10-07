/** 约分后的不可变有理数，符号统一放在分子。所有几何判定都基于它，避免浮点误差。 */
export interface Fraction {
  n: bigint;
  d: bigint; // 始终为正
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x || 1n;
};

export const frac = (n: bigint, d: bigint = 1n): Fraction => {
  if (d === 0n) throw new Error('fraction denominator is zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};

export const fromInt = (n: bigint | number): Fraction => frac(BigInt(n));

export const add = (a: Fraction, b: Fraction): Fraction =>
  frac(a.n * b.d + b.n * a.d, a.d * b.d);

export const sub = (a: Fraction, b: Fraction): Fraction =>
  frac(a.n * b.d - b.n * a.d, a.d * b.d);

export const mul = (a: Fraction, b: Fraction): Fraction =>
  frac(a.n * b.n, a.d * b.d);

export const div = (a: Fraction, b: Fraction): Fraction => {
  if (b.n === 0n) throw new Error('division by zero fraction');
  return frac(a.n * b.d, a.d * b.n);
};

/** 线性插值：a + (b-a) * t */
export const lerp = (a: Fraction, b: Fraction, t: Fraction): Fraction =>
  add(a, mul(sub(b, a), t));

/** 精确比较：-1 / 0 / 1 */
export const cmp = (a: Fraction, b: Fraction): number => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};

export const eq = (a: Fraction, b: Fraction): boolean => cmp(a, b) === 0;
export const lt = (a: Fraction, b: Fraction): boolean => cmp(a, b) < 0;
export const gt = (a: Fraction, b: Fraction): boolean => cmp(a, b) > 0;
export const lte = (a: Fraction, b: Fraction): boolean => cmp(a, b) <= 0;
export const gte = (a: Fraction, b: Fraction): boolean => cmp(a, b) >= 0;

export const minF = (a: Fraction, b: Fraction): Fraction => (lt(a, b) ? a : b);
export const maxF = (a: Fraction, b: Fraction): Fraction => (gt(a, b) ? a : b);

/** 向下取整（BigInt），对负数正确。 */
export const floorF = (a: Fraction): bigint => {
  const q = a.n / a.d;
  const r = a.n % a.d;
  return r < 0n ? q - 1n : q;
};

/** 真模：结果落在 [0, m)（m 为正）。 */
export const modF = (a: Fraction, m: Fraction): Fraction => {
  const r = sub(a, mul(m, fromInt(floorF(div(a, m)))));
  return eq(r, m) ? frac(0n) : r;
};

/** 把经度（分数单位：度）卷绕到 [-180, 180)。 */
export const wrapLon = (lonDeg: Fraction): Fraction =>
  sub(modF(add(lonDeg, fromInt(180)), fromInt(360)), fromInt(180));

/** 转成有限 number，仅供绘制/显示。 */
export const toNumber = (a: Fraction): number => Number(a.n) / Number(a.d);

/** 固定 6 位小数显示（百万分之一度精度）。 */
export const toFixed = (a: Fraction, digits = 6): string => {
  const scale = 10 ** digits;
  const n = a.n < 0n ? -a.n : a.n;
  const whole = n / a.d;
  const rest = n - whole * a.d;
  const rounded = (Number(rest) * scale) / Number(a.d);
  // 四舍五入并处理进位
  const scaledInt = Math.floor(rounded + 0.5);
  const carry = Math.floor(scaledInt / scale);
  const fracPart = String(scaledInt % scale).padStart(digits, '0');
  const wholeNum = Number(whole) + carry;
  return `${a.n < 0n ? '-' : ''}${wholeNum}.${fracPart}`;
};
