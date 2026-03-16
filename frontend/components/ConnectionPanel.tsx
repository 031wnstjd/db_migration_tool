'use client';

import { ChangeEvent } from 'react';

type Role = 'source' | 'target';
type TestStatus = 'idle' | 'success' | 'error';

type Props = {
  role: Role;
  username: string;
  password: string;
  url: string;
  testMessage: string;
  testStatus: TestStatus;
  onFieldChange: (role: Role, field: 'username' | 'password' | 'url', value: string) => void;
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
  username,
  password,
  url,
  testMessage,
  testStatus,
  onFieldChange,
  onTest,
  disabled,
  testInFlight,
}: Props) {
  const onInput = (field: 'username' | 'password' | 'url') => (e: ChangeEvent<HTMLInputElement>) => {
    onFieldChange(role, field, e.target.value);
  };

  return (
    <section className="card panel">
      <h3 className="card-title">{title[role]}</h3>
      <label>
        <span className="label">Username</span>
        <input
          className="input"
          value={username}
          onChange={onInput('username')}
          disabled={disabled}
          autoComplete="off"
          placeholder="선택 사항"
        />
      </label>
      <label>
        <span className="label">Password</span>
        <input
          className="input"
          type="password"
          value={password}
          onChange={onInput('password')}
          disabled={disabled}
          autoComplete="new-password"
          placeholder="선택 사항"
        />
      </label>
      <label>
        <span className="label">Database URL</span>
        <input
          className="input"
          value={url}
          placeholder="sqlite:///./data/source.db 또는 postgresql://..."
          onChange={onInput('url')}
          disabled={disabled}
          autoComplete="off"
        />
      </label>
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
