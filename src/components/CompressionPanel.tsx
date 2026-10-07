import type { Fraction } from '../geometry/fraction';
import { cmp, toFixed } from '../geometry/fraction';
import type { CompressionResult, EdgeCheck } from '../geometry/compress';
import type { FPoint } from '../geometry/intercept';

interface Props {
  compression: CompressionResult | null;
  previewOn: boolean;
  canPreview: boolean;
  originalSegments: number;
  onTogglePreview: () => void;
  onConfirm: () => void;
}

const fmtP = (p: FPoint): string => `${toFixed(p.lat, 4)}°, ${toFixed(p.lon, 4)}°`;
const fmtT = (t: Fraction): string => `${t.n} / ${t.d}`;

const reasonText = (e: EdgeCheck): string => {
  if (e.reason === 'ambiguous-180') return '恰好 180°，歧义边（只淘汰该边）';
  if (e.reason === 'zero-length') return '零长度（同一经线点）';
  return '触碰/进入禁区（边界计入）';
};

/**
 * 安全压缩预演面板：预演线、保留下标与命中说明都来自同一个 CompressionResult。
 * 仅预演，不改原航路；确认由父组件应用一次原子替换。
 */
export function CompressionPanel({ compression, previewOn, canPreview, originalSegments, onTogglePreview, onConfirm }: Props) {
  const unsafe = compression ? compression.edges.filter((e) => !e.safe) : [];
  const SHOW = 25;

  return (
    <section className="editor compression">
      <h3>
        安全压缩预演
        <span className="count">只保留现有航点子序列</span>
      </h3>

      <div className="add-row compression-controls">
        <button className={previewOn ? 'active' : ''} disabled={!canPreview} onClick={onTogglePreview}>
          {previewOn ? '撤销预演' : '预演安全捷径'}
        </button>
        <button disabled={!(compression?.feasible)} onClick={onConfirm}>确认采用</button>
      </div>
      {!canPreview && (
        <p className="muted">禁区或航路尚未通过校验，无法预演。</p>
      )}

      {compression && (
        compression.feasible ? (
          <div className="compression-ok">
            ✅ {compression.message}
            <table className="interval-table kept-table">
              <tbody>
                <tr>
                  <td className="muted">保留下标</td>
                  <td>{(compression.kept ?? []).join(' → ')}</td>
                </tr>
                <tr>
                  <td className="muted">航段数</td>
                  <td>{compression.segmentCount}（原 {originalSegments}）</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="error">⛔ {compression.message}</div>
        )
      )}

      {compression && (
        <div className="hits-explain">
          <h4>候选边命中说明（{unsafe.length} 条不可用 / 共 {compression.edges.length} 条候选）</h4>
          {unsafe.length === 0 ? (
            <p className="muted">所有候选捷径边均不触碰禁区。</p>
          ) : (
            <>
              <table className="interval-table">
                <thead>
                  <tr>
                    <th>边 i→j</th>
                    <th>不可用原因</th>
                    <th>进入/离开见证（seg · t，纬度, 经度）</th>
                  </tr>
                </thead>
                <tbody>
                  {unsafe.slice(0, SHOW).map((e) => (
                    <tr key={`${e.from}-${e.to}`}>
                      <td>{e.from}→{e.to}</td>
                      <td>{reasonText(e)}</td>
                      <td>
                        {e.hits?.intervals.map((iv, k) => (
                          <div key={k} className="hit-line">
                            {`进 ${iv.enter.segIndex}·${fmtT(iv.enter.t)} ${fmtP(iv.enter.geo)}`}
                            <br />
                            {`离 ${iv.exit.segIndex}·${fmtT(iv.exit.t)} ${fmtP(iv.exit.geo)}`}
                            {cmp(iv.s0, iv.s1) === 0 ? '（单点擦过）' : ''}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {unsafe.length > SHOW && (
                <p className="muted">其余 {unsafe.length - SHOW} 条不可用边未展开（图上预演线与保留下标已含全部判定）。</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
