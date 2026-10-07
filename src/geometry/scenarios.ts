import type { MicroPoint } from './types';

const deg = (v: number): number => Math.round(v * 1_000_000);

export interface Scenario {
  id: string;
  name: string;
  description: string;
  zone: MicroPoint[];
  route: MicroPoint[];
}

/** 跨日界线矩形（顶点顺序故意给成顺时针，由 createZone 统一翻成逆时针） */
const crossingBox: MicroPoint[] = [
  { lat: deg(10), lon: deg(170) },
  { lat: deg(10), lon: deg(-170) },
  { lat: deg(0), lon: deg(-170) },
  { lat: deg(0), lon: deg(170) },
];

export const scenarios: Scenario[] = [
  {
    id: 'crossing',
    name: '跨 ±180° 禁区',
    description: '矩形 170°E~170°W（0°~10°N），航路 150°E→150°W 沿 5°N 横穿日界线。',
    zone: crossingBox,
    route: [
      { lat: deg(5), lon: deg(150) },
      { lat: deg(5), lon: deg(-150) },
    ],
  },
  {
    id: 'equivalent',
    name: '两侧经度等价表示',
    description: '同一个禁区/航路用 190° 而不是 -170° 录入，结果必须与上一场景一致。',
    zone: [
      { lat: deg(10), lon: deg(170) },
      { lat: deg(10), lon: deg(190) },
      { lat: deg(0), lon: deg(190) },
      { lat: deg(0), lon: deg(170) },
    ],
    route: [
      { lat: deg(5), lon: deg(150) },
      { lat: deg(5), lon: deg(210) },
    ],
  },
  {
    id: 'graze',
    name: '顶点擦过',
    description: '航路沿两条边的外向延长线只碰到矩形西南角一个顶点：区间退化为单点，进入与离开见证相同。',
    zone: [
      { lat: deg(0), lon: deg(0) },
      { lat: deg(20), lon: deg(0) },
      { lat: deg(20), lon: deg(20) },
      { lat: deg(0), lon: deg(20) },
    ],
    route: [
      { lat: deg(-20), lon: deg(0) },
      { lat: deg(0), lon: deg(0) },
      { lat: deg(0), lon: deg(-20) },
    ],
  },
  {
    id: 'edgewalk',
    name: '沿边行走',
    description: '一段航路与禁区边重合（边界计入禁区），另一段贴着同一条边延长线。',
    zone: [
      { lat: deg(0), lon: deg(0) },
      { lat: deg(20), lon: deg(0) },
      { lat: deg(20), lon: deg(20) },
      { lat: deg(0), lon: deg(20) },
    ],
    route: [
      { lat: deg(10), lon: deg(-20) },
      { lat: deg(10), lon: deg(0) },
      { lat: deg(10), lon: deg(20) },
      { lat: deg(10), lon: deg(40) },
    ],
  },
  {
    id: 'loop',
    name: '跨线闭合环',
    description: '禁区绕日界线闭合；航路在 180° 两侧各进出一次，相邻区间不合并。',
    zone: crossingBox,
    route: [
      { lat: deg(5), lon: deg(160) },
      { lat: deg(5), lon: deg(175) },
      { lat: deg(5), lon: deg(-175) },
      { lat: deg(5), lon: deg(-160) },
      { lat: deg(-10), lon: deg(-160) },
      { lat: deg(-10), lon: deg(160) },
    ],
  },
  {
    id: 'ambiguous',
    name: '180° 歧义边（应拒绝）',
    description: '禁区一条边经度恰好跨 180°，编辑器应直接拒绝。',
    zone: [
      { lat: deg(10), lon: deg(180) },
      { lat: deg(10), lon: deg(-180) },
      { lat: deg(-10), lon: deg(-170) },
    ],
    route: [
      { lat: deg(0), lon: deg(170) },
      { lat: deg(0), lon: deg(-170) },
    ],
  },
  {
    id: 'nonconvex',
    name: '非凸/自交（应拒绝）',
    description: '凹形禁区，编辑器应直接拒绝。',
    zone: [
      { lat: deg(0), lon: deg(0) },
      { lat: deg(20), lon: deg(0) },
      { lat: deg(5), lon: deg(10) },
      { lat: deg(20), lon: deg(20) },
      { lat: deg(0), lon: deg(20) },
    ],
    route: [
      { lat: deg(10), lon: deg(-10) },
      { lat: deg(10), lon: deg(30) },
    ],
  },
];
