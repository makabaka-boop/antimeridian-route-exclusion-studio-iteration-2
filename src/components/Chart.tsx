import { useRef, useCallback } from 'react';
import type { MicroPoint } from '../geometry/types';
import type { Fraction } from '../geometry/fraction';
import { toNumber } from '../geometry/fraction';
import type { RoutePiece, ZonePiece } from '../geometry/display';
import type { GlobalInterval } from '../geometry/intercept';

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

/** 按短弧展开的原始航路，在日界线处同样分段绘制。 */
function UnwrappedRoute({ raw }: { raw: MicroPoint[] }) {
  // 这里的 raw 已经是展开/校验由上层保证；画面上对未通过校验的输入仍按相邻短弧连线
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let prevLon = raw[0].lon / 1e6;
  for (let i = 0; i < raw.length - 1; i++) {
    const aLat = raw[i].lat / 1e6;
    const bLat = raw[i + 1].lat / 1e6;
    let d = raw[i + 1].lon / 1e6 - prevLon;
    while (d <= -180) d += 360;
    while (d >= 180) d -= 360;
    const nextLon = prevLon + d;

    // 沿段在 lon=180+360q 处分段
    const crossings: number[] = [];
    const lo = Math.min(prevLon, nextLon);
    const hi = Math.max(prevLon, nextLon);
    for (let q = -2; q <= 2; q++) {
      const x = 180 + 360 * q;
      if (x > lo && x < hi) crossings.push((x - prevLon) / (nextLon - prevLon));
    }
    const ts = [0, ...crossings.sort((x, y) => x - y), 1];
    for (let k = 0; k < ts.length - 1; k++) {
      const lonA = prevLon + (nextLon - prevLon) * ts[k];
      const lonB = prevLon + (nextLon - prevLon) * ts[k + 1];
      // 每个子片段按其中点所在世界窗口归一化：日界线切点贴住本侧边缘（+180°），
      // 不能把所有点各自卷绕到 [-180,180)，否则西侧短片段会被甩到 -180° 形成横跨整图的长线。
      const midLon = (lonA + lonB) / 2;
      const q = Math.floor((midLon + 180) / 360);
      const toWindow = (lon: number): number => lon - 360 * q;
      segs.push({ x1: xOf(toWindow(lonA)), y1: yOf(aLat + (bLat - aLat) * ts[k]), x2: xOf(toWindow(lonB)), y2: yOf(aLat + (bLat - aLat) * ts[k + 1]) });
    }
    prevLon = nextLon;
  }
  return (
    <>
      {segs.map((s, i) => (
        <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="route" />
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
