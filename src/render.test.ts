import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import App from './App';
import { Chart } from './components/Chart';
import { CompressPanel } from './components/CompressPanel';
import { scenarios } from './geometry/scenarios';
import { createZone } from './geometry/zone';
import { createRoute } from './geometry/route';
import { analyzeRoute } from './geometry/intercept';
import { buildRoutePieces, buildZonePieces } from './geometry/display';
import { compressRoute } from './geometry/compress';

const noop = () => undefined;

/** 跨线绕行场景：直达边横穿禁区，最优保留 [0,1,3]（与 compress.test.ts 一致）。 */
const zoneRaw = [
  { lat: 10_000_000, lon: 170_000_000 },
  { lat: 10_000_000, lon: -170_000_000 },
  { lat: 0, lon: -170_000_000 },
  { lat: 0, lon: 170_000_000 },
];
const routeRaw = [
  { lat: 5_000_000, lon: 160_000_000 },
  { lat: 20_000_000, lon: 175_000_000 },
  { lat: 20_000_000, lon: -175_000_000 },
  { lat: 5_000_000, lon: -160_000_000 },
];

function chartProps(withPreview: boolean) {
  const zone = createZone(zoneRaw);
  const route = createRoute(routeRaw);
  const result = analyzeRoute(zone.points, zone, route.points);
  const compress = compressRoute(zone, routeRaw);
  expect(compress.kept).toEqual([0, 1, 3]);
  return {
    zoneRaw,
    routeRaw,
    zonePieces: buildZonePieces(zone.points),
    routePieces: buildRoutePieces(route.points, result.segHits),
    intervals: result.intervals,
    selectedInterval: null,
    onSelectInterval: noop,
    mode: 'none' as const,
    onAddPoint: noop,
    onDragPoint: noop,
    preview: withPreview && compress.kept ? { points: compress.preview, kept: compress.kept } : null,
  };
}

describe('React/SVG 贯通（渲染级冒烟）', () => {
  it('App 整树渲染不抛错，包含压缩预演入口', () => {
    const html = renderToString(createElement(App));
    expect(html).toContain('安全压缩预演');
    expect(html).toContain('位于禁区内的参数区间');
  });

  it('预演折线与保留下标圆环来自同一份结果并画进 SVG', () => {
    const withPreview = renderToString(createElement(Chart, chartProps(true)));
    expect(withPreview).toContain('class="preview"');
    expect(withPreview).toContain('preview-keep');
    // 3 个保留下标 → 3 个圆环
    expect(withPreview.match(/preview-keep/g)).toHaveLength(3);
    const without = renderToString(createElement(Chart, chartProps(false)));
    expect(without).not.toContain('class="preview"');
  });

  it('无方案结果在面板中明确报告，且不提供确认按钮', () => {
    const zone = createZone([
      { lat: -30_000_000, lon: -30_000_000 },
      { lat: -30_000_000, lon: 30_000_000 },
      { lat: 30_000_000, lon: 30_000_000 },
      { lat: 30_000_000, lon: -30_000_000 },
    ]);
    const infeasible = compressRoute(zone, [
      { lat: 0, lon: -40_000_000 },
      { lat: 0, lon: 0 },
      { lat: 0, lon: 40_000_000 },
    ]);
    expect(infeasible.kept).toBeNull();
    const html = renderToString(createElement(CompressPanel, { result: infeasible, onConfirm: noop, onCancel: noop }));
    expect(html).toContain('无安全压缩方案');
    expect(html).toContain('不交付部分航路');
    expect(html).not.toContain('确认压缩');
    expect(html).toContain('穿过禁区');
  });

  it('有方案结果在面板中给出保留下标与确认入口', () => {
    const zone = createZone(zoneRaw);
    const compress = compressRoute(zone, routeRaw);
    const html = renderToString(createElement(CompressPanel, { result: compress, onConfirm: noop, onCancel: noop }));
    expect(html).toContain('0 → 1 → 3');
    expect(html).toContain('确认压缩');
  });

  it('默认场景（含编辑台壳）渲染出经纬网与航路', () => {
    const html = renderToString(createElement(App));
    expect(html).toContain('graticule');
    expect(html).toContain('route-layer');
    expect(scenarios.length).toBeGreaterThan(0);
  });
});
