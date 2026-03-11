'use client';

import { ChangeEvent } from 'react';
import { ColumnMetadata, ColumnMaskRule, StrategyType } from '../lib/types';
import { intersectColumns } from '../lib/mappers';
import ColumnMaskEditor from './ColumnMaskEditor';

type Role = 'source' | 'target';
type BusyFlags = {
  sourceTables: boolean;
  targetTables: boolean;
  columns: boolean;
};

export type MappingCardPayload = {
  id: string;
  source_schema: string;
  source_table: string;
  target_schema: string;
  target_table: string;
  selected_columns: string[];
  key_columns: string[];
  strategy: StrategyType;
  truncate_before_load: boolean;
  date_filter_column: string;
  date_from: string;
  date_to: string;
  row_limit: number | null;
  batch_size: number;
  masks: ColumnMaskRule[];

  source_tables: string[];
  target_tables: string[];
  source_columns: ColumnMetadata[];
  target_columns: ColumnMetadata[];
  source_pks: string[];
  source_dates: string[];
};

type Props = {
  index: number;
  cfg: MappingCardPayload;
  onUpdate: (id: string, field: keyof MappingCardPayload, value: unknown) => void;
  onFetchTables: (id: string, role: Role) => Promise<void>;
  onFetchColumns: (id: string) => Promise<void>;
  onRemove: (id: string) => void;
  loading: BusyFlags;
  disableActions?: boolean;
};

const strategies: StrategyType[] = ['INSERT', 'MERGE', 'DELETE_INSERT'];

const toList = (arr: string[]) => arr.join(',');

