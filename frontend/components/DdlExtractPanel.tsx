'use client';

import { DdlExtractResponse } from '../lib/types';
import TableOptionPicker from './TableOptionPicker';

type TestStatus = 'idle' | 'success' | 'error';

type DdlPanelState = {
  username: string;
  password: string;
  url: string;
  schema: string;
  tableName: string;
  testMessage: string;
  testStatus: TestStatus;
  testing: boolean;
  loadingTables: boolean;
  extracting: boolean;
  tables: string[];
  result: DdlExtractResponse | null;
};

type Props = {
  apiBase: string;
  onApiBaseChange: (value: string) => void;
  state: DdlPanelState;
  message: string;
  onFieldChange: (field: 'username' | 'password' | 'url' | 'schema' | 'tableName', value: string) => void;
  onTestConnection: () => void;
  onLoadTables: () => void;
  onExtractDdl: () => void;
  disabled?: boolean;
};

const SECTION_LABELS: Array<{ key: keyof DdlExtractResponse; title: string }> = [
  { key: 'table_sql', title: 'Table DDL' },
  { key: 'index_sql', title: 'Index DDL' },
  { key: 'constraint_sql', title: 'Constraint DDL' },
  { key: 'partition_sql', title: 'Partition DDL' },
];

async function copyText(value: string) {
  if (!value.trim()) return;
  await navigator.clipboard.writeText(value);
}

