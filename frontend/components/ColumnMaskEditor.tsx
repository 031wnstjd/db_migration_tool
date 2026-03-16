'use client';

import { ColumnMaskMode, ColumnMaskRule } from '../lib/types';

const MODES: ColumnMaskMode[] = ['NONE', 'NULL', 'FIXED', 'HASH', 'PARTIAL'];

type Props = {
  availableColumns: string[];
  masks: ColumnMaskRule[];
  onChange: (columnName: string, values: Pick<ColumnMaskRule, 'mode' | 'value'>) => void;
};

export default function ColumnMaskEditor({ availableColumns, masks, onChange }: Props) {
  const currentRule = (col: string) =>
    masks.find((m) => m.column_name === col) || { column_name: col, mode: 'NONE' as const, value: null };

  const configuredMaskCount = masks.filter((mask) => mask.mode !== 'NONE').length;

  return (
    <details className="mask-editor">
      <summary className="mask-editor-summary">
        <div>
          <h3 className="card-title">컬럼 마스킹</h3>
          <p className="helper">기본은 접힘 상태입니다. 필요할 때 펼쳐 컬럼별 규칙을 설정하세요.</p>
        </div>
        <span className="badge neutral">설정 {configuredMaskCount}개</span>
      </summary>

      <div className="mask-editor-body panel">
        {availableColumns.length === 0 ? (
          <p className="helper">공통 컬럼을 먼저 선택하세요.</p>
        ) : (
          availableColumns.map((col) => {
            const rule = currentRule(col);
            return (
              <div key={col} className="mask-row">
                <label>
                  <span className="label">{col}</span>
                  <select
                    className="select"
                    value={rule.mode}
                    onChange={(e) => onChange(col, { ...rule, mode: e.target.value as ColumnMaskMode })}
                  >
                    {MODES.map((mode) => (
                      <option value={mode} key={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label">고정값</span>
                  <input
                    className="input"
                    value={rule.mode === 'FIXED' ? rule.value || '' : ''}
                    onChange={(e) => onChange(col, { ...rule, value: e.target.value })}
                    disabled={rule.mode !== 'FIXED'}
                    placeholder={rule.mode === 'FIXED' ? '값 입력' : '모드가 FIXED일 때만 사용'}
                  />
                </label>
              </div>
            );
          })
        )}
      </div>
    </details>
  );
}
