import { useState } from 'react';
import type { MicroPoint } from '../geometry/types';

interface Props {
  title: string;
  kind: 'zone' | 'route';
  points: MicroPoint[];
  error: string | null;
  onChange: (points: MicroPoint[]) => void;
}

/** 整数百万分之一度的点表编辑：可改坐标、删除、在末尾追加。 */
export function PointEditor({ title, kind, points, error, onChange }: Props) {
  const [draft, setDraft] = useState({ lat: '0', lon: '0' });

  const update = (i: number, key: 'lat' | 'lon', raw: string) => {
    const v = Math.trunc(Number(raw));
    if (!Number.isFinite(v)) return;
    onChange(points.map((p, j) => (j === i ? { ...p, [key]: v } : p)));
  };

  const remove = (i: number) => onChange(points.filter((_, j) => j !== i));

  const add = () => {
    const lat = Math.trunc(Number(draft.lat));
    const lon = Math.trunc(Number(draft.lon));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      onChange([...points, { lat, lon }]);
    }
  };

  return (
    <section className={`editor editor-${kind}`}>
      <h3>
        {title}
        <span className="count">{points.length} 点</span>
      </h3>
      {error && <div className="error">⛔ {error}</div>}
      <table className="point-table">
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td className="idx">{i}</td>
              <td>
                <input
                  value={p.lat}
                  onChange={(e) => update(i, 'lat', e.target.value)}
                  aria-label="纬度 microdegrees"
                />
              </td>
              <td>
                <input
                  value={p.lon}
                  onChange={(e) => update(i, 'lon', e.target.value)}
                  aria-label="经度 microdegrees"
                />
              </td>
              <td className="deg">{`${(p.lat / 1e6).toFixed(2)}, ${(p.lon / 1e6).toFixed(2)}`}</td>
              <td>
                <button onClick={() => remove(i)} title="删除顶点">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="add-row">
        <input value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: e.target.value })} aria-label="新增纬度" />
        <input value={draft.lon} onChange={(e) => setDraft({ ...draft, lon: e.target.value })} aria-label="新增经度" />
        <button onClick={add}>追加 {kind === 'zone' ? '禁区顶点' : '航路点'}</button>
      </div>
    </section>
  );
}
