import type { GlobalInterval, FPoint } from '../geometry/intercept';
import type { Fraction } from '../geometry/fraction';
import { toFixed } from '../geometry/fraction';

const fmt = (v: FPoint): string => `${toFixed(v.lat, 4)}°, ${toFixed(v.lon, 4)}°`;
const fmtT = (v: Fraction): string => `${v.n.toString()} / ${v.d.toString()}`;

interface Props {
  intervals: GlobalInterval[];
  selected: number | null;
  onSelect: (i: number | null) => void;
}

/** 进入/离开见证表；行与图上的见证点双向高亮。 */
export function IntervalTable({ intervals, selected, onSelect }: Props) {
  if (intervals.length === 0) {
    return <p className="muted">航路全程位于禁区外。</p>;
  }
  return (
    <table className="interval-table">
      <thead>
        <tr>
          <th>#</th>
          <th>进入（航段, 局部 t）</th>
          <th>进入见证 纬度, 经度</th>
          <th>离开（航段, 局部 t）</th>
          <th>离开见证 纬度, 经度</th>
        </tr>
      </thead>
      <tbody>
        {intervals.map((iv, i) => (
          <tr
            key={i}
            className={selected === i ? 'selected' : ''}
            onClick={() => onSelect(selected === i ? null : i)}
          >
            <td>{i + 1}</td>
            <td>{iv.enter.segIndex} · {fmtT(iv.enter.t)}</td>
            <td>{fmt(iv.enter.geo)}</td>
            <td>{iv.exit.segIndex} · {fmtT(iv.exit.t)}</td>
            <td>{fmt(iv.exit.geo)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
