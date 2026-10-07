import { useRef, useCallback } from 'react';
import type { MicroPoint } from '../geometry/types';
import type { Fraction } from '../geometry/fraction';
import { toNumber } from '../geometry/fraction';
import type { RoutePiece, ZonePiece } from '../geometry/display';
import type { GlobalInterval } from '../geometry/intercept';
import type { CompressionResult } from '../geometry/compress';
import { shortArcDelta } from '../geometry/unwrap';

const W = 1080;
const H = 480;
const LON_MIN = -180;
const LON_MAX = 180;
const LAT_MIN = -80;
const LAT_MAX = 80;

const xOf = (lonDeg: number): number => ((lonDeg - LON_MIN) / (LON_MAX - LON_MIN)) * W;
const yOf = (latDeg: number): number => H - ((latDeg - LAT_MIN) / (LAT_MAX - LAT_MIN)) * H;
const lonOfX = (x: number): number => LON_MIN + (x / W) * (LON_MAX - LON_MIN);
const latOfY = (y: number): number => LAT_MIN + ((H - y) / H) * (LAT_MAX - LAT_MIN);

export type EditMode = 'none' | 'route' | 'zone';

interface ChartProps {
  zoneRaw: MicroPoint[];
  routeRaw: MicroPoint[];
  zonePieces: ZonePiece[];
  routePieces: RoutePiece[];
  intervals: GlobalInterval[];
  compression: CompressionResult | null;
  selectedInterval: number | null;
  onSelectInterval: (i: number | null) => void;
  mode: EditMode;
  onAddPoint: (p: MicroPoint) => void;
  onDragPoint: (kind: 'zone' | 'route', index: number, p: MicroPoint) => void;
}

const f = (v: Fraction): number => toNumber(v);

