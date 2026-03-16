'use client';

import ConnectionPanel from './ConnectionPanel';
import JobControlPanel from './JobControlPanel';
import JobStatusPanel from './JobStatusPanel';
import TableMappingCard, { MappingCardPayload } from './TableMappingCard';
import { JobRecord } from '../lib/types';

type Role = 'source' | 'target';
type TestStatus = 'idle' | 'success' | 'error';
type BusyFlags = {
  sourceTables: boolean;
  targetTables: boolean;
  columns: boolean;
};

type DbPanelState = {
  username: string;
  password: string;
  url: string;
  testMessage: string;
  testStatus: TestStatus;
  testing: boolean;
};

type Props = {
  apiBase: string;
  onApiBaseChange: (value: string) => void;
  source: DbPanelState;
  target: DbPanelState;
  onDbFieldChange: (role: Role, field: 'username' | 'password' | 'url', value: string) => void;
  onTestConnection: (role: Role) => void;
  uiBusy: boolean;
  mappings: MappingCardPayload[];
  getMappingBusy: (mappingId: string) => BusyFlags;
  onUpdateMapping: (id: string, field: keyof MappingCardPayload, value: unknown) => void;
  onFetchTables: (id: string, role: Role) => Promise<void>;
  onFetchColumns: (id: string) => Promise<void>;
  onRemoveMapping: (id: string) => void;
  onAddMapping: () => void;
  onRemoveLastMapping: () => void;
  canRemoveLastMapping: boolean;
  onRunDry: () => void;
  onRunReal: () => void;
  onRefreshJobs: () => void;
  onCancelJob: () => void;
  canCancelJob: boolean;
  cancelInFlight: boolean;
  jobId: string;
  onJobIdChange: (value: string) => void;
  onLoadJob: () => Promise<void> | void;
  loadingJob: boolean;
  job: JobRecord | null;
  message: string;
  requestPreview: unknown;
  recentJobs: JobRecord[];
  onSelectRecentJob: (jobId: string) => void;
};

export default function MigrationTab({
  apiBase,
  onApiBaseChange,
  source,
  target,
  onDbFieldChange,
  onTestConnection,
  uiBusy,
  mappings,
  getMappingBusy,
  onUpdateMapping,
  onFetchTables,
  onFetchColumns,
  onRemoveMapping,
  onAddMapping,
  onRemoveLastMapping,
  canRemoveLastMapping,
  onRunDry,
  onRunReal,
  onRefreshJobs,
  onCancelJob,
  canCancelJob,
  cancelInFlight,
  jobId,
  onJobIdChange,
  onLoadJob,
  loadingJob,
  job,
  message,
  requestPreview,
  recentJobs,
  onSelectRecentJob,
}: Props) {
  return (
    <div>
      <section className="card section">
        <h2 className="section-title">설정</h2>
        <label>
          <span className="label">API Base URL</span>
          <input
            className="input"
            value={apiBase}
            onChange={(e) => onApiBaseChange(e.target.value)}
            placeholder="http://localhost:8000/api"
          />
        </label>
      </section>

      <section className="grid-2 section">
        <ConnectionPanel
          role="source"
          username={source.username}
          password={source.password}
          url={source.url}
          testMessage={source.testMessage}
          testStatus={source.testStatus}
          onFieldChange={onDbFieldChange}
          onTest={onTestConnection}
          disabled={uiBusy}
          testInFlight={source.testing}
        />
        <ConnectionPanel
          role="target"
          username={target.username}
          password={target.password}
          url={target.url}
          testMessage={target.testMessage}
          testStatus={target.testStatus}
          onFieldChange={onDbFieldChange}
          onTest={onTestConnection}
          disabled={uiBusy}
          testInFlight={target.testing}
        />
      </section>

      <div className="section-header-row">
        <div>
          <h2 className="section-title">테이블 매핑 설정</h2>
          <p className="helper">Source / Target / 공통 규칙을 분리해 매핑 흐름을 더 명확하게 표시합니다.</p>
        </div>
        <div className="flex-gap">
          <button className="btn" type="button" onClick={onAddMapping} disabled={uiBusy}>
            매핑 추가
          </button>
          <button className="btn" type="button" onClick={onRemoveLastMapping} disabled={uiBusy || !canRemoveLastMapping}>
            마지막 매핑 제거
          </button>
        </div>
      </div>

      {mappings.map((cfg, index) => (
        <TableMappingCard
          key={cfg.id}
          index={index}
          cfg={cfg}
          disableActions={uiBusy}
          loading={getMappingBusy(cfg.id)}
          onUpdate={onUpdateMapping}
          onFetchTables={onFetchTables}
          onFetchColumns={onFetchColumns}
          onRemove={onRemoveMapping}
        />
      ))}

      <section className="grid-2 section">
        <JobControlPanel
          inFlight={uiBusy}
          onRunDry={onRunDry}
          onRunReal={onRunReal}
          onRefreshList={onRefreshJobs}
          onCancel={onCancelJob}
          canCancel={canCancelJob}
          cancelInFlight={cancelInFlight}
        />
        <JobStatusPanel jobId={jobId} onJobIdChange={onJobIdChange} onLoad={onLoadJob} loading={loadingJob} job={job} />
      </section>

      {message ? (
        <section className="card section">
          <h3 className="card-title">알림</h3>
          <p className="helper" aria-live="polite">
            {message}
          </p>
        </section>
      ) : null}

      <section className="card section">
        <h3 className="card-title">요청 미리보기</h3>
        <pre className="code">{JSON.stringify(requestPreview, null, 2)}</pre>
      </section>

      {recentJobs.length > 0 && (
        <section className="card section">
          <div className="section-header-row compact">
            <div>
              <h3 className="card-title">최근 Job</h3>
              <p className="helper">최근 실행된 작업을 빠르게 다시 조회할 수 있습니다.</p>
            </div>
            <button className="btn" type="button" onClick={onRefreshJobs}>
              최근 Job 목록 새로고침
            </button>
          </div>
          <div className="job-list">
            {recentJobs.slice(0, 5).map((item) => (
              <div className="job-list-item" key={item.job_id}>
                <div className="job-list-meta">
                  <strong>{item.job_id}</strong>
                  <span className={`badge ${item.status === 'SUCCESS' ? 'success' : item.status === 'FAILED' ? 'warning' : 'neutral'}`}>
                    {item.status}
                  </span>
                  <span className="helper">{item.progress}%</span>
                </div>
                <div className="job-list-actions">
                  <button className="btn" type="button" onClick={() => onSelectRecentJob(item.job_id)}>
                    조회
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
