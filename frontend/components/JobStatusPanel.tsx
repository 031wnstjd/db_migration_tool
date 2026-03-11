'use client';

import { JobRecord } from '../lib/types';

type Props = {
  jobId: string;
  onJobIdChange: (jobId: string) => void;
  onLoad: () => Promise<void> | void;
  loading: boolean;
  job?: JobRecord | null;
};

export default function JobStatusPanel({ jobId, onJobIdChange, onLoad, loading, job }: Props) {
  return (
    <section className="card panel">
      <h3 className="card-title">진행률/결과 조회</h3>
      <div className="grid-2">
        <label>
          <span className="label">Job ID</span>
          <input className="input" value={jobId} onChange={(e) => onJobIdChange(e.target.value)} placeholder="Job ID 입력" />
        </label>
        <div className="flex-gap" style={{ alignItems: 'end' }}>
          <button className="btn primary" type="button" onClick={() => void onLoad()} disabled={loading || !jobId.trim()}>
            {loading ? '조회 중…' : '진행률 조회'}
          </button>
        </div>
      </div>
      {!job ? (
        <p className="helper">조회된 Job이 없습니다.</p>
      ) : (
        <div className="panel">
          <div className="flex-gap" style={{ alignItems: 'center' }}>
            <span className={`badge ${job.status === 'SUCCESS' ? 'success' : job.status === 'FAILED' ? 'warning' : 'neutral'}`}>
              {job.status}
            </span>
            <span className="helper">Dry Run: {String(job.dry_run)}</span>
            <span className="helper">생성: {job.created_at}</span>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label="마이그레이션 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progress || 0}
            aria-valuetext={`${job.progress || 0}%`}
          >
            <span style={{ width: `${job.progress || 0}%` }} />
          </div>
          <p className="helper">{job.progress || 0}%</p>
          <h3 className="card-title">Job 로그</h3>
          <pre className="log-box">{(job.logs_json || []).join('\n') || '로그 없음'}</pre>
          <h3 className="card-title">Job 결과</h3>
          <pre className="code">{JSON.stringify(job.result_json, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