export function Chart(props: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ kind: 'zone' | 'route'; index: number } | null>(null);

  const toMicro = useCallback((clientX: number, clientY: number): MicroPoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    const y = ((clientY - rect.top) / rect.height) * H;
    return {
      lon: Math.round(lonOfX(x) * 1_000_000),
      lat: Math.round(latOfY(y) * 1_000_000),
    };
  }, []);

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current) return;
    if (props.mode === 'none') {
      props.onSelectInterval(null);
      return;
    }
    props.onAddPoint(toMicro(e.clientX, e.clientY));
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    props.onDragPoint(d.kind, d.index, toMicro(e.clientX, e.clientY));
  };

  const startDrag = (kind: 'zone' | 'route', index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    dragRef.current = { kind, index };
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const graticule: number[] = [];
  for (let lon = -180; lon <= 180; lon += 30) graticule.push(lon);
  const parallels: number[] = [];
  for (let lat = -80; lat <= 80; lat += 20) parallels.push(lat);

  const selected = props.selectedInterval === null ? null : props.intervals[props.selectedInterval] ?? null;

  return (
    <svg
      ref={svgRef}
      className={`chart mode-${props.mode}`}
      viewBox={`0 0 ${W} ${H}`}
      onClick={onSvgClick}
      onMouseMove={onMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {/* 经纬网（纯矢量，无在线瓦片） */}
      <g className="graticule">
        {graticule.map((lon) => (
          <line key={`v${lon}`} x1={xOf(lon)} y1={0} x2={xOf(lon)} y2={H}
            className={Math.abs(lon) === 180 ? 'dateline' : undefined} />
        ))}
        {parallels.map((lat) => (
          <line key={`h${lat}`} x1={0} y1={yOf(lat)} x2={W} y2={yOf(lat)} />
        ))}
      </g>

      {/* 禁区：在日界线处切成的多边形片 */}
      <g className="zone-layer">
        {props.zonePieces.map((piece, i) => (
          <polygon
            key={i}
            points={piece.points.map((p) => `${xOf(f(p.lon))},${yOf(f(p.lat))}`).join(' ')}
            className="zone"
          />
        ))}
      </g>

      {/* 原始航路（展开折线归一化后，在日界线处分段） */}
      <g className="route-layer">
        {props.routeRaw.length >= 2 && <UnwrappedRoute raw={props.routeRaw} />}
        {props.routePieces.map((piece, pi) =>
          piece.geo.map((seg, si) => (
            <line
              key={`${pi}-${si}`}
              x1={xOf(f(seg.p0.lon))}
              y1={yOf(f(seg.p0.lat))}
              x2={xOf(f(seg.p1.lon))}
              y2={yOf(f(seg.p1.lat))}
              className="intercept"
            />
          )),
        )}
      </g>

      {/* 安全压缩预演：与保留下标、命中说明来自同一次 compressRoute，确认前不改原航路 */}
      {props.compression?.feasible && (
        <g className="preview-layer">
          <PreviewRoute
            points={props.compression.previewPoints}
            kept={props.compression.kept ?? []}
          />
        </g>
      )}

      {/* 进入/离开见证：与区间表行联动 */}
      <g className="witness-layer">
        {props.intervals.map((iv, i) => (
          <g key={i} className={props.selectedInterval === i ? 'witness selected' : 'witness'}>
            <WitnessMark w={iv.enter} kind="enter" onClick={() => props.onSelectInterval(i)} />
            <WitnessMark w={iv.exit} kind="exit" onClick={() => props.onSelectInterval(i)} />
          </g>
        ))}
        {selected && (
          <line
            x1={xOf(f(selected.enter.geo.lon))}
            y1={yOf(f(selected.enter.geo.lat))}
            x2={xOf(f(selected.exit.geo.lon))}
            y2={yOf(f(selected.exit.geo.lat))}
            className="witness-link"
          />
        )}
      </g>

      {/* 可拖拽顶点 */}
      <g className="marker-layer">
        {props.zoneRaw.map((p, i) => (
          <GeoMarker key={`z${i}`} p={p} kind="zone" onMouseDown={startDrag('zone', i)} />
        ))}
        {props.routeRaw.map((p, i) => (
          <GeoMarker key={`r${i}`} p={p} kind="route" index={i} onMouseDown={startDrag('route', i)} />
        ))}
      </g>

      <text x={8} y={16} className="hint">
        日界线（±180°）以红色加粗标出 · 被截航路与区间表来自同一份计算结果
      </text>
    </svg>
  );
}

/**
 * 把一条**已经按短弧展开到同一平面**的折线（microdegree）切成画面线段：
 * 沿每个 180+360q 内部交点断开，子片段按其中点所在世界窗口归一化，
 * 日界线切点贴住本侧边缘（+180°），杜绝横跨整图的连线。
 */
function liftedRouteScreenSegments(points: MicroPoint[]): { x1: number; y1: number; x2: number; y2: number }[] {
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const aLat = points[i].lat / 1e6;
    const bLat = points[i + 1].lat / 1e6;
    const prevLon = points[i].lon / 1e6;
    const nextLon = points[i + 1].lon / 1e6;

    const lo = Math.min(prevLon, nextLon);
    const hi = Math.max(prevLon, nextLon);
    // 内部穿越点 q 满足 lo < 180+360q < hi（短弧边跨度 <180°，至多一个）
    const qLo = Math.floor((lo - 180) / 360) + 1;
    const qHi = Math.ceil((hi - 180) / 360) - 1;
    const crossings: number[] = [];
    for (let q = qLo; q <= qHi; q++) {
      const x = 180 + 360 * q;
      crossings.push((x - prevLon) / (nextLon - prevLon));
    }
    const ts = [0, ...crossings.sort((x, y) => x - y), 1];
    for (let k = 0; k < ts.length - 1; k++) {
      const lonA = prevLon + (nextLon - prevLon) * ts[k];
      const lonB = prevLon + (nextLon - prevLon) * ts[k + 1];
      // 每个子片段按其中点所在世界窗口归一化（与 display.ts 同口径）
      const midLon = (lonA + lonB) / 2;
      const q = Math.floor((midLon + 180) / 360);
      const toWindow = (lon: number): number => lon - 360 * q;
      segs.push({ x1: xOf(toWindow(lonA)), y1: yOf(aLat + (bLat - aLat) * ts[k]), x2: xOf(toWindow(lonB)), y2: yOf(aLat + (bLat - aLat) * ts[k + 1]) });
    }
  }
  return segs;
}

