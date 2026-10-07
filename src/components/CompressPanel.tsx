import type { CompressResult, VerdictReason } from '../geometry/compress';

const REASON_TEXT: Record<Exclude<VerdictReason, 'ok'>, string> = {
  'ambiguous-180': '经度恰好相差 180°，短弧歧义',
  'zero-length': '展开后为零长度航段',
  'zone-hit': '穿过禁区',
  'zone-touch': '擦触禁区边界（边界同样不可用）',
};

const REASON_ORDER: Exclude<VerdictReason, 'ok'>[] = ['zone-hit', 'zone-touch', 'ambiguous-180', 'zero-length'];

interface Props {
  result: CompressResult;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 安全压缩预演面板：预演线、保留下标与命中说明全部来自同一份 CompressResult。 */
export function CompressPanel({ result, onConfirm, onCancel }: Props) {
  const rejected = result.verdicts.filter((v) => !v.ok);
  const usable = result.verdicts.length - rejected.length;

  return (
    <section className="compress-panel">
      <h3>
        安全压缩预演
        <span className="count">{result.kept ? `${result.kept.length - 1} 航段` : '无方案'}</span>
      </h3>

      {result.kept ? (
        <>
          <p className="compress-plan">
            保留下标：{result.kept.join(' → ')}
            <br />
            <span className="muted">
              {result.kept.length} 点 / {result.kept.length - 1} 航段（航段数最少，同数下下标字典序最小）
            </span>
          </p>
          <div className="compress-actions">
            <button className="confirm" onClick={onConfirm}>确认压缩（替换航路）</button>
            <button onClick={onCancel}>放弃预演</button>
          </div>
        </>
      ) : (
        <>
          <p className="compress-infeasible">
            ⛔ 无安全压缩方案：不存在包含首尾点、且每条新航段都严格避开禁区（含边界）的航点子序列。
            不交付部分航路，原航路保持不变。
          </p>
          <div className="compress-actions">
            <button onClick={onCancel}>关闭预演</button>
          </div>
        </>
      )}

      <details className="compress-verdicts" open={rejected.length > 0 && rejected.length <= 12}>
        <summary>
          命中说明：候选边 {result.verdicts.length} 条，可用 {usable} 条，淘汰 {rejected.length} 条
          {REASON_ORDER.map((r) => {
            const c = rejected.filter((v) => v.reason === r).length;
            return c > 0 ? <span key={r} className="verdict-count"> {REASON_TEXT[r]} ×{c}</span> : null;
          })}
        </summary>
        {rejected.length === 0 ? (
          <p className="muted">所有候选边均安全。</p>
        ) : (
          <ul>
            {rejected.map((v) => (
              <li key={`${v.from}-${v.to}`}>
                边 {v.from} → {v.to}：{REASON_TEXT[v.reason as Exclude<VerdictReason, 'ok'>]}
              </li>
            ))}
          </ul>
        )}
      </details>
      <p className="muted">确认前不改动原航路；任何禁区/航点编辑都会立即撤销本预演。</p>
    </section>
  );
}