export default function TableMappingCard({
  index,
  cfg,
  onUpdate,
  onFetchTables,
  onFetchColumns,
  onRemove,
  loading,
  disableActions,
}: Props) {
  const onText = (field: keyof MappingCardPayload) => (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    onUpdate(cfg.id, field, value);
  };

  const onSelect = (field: keyof MappingCardPayload) => (e: ChangeEvent<HTMLSelectElement>) => {
    onUpdate(cfg.id, field, e.target.value);
  };

  const onChecked = (field: keyof MappingCardPayload) => (e: ChangeEvent<HTMLInputElement>) => {
    onUpdate(cfg.id, field, e.target.checked);
  };

  const commonColumns = intersectColumns(
    cfg.source_columns.map((c) => c.column_name),
    cfg.target_columns.map((c) => c.column_name),
  );

  const pkDefaults = intersectColumns(cfg.source_pks, commonColumns);

  return (
    <section className="card section">
      <div className="flex-gap" style={{ justifyContent: 'space-between' }}>
        <h3 className="card-title">매핑 #{index + 1}</h3>
        <button className="btn" type="button" onClick={() => onRemove(cfg.id)} disabled={disableActions}>
          이 매핑 삭제
        </button>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 className="card-title">Source</h3>
          <label>
            <span className="label">Source Schema (optional)</span>
            <input className="input" value={cfg.source_schema} onChange={onText('source_schema')} disabled={disableActions} />
          </label>
        <label>
            <span className="label">Source Table</span>
            <div className="grid-2">
              <input className="input" value={cfg.source_table} onChange={onText('source_table')} disabled={disableActions} />
              <button
                className="btn"
                type="button"
                onClick={() => onFetchTables(cfg.id, 'source')}
                disabled={disableActions || loading.sourceTables}
              >
                {loading.sourceTables ? '조회 중…' : 'Source 테이블 목록 조회'}
              </button>
            </div>
          </label>
          {cfg.source_tables.length > 0 && (
            <select
              className="select"
              value={cfg.source_table && cfg.source_tables.includes(cfg.source_table) ? cfg.source_table : ''}
              onChange={(e) => onUpdate(cfg.id, 'source_table', e.target.value)}
            >
              <option value="">선택</option>
              {cfg.source_tables.map((t) => (
                <option key={`${cfg.id}-src-${t}`} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="panel">
          <h3 className="card-title">Target</h3>
          <label>
            <span className="label">Target Schema (optional)</span>
            <input className="input" value={cfg.target_schema} onChange={onText('target_schema')} disabled={disableActions} />
          </label>
        <label>
            <span className="label">Target Table</span>
            <div className="grid-2">
              <input className="input" value={cfg.target_table} onChange={onText('target_table')} disabled={disableActions} />
              <button
                className="btn"
                type="button"
                onClick={() => onFetchTables(cfg.id, 'target')}
                disabled={disableActions || loading.targetTables}
              >
                {loading.targetTables ? '조회 중…' : 'Target 테이블 목록 조회'}
              </button>
            </div>
          </label>
          {cfg.target_tables.length > 0 && (
            <select
              className="select"
              value={cfg.target_table && cfg.target_tables.includes(cfg.target_table) ? cfg.target_table : ''}
              onChange={(e) => onUpdate(cfg.id, 'target_table', e.target.value)}
            >
              <option value="">선택</option>
              {cfg.target_tables.map((t) => (
                <option key={`${cfg.id}-tgt-${t}`} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex-gap" style={{ justifyContent: 'flex-start', marginTop: '0.35rem' }}>
        <button
          className="btn"
          type="button"
          onClick={() => onFetchColumns(cfg.id)}
          disabled={disableActions || loading.columns}
        >
          {loading.columns ? '조회 중…' : '컬럼/PK 조회'}
        </button>
      </div>

      <div className="divider" />

      <div className="panel">
        <label>
          <span className="label">전략</span>
          <select className="select" value={cfg.strategy} onChange={onSelect('strategy')} disabled={disableActions}>
            {strategies.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="grid-2">
          <label>
            <span className="label">날짜 기준 컬럼</span>
            <select
              className="select"
              value={cfg.date_filter_column || ''}
              onChange={(e) => onUpdate(cfg.id, 'date_filter_column', e.target.value)}
              disabled={disableActions}
            >
              <option value="">없음</option>
              {cfg.source_dates.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">시작일</span>
            <input className="input" value={cfg.date_from} onChange={onText('date_from')} placeholder="YYYY-MM-DD" disabled={disableActions} />
          </label>
          <label>
            <span className="label">종료일</span>
            <input className="input" value={cfg.date_to} onChange={onText('date_to')} placeholder="YYYY-MM-DD" disabled={disableActions} />
          </label>
          <label>
            <span className="label">Row Limit(0=무제한)</span>
            <input
              className="input"
              type="number"
              min={0}
              value={cfg.row_limit || 0}
              onChange={(e) => onUpdate(cfg.id, 'row_limit', Number(e.target.value))}
              disabled={disableActions}
            />
          </label>
        </div>

        <div className="grid-3">
          <label>
            <span className="label">Batch Size</span>
            <input
              className="input"
              type="number"
              min={1}
              value={cfg.batch_size}
              onChange={(e) => onUpdate(cfg.id, 'batch_size', Number(e.target.value))}
              disabled={disableActions}
            />
          </label>
          <label>
            <span className="label">사전 비우기</span>
            <input
              type="checkbox"
              className="select"
              checked={cfg.truncate_before_load}
              onChange={onChecked('truncate_before_load')}
              disabled={disableActions}
            />
          </label>
        </div>
      </div>

      <label>
        <span className="label">공통 컬럼 (선택/해제)</span>
        <select
          multiple
          className="select"
          value={cfg.selected_columns}
          size={Math.min(7, Math.max(4, commonColumns.length + 1))}
          onChange={(e) => {
            const next = Array.from(e.target.selectedOptions).map((o) => o.value);
            const keyColumns = cfg.key_columns.filter((k) => next.includes(k));
            onUpdate(cfg.id, 'selected_columns', next);
            onUpdate(cfg.id, 'key_columns', keyColumns);
          }}
          disabled={disableActions}
        >
          {commonColumns.length === 0 ? <option disabled value="">공통 컬럼이 없습니다</option> : null}
          {commonColumns.map((col) => (
            <option value={col} key={`${cfg.id}-common-${col}`}>
              {col}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="label">Key 컬럼</span>
        <select
          multiple
          className="select"
          size={Math.min(6, Math.max(4, cfg.selected_columns.length + 1))}
          value={cfg.key_columns}
          onChange={(e) => {
            const next = Array.from(e.target.selectedOptions).map((o) => o.value);
            onUpdate(cfg.id, 'key_columns', next);
          }}
          disabled={disableActions}
        >
          {(cfg.key_columns.length === 0 && cfg.selected_columns.length > 0)
            ? pkDefaults
                .filter((pk) => cfg.selected_columns.includes(pk))
                .map((col) => col)
                .concat()
                .map((col) => (
                  <option value={col} key={`${cfg.id}-key-${col}`}>
                    {col} (기본 PK)
                  </option>
                ))
            : cfg.selected_columns.map((col) => (
                <option value={col} key={`${cfg.id}-key-${col}`}>
                  {col}
                </option>
              ))}
        </select>
        <p className="helper">MERGE/DELETE_INSERT는 key 컬럼이 필요합니다. DB 독립성을 위해 내부적으로 update+insert/delete+insert 방식으로 처리됩니다.</p>
      </label>

      <ColumnMaskEditor
        availableColumns={cfg.selected_columns}
        masks={cfg.masks}
        onChange={(columnName, next) => {
          const exists = cfg.masks.find((it) => it.column_name === columnName);
          const nextMasks = exists
            ? cfg.masks.map((it) => (it.column_name === columnName ? { ...it, ...next } : it))
            : [...cfg.masks, { column_name: columnName, ...next }];
          onUpdate(cfg.id, 'masks', nextMasks);
        }}
      />

      <details>
        <summary className="helper">선택된 컬럼 목록 미리보기</summary>
        <p className="helper">{toList(cfg.selected_columns) || '선택 없음'}</p>
      </details>
    </section>
  );
}