/** 按短弧展开的原始航路，在日界线处同样分段绘制。 */
function UnwrappedRoute({ raw }: { raw: MicroPoint[] }) {
  // 这里的 raw 已由上层展开/校验；画面上对未通过校验的输入仍按相邻短弧连线；
  // 恰好 180° 的边是歧义边，无法画出唯一走向，停在该边之前。
  const lifted: MicroPoint[] = [{ lat: raw[0].lat, lon: raw[0].lon }];
  for (let i = 1; i < raw.length; i++) {
    let d: number;
    try {
      d = shortArcDelta(raw[i].lon, lifted[i - 1].lon);
    } catch {
      break;
    }
    lifted.push({ lat: raw[i].lat, lon: lifted[i - 1].lon + d });
  }
  if (lifted.length < 2) return null;
  return (
    <>
      {liftedRouteScreenSegments(lifted).map((s, i) => (
        <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="route" />
      ))}
    </>
  );
}

/**
 * 安全压缩预演线：展开坐标直接取自压缩结果（与保留下标、命中说明同一次计算）。
 * 保留点画描边环并标注原航路点下标；归一化窗口取所在边的窗口，切点贴本侧。
 */
function PreviewRoute({ points, kept }: { points: MicroPoint[]; kept: number[] }) {
  const screen = liftedRouteScreenSegments(points);
  const markers: { x: number; y: number; index: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    // 用所在边（末点用前一边）中点定窗口，使贴 180° 的点落在 +180° 一侧
    const edge = i < points.length - 1 ? i : i - 1;
    const midLon = (points[edge].lon + points[edge + 1].lon) / 2 / 1e6;
    const q = Math.floor((midLon + 180) / 360);
    markers.push({
      x: xOf(points[i].lon / 1e6 - 360 * q),
      y: yOf(points[i].lat / 1e6),
      index: kept[i],
    });
  }
  return (
    <>
      {screen.map((s, i) => (
        <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="preview" />
      ))}
      {markers.map((m, i) => (
        <g key={i} className="preview-marker">
          <circle cx={m.x} cy={m.y} r={7} className="preview-ring" />
          <text x={m.x} y={m.y + 3.5}>{m.index}</text>
        </g>
      ))}
    </>
  );
}

const wrapToView = (lonDeg: number): number => {
  let w = lonDeg;
  while (w < -180) w += 360;
  while (w >= 180) w -= 360;
  return w;
};

function GeoMarker({ p, kind, index, onMouseDown }: { p: MicroPoint; kind: 'zone' | 'route'; index?: number; onMouseDown: (e: React.MouseEvent) => void }) {
  const lon = wrapToView(p.lon / 1e6);
  const lat = p.lat / 1e6;
  if (lat < LAT_MIN || lat > LAT_MAX) return null;
  return (
    <g onMouseDown={onMouseDown} className={`marker marker-${kind}`}>
      <circle cx={xOf(lon)} cy={yOf(lat)} r={kind === 'zone' ? 5 : 4} />
      {index !== undefined && (
        <text x={xOf(lon) + 7} y={yOf(lat) - 6}>{index}</text>
      )}
    </g>
  );
}

function WitnessMark({ w, kind, onClick }: { w: GlobalInterval['enter']; kind: 'enter' | 'exit'; onClick: () => void }) {
  const cx = xOf(f(w.geo.lon));
  const cy = yOf(f(w.geo.lat));
  return (
    <g onClick={(e) => { e.stopPropagation(); onClick(); }} className={`witness-mark witness-${kind}`}>
      {kind === 'enter'
        ? <polygon points={`${cx},${cy - 7} ${cx - 6},${cy + 5} ${cx + 6},${cy + 5}`} />
        : <circle cx={cx} cy={cy} r={6} />}
    </g>
  );
}
