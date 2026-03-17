'use client';

import { ChangeEvent } from 'react';

type Role = 'source' | 'target';
type TestStatus = 'idle' | 'success' | 'error';

type Props = {
  role: Role;
  url: string;
  testMessage: string;
  testStatus: TestStatus;
  onFieldChange: (role: Role, field: 'url', value: string) => void;
  onTest: (role: Role) => void;
  disabled?: boolean;
  testInFlight?: boolean;
};

const title = {
  source: 'Source DB',
  target: 'Target DB',
};

const statusIcon: Record<Exclude<TestStatus, 'idle'>, string> = {
  success: '✅',
  error: '❌',
};

export default function ConnectionPanel({
  role,
  url,
  testMessage,
  testStatus,
  onFieldChange,
  onTest,
  disabled,
  testInFlight,
}: Props) {
  const onInput = (e: ChangeEvent<HTMLInputElement>) => onFieldChange(role, 'url', e.target.value);

  return (
    <section className="card panel">
      <h3 className="card-title">{title[role]}</h3>
      <p className="helper">일반 연결은 Database URL(DSN) 한 칸만 사용합니다. 인증 정보가 필요하면 URL 안에 포함해 주세요.</p>
      <label>
        <span className="label">Database URL / DSN</span>
        <input
          className="input"
          value={url}
          placeholder="postgresql+psycopg://scott:tiger@localhost:5432/app / oracle+oracledb://scott:tiger@dbhost:1521/?service_name=FREEPDB1 / sqlite:////tmp/demo.db"
          onChange={onInput}
          disabled={disabled}
          autoComplete="off"
        />
      </label>
      <p className="helper">예시: PostgreSQL / Oracle / SQLite</p>
      <div className="flex-gap">
        <button className="btn primary" type="button" onClick={() => onTest(role)} disabled={disabled || testInFlight}>
          {testInFlight ? '테스트 중…' : `${title[role]} DB 연결 테스트`}
        </button>
      </div>
      {testMessage ? (
        <p className={`connection-test-result ${testStatus === 'success' ? 'success' : 'error'}`} aria-live="polite">
          <span className="connection-test-result-icon" aria-hidden="true">
            {statusIcon[testStatus === 'success' ? 'success' : 'error']}
          </span>
          <span>{testMessage}</span>
        </p>
      ) : null}
    </section>
  );
}