export default function DdlExtractPanel({
  apiBase,
  onApiBaseChange,
  state,
  message,
  onFieldChange,
  onTestConnection,
  onLoadTables,
  onExtractDdl,
  disabled,
}: Props) {
  return (
    <section className="panel section">
      <section className="card section">
        <div className="section-block-header">
          <div>
            <p className="section-kicker">Tab 2</p>
            <h2 className="section-title">DB Table DDL Extract</h2>
          </div>
          <p className="helper">단일 DB 연결 기준으로 스키마/테이블을 선택해 DDL을 추출합니다.</p>
        </div>
        <label>
          <span className="label">API Base URL</span>
          <input className="input" value={apiBase} onChange={(e) => onApiBaseChange(e.target.value)} placeholder="http://localhost:8000/api" />
        </label>
      </section>

      <section className="card section ddl-layout">
        <div className="panel-block">
          <div className="section-block-header compact">
            <div>
              <p className="section-kicker">Single DB</p>
              <h3 className="card-title">연결 정보</h3>
            </div>
            <p className="helper">MySQL / PostgreSQL / Oracle / SQLite URL 형식을 그대로 사용할 수 있습니다.</p>
          </div>

          <div className="grid-2">
            <label>
              <span className="label">Username</span>
              <input className="input" value={state.username} onChange={(e) => onFieldChange('username', e.target.value)} disabled={disabled} autoComplete="off" placeholder="선택 사항" />
            </label>
            <label>
              <span className="label">Password</span>
              <input className="input" type="password" value={state.password} onChange={(e) => onFieldChange('password', e.target.value)} disabled={disabled} autoComplete="new-password" placeholder="선택 사항" />
            </label>
          </div>

          <label>
            <span className="label">Database URL</span>
            <input
              className="input"
              value={state.url}
              onChange={(e) => onFieldChange('url', e.target.value)}
              disabled={disabled}
              autoComplete="off"
              placeholder="mysql+pymysql://... / oracle+oracledb://... / postgresql+psycopg://... / sqlite:///..."
            />
          </label>

          <div className="action-row">
            <button className="btn primary" type="button" onClick={onTestConnection} disabled={disabled || state.testing}>
              {state.testing ? '테스트 중…' : 'DDL 대상 DB 연결 테스트'}
            </button>
          </div>

          {state.testMessage ? (
            <p className={`connection-test-result ${state.testStatus === 'success' ? 'success' : 'error'}`} aria-live="polite">
              <span className="connection-test-result-icon" aria-hidden="true">
                {state.testStatus === 'success' ? '✅' : '❌'}
              </span>
              <span>{state.testMessage}</span>
            </p>
          ) : null}
        </div>

        <div className="panel-block panel-block-accent">
          <div className="section-block-header compact">
            <div>
              <p className="section-kicker">DDL Scope</p>
              <h3 className="card-title">스키마 / 테이블 선택</h3>
            </div>
            <p className="helper">테이블 목록을 불러온 뒤 단일 테이블 기준으로 추출합니다.</p>
          </div>

          <div className="grid-2 ddl-scope-grid">
            <label>
              <span className="label">Schema (optional)</span>
              <input className="input" value={state.schema} onChange={(e) => onFieldChange('schema', e.target.value)} disabled={disabled} />
            </label>
            <div className="action-row align-end">
              <button className="btn" type="button" onClick={onLoadTables} disabled={disabled || state.loadingTables}>
                {state.loadingTables ? '조회 중…' : '테이블 목록 조회'}
              </button>
            </div>
          </div>

          <label>
            <span className="label">Table</span>
            <input
              className="input"
              value={state.tableName}
              onChange={(e) => onFieldChange('tableName', e.target.value)}
              disabled={disabled}
              placeholder="테이블명을 직접 입력하거나 목록에서 선택"
            />
          </label>

          {state.tables.length > 0 ? (
            <TableOptionPicker
              label="테이블 목록"
              value={state.tableName}
              options={state.tables}
              disabled={disabled}
              onChange={(value) => onFieldChange('tableName', value)}
              searchPlaceholder="DDL 대상 테이블명 검색"
            />
          ) : null}

          <div className="action-row">
            <button className="btn primary" type="button" onClick={onExtractDdl} disabled={disabled || state.extracting}>
              {state.extracting ? '추출 중…' : 'DDL 추출'}
            </button>
          </div>

          <div className="meta ddl-meta">
            {state.result
              ? `${state.result.dialect} / ${state.result.table_name} DDL 추출 완료`
              : '연결 테스트 후 스키마/테이블을 선택하고 DDL 추출을 실행하세요.'}
          </div>
        </div>
      </section>

      {state.result ? (
        <section className="card section">
          <div className="section-header-row compact">
            <div>
              <h3 className="card-title">DDL 결과</h3>
              <p className="helper">
                Dialect: {state.result.dialect} / Table: {state.result.table_name}
              </p>
            </div>
            <button className="btn" type="button" onClick={() => void copyText(state.result?.combined_sql || '')}>
              전체 SQL 복사
            </button>
          </div>

          {state.result.warnings.length > 0 ? (
            <div className="panel-block panel-block-accent section" style={{ marginBottom: '0.85rem' }}>
              <h4 className="card-title">Warnings</h4>
              <ul className="helper" style={{ margin: 0, paddingLeft: '1rem' }}>
                {state.result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="panel-block section" style={{ marginBottom: '0.85rem' }}>
            <div className="section-header-row compact">
              <h4 className="card-title">Combined SQL</h4>
              <button className="btn" type="button" onClick={() => void copyText(state.result?.combined_sql || '')}>
                복사
              </button>
            </div>
            <pre className="code">{state.result.combined_sql || '-- 결과 없음 --'}</pre>
          </div>

          {SECTION_LABELS.map(({ key, title }) => {
            const value = state.result?.[key];
            if (typeof value !== 'string' || !value.trim()) {
              return null;
            }

            return (
              <div className="panel-block section" style={{ marginBottom: '0.85rem' }} key={key}>
                <div className="section-header-row compact">
                  <h4 className="card-title">{title}</h4>
                  <button className="btn" type="button" onClick={() => void copyText(value)}>
                    복사
                  </button>
                </div>
                <pre className="code">{value}</pre>
              </div>
            );
          })}
        </section>
      ) : null}

      {message ? (
        <section className="card section">
          <h3 className="card-title">알림</h3>
          <p className="helper" aria-live="polite">
            {message}
          </p>
        </section>
      ) : null}
    </section>
  );
}
