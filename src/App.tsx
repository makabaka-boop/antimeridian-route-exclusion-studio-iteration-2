import { useState } from 'react';
import type { MicroPoint } from './geometry/types';
import { scenarios } from './geometry/scenarios';
import { useDerivedGeometry } from './hooks/useDerivedGeometry';
import { Chart, type EditMode } from './components/Chart';
import { IntervalTable } from './components/IntervalTable';
import { PointEditor } from './components/PointEditor';
import { CompressionPanel } from './components/CompressionPanel';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export default function App() {
  const [zoneRaw, setZoneRaw] = useState<MicroPoint[]>(scenarios[0].zone);
  const [routeRaw, setRouteRaw] = useState<MicroPoint[]>(scenarios[0].route);
  const [mode, setMode] = useState<EditMode>('none');
  const [selectedInterval, setSelectedInterval] = useState<number | null>(null);
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  // 安全压缩预演是显式请求；任何禁区/航路编辑都立即撤销旧预演
  const [compressionPreview, setCompressionPreview] = useState(false);

  const derived = useDerivedGeometry(zoneRaw, routeRaw, compressionPreview);
  const geometryValid = !derived.zoneError && !derived.routeError;

  const loadScenario = (id: string) => {
    const s = scenarios.find((x) => x.id === id);
    if (!s) return;
    setScenarioId(id);
    setZoneRaw(s.zone.map((p) => ({ ...p })));
    setRouteRaw(s.route.map((p) => ({ ...p })));
    setSelectedInterval(null);
    setCompressionPreview(false);
  };

  const addPoint = (p: MicroPoint) => {
    const q = { lat: clamp(p.lat, -80_000_000, 80_000_000), lon: clamp(p.lon, -540_000_000, 540_000_000) };
    if (mode === 'route') setRouteRaw((pts) => (pts.length >= 80 ? pts : [...pts, q]));
    if (mode === 'zone') setZoneRaw((pts) => (pts.length >= 20 ? pts : [...pts, q]));
    setCompressionPreview(false);
  };

  const dragPoint = (kind: 'zone' | 'route', index: number, p: MicroPoint) => {
    const q = { lat: clamp(p.lat, -80_000_000, 80_000_000), lon: clamp(p.lon, -540_000_000, 540_000_000) };
    if (kind === 'zone') setZoneRaw((pts) => pts.map((x, i) => (i === index ? q : x)));
    else setRouteRaw((pts) => pts.map((x, i) => (i === index ? q : x)));
    setCompressionPreview(false);
  };

  const editRoute = (pts: MicroPoint[]) => {
    setRouteRaw(pts);
    setSelectedInterval(null);
    setCompressionPreview(false);
  };
  const editZone = (pts: MicroPoint[]) => {
    setZoneRaw(pts);
    setSelectedInterval(null);
    setCompressionPreview(false);
  };

  // 确认预演：一次性原子替换航路为保留下标的子序列，随后撤销预演
  const confirmCompression = () => {
    const c = derived.compression;
    if (!c?.feasible || !c.kept) return;
    setRouteRaw(c.kept.map((i) => ({ ...routeRaw[i] })));
    setSelectedInterval(null);
    setCompressionPreview(false);
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
            <button onClick={() => { setZoneRaw([]); setRouteRaw([]); setSelectedInterval(null); setCompressionPreview(false); }}>清空</button>
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
            compression={compressionPreview ? derived.compression : null}
            selectedInterval={selectedInterval}
            onSelectInterval={setSelectedInterval}
            mode={mode}
            onAddPoint={addPoint}
            onDragPoint={dragPoint}
          />
        </div>

        <aside>
          <PointEditor title="凸禁区（3～20 顶点，整数 micro°）" kind="zone" points={zoneRaw} error={derived.zoneError} onChange={editZone} />
          <PointEditor title="航路（2～80 点，整数 micro°）" kind="route" points={routeRaw} error={derived.routeError} onChange={editRoute} />
          <CompressionPanel
            compression={compressionPreview ? derived.compression : null}
            previewOn={compressionPreview}
            canPreview={geometryValid}
            originalSegments={Math.max(routeRaw.length - 1, 0)}
            onTogglePreview={() => setCompressionPreview((v) => !v)}
            onConfirm={confirmCompression}
          />
          <section className="intervals">
            <h3>位于禁区内的参数区间（边界计入，原航路口径）</h3>
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
