import { useState } from 'react';
import type { MicroPoint } from './geometry/types';
import { scenarios } from './geometry/scenarios';
import { compressRoute, type CompressResult } from './geometry/compress';
import { useDerivedGeometry } from './hooks/useDerivedGeometry';
import { Chart, type EditMode } from './components/Chart';
import { IntervalTable } from './components/IntervalTable';
import { PointEditor } from './components/PointEditor';
import { CompressPanel } from './components/CompressPanel';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 预演与其数据源的绑定：源（禁区/航路原始数组）一旦被编辑替换，预演立即失效。 */
interface PreviewState {
  zoneRef: MicroPoint[];
  routeRef: MicroPoint[];
  result: CompressResult;
}

export default function App() {
  const [zoneRaw, setZoneRaw] = useState<MicroPoint[]>(scenarios[0].zone);
  const [routeRaw, setRouteRaw] = useState<MicroPoint[]>(scenarios[0].route);
  const [mode, setMode] = useState<EditMode>('none');
  const [selectedInterval, setSelectedInterval] = useState<number | null>(null);
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const derived = useDerivedGeometry(zoneRaw, routeRaw);

  // 禁区或航点编辑都会换上新数组 → 引用不等 → 旧预演立即撤销（不自动重算）
  const activePreview =
    preview && preview.zoneRef === zoneRaw && preview.routeRef === routeRaw ? preview.result : null;

  const loadScenario = (id: string) => {
    const s = scenarios.find((x) => x.id === id);
    if (!s) return;
    setScenarioId(id);
    setZoneRaw(s.zone.map((p) => ({ ...p })));
    setRouteRaw(s.route.map((p) => ({ ...p })));
    setSelectedInterval(null);
  };

  const addPoint = (p: MicroPoint) => {
    const q = { lat: clamp(p.lat, -80_000_000, 80_000_000), lon: clamp(p.lon, -540_000_000, 540_000_000) };
    if (mode === 'route') setRouteRaw((pts) => (pts.length >= 80 ? pts : [...pts, q]));
    if (mode === 'zone') setZoneRaw((pts) => (pts.length >= 20 ? pts : [...pts, q]));
  };

  const dragPoint = (kind: 'zone' | 'route', index: number, p: MicroPoint) => {
    const q = { lat: clamp(p.lat, -80_000_000, 80_000_000), lon: clamp(p.lon, -540_000_000, 540_000_000) };
    if (kind === 'zone') setZoneRaw((pts) => pts.map((x, i) => (i === index ? q : x)));
    else setRouteRaw((pts) => pts.map((x, i) => (i === index ? q : x)));
  };

  const runPreview = () => {
    if (!derived.zone || !derived.route) return;
    setPreview({ zoneRef: zoneRaw, routeRef: routeRaw, result: compressRoute(derived.zone, routeRaw) });
  };

  const confirmPreview = () => {
    if (!activePreview?.kept) return; // 无方案时没有可交付的航路
    setRouteRaw(activePreview.keptPoints.map((p) => ({ ...p })));
    setPreview(null);
    setSelectedInterval(null);
  };

  return (
    <div className="app">
      <header>
        <h1>跨日界线禁区 · 航路 SVG 编辑台</h1>
        <div className="toolbar">
          <label>
            示例：
            <select value={scenarioId} onChange={(e) => loadScenario(e.target.value)}>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <div className="modes">
            <button className={mode === 'route' ? 'active' : ''} onClick={() => setMode(mode === 'route' ? 'none' : 'route')}>
              ＋ 航路点
            </button>
            <button className={mode === 'zone' ? 'active' : ''} onClick={() => setMode(mode === 'zone' ? 'none' : 'zone')}>
              ＋ 禁区点
            </button>
            <button
              disabled={!derived.zone || !derived.route}
              title="从现有航点中保留子序列，逐边检查捷径安全（边界擦触同样不可用）"
              onClick={runPreview}
            >
              安全压缩预演
            </button>
            <button onClick={() => { setZoneRaw([]); setRouteRaw([]); setSelectedInterval(null); }}>清空</button>
          </div>
          <span className="mode-hint">
            {mode === 'none' ? '可拖拽顶点；点击进入/离开见证查看区间' : '在海图上点击追加（整数百万分之一度吸附）'}
          </span>
        </div>
        <p className="scenario-desc">{scenarios.find((s) => s.id === scenarioId)?.description}</p>
      </header>

      <main>
        <div className="chart-wrap">
          <Chart
            zoneRaw={zoneRaw}
            routeRaw={routeRaw}
            zonePieces={derived.zonePieces}
            routePieces={derived.routePieces}
            intervals={derived.result?.intervals ?? []}
            selectedInterval={selectedInterval}
            onSelectInterval={setSelectedInterval}
            mode={mode}
            onAddPoint={addPoint}
            onDragPoint={dragPoint}
            preview={activePreview?.kept ? { points: activePreview.preview, kept: activePreview.kept } : null}
          />
        </div>

        <aside>
          <PointEditor title="凸禁区（3～20 顶点，整数 micro°）" kind="zone" points={zoneRaw} error={derived.zoneError} onChange={setZoneRaw} />
          <PointEditor title="航路（2～80 点，整数 micro°）" kind="route" points={routeRaw} error={derived.routeError} onChange={setRouteRaw} />
          {activePreview && (
            <CompressPanel
              result={activePreview}
              onConfirm={confirmPreview}
              onCancel={() => setPreview(null)}
            />
          )}
          <section className="intervals">
            <h3>位于禁区内的参数区间（边界计入）</h3>
            <IntervalTable
              intervals={derived.result?.intervals ?? []}
              selected={selectedInterval}
              onSelect={setSelectedInterval}
            />
          </section>
        </aside>
      </main>
    </div>
  );
}
