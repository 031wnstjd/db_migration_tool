'use client';

import { useEffect, useRef, useState } from 'react';
import {
  buildRequestPayload,
  cancelJob,
  fetchColumns,
  fetchTables,
  getJob,
  getJobs,
  setApiBaseUrl,
  startJob,
  testConnection,
} from '../lib/api';
import { coerceJobConfig, intersectColumns } from '../lib/mappers';
import { ApiResponse, DBConfig, JobRecord } from '../lib/types';
import TableMappingCard, { MappingCardPayload } from '../components/TableMappingCard';
import ConnectionPanel from '../components/ConnectionPanel';
import JobControlPanel from '../components/JobControlPanel';
import JobStatusPanel from '../components/JobStatusPanel';

type SourceOrTarget = 'source' | 'target';

type DBState = DBConfig & {
  testMessage: string;
  testing: boolean;
};

const BASE_STATE: DBState = {
  username: '',
  password: '',
  url: '',
  testMessage: '',
  testing: false,
};

const getDefaultDbState = (role: SourceOrTarget): DBState => {
  const presetEnabled = process.env.NEXT_PUBLIC_TEST_PRESET_ENABLED === 'true';
  if (!presetEnabled) {
    return BASE_STATE;
  }

  return {
    username:
      role === 'source'
        ? process.env.NEXT_PUBLIC_TEST_SOURCE_USER || ''
        : process.env.NEXT_PUBLIC_TEST_TARGET_USER || '',
    password:
      role === 'source'
        ? process.env.NEXT_PUBLIC_TEST_SOURCE_PASSWORD || ''
        : process.env.NEXT_PUBLIC_TEST_TARGET_PASSWORD || '',
    url:
      role === 'source'
        ? process.env.NEXT_PUBLIC_TEST_SOURCE_URL || ''
        : process.env.NEXT_PUBLIC_TEST_TARGET_URL || '',
    testMessage: '',
    testing: false,
  };
};

const parseList = (value: string | undefined): string[] =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const newMapping = (): MappingCardPayload => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  source_schema: process.env.NEXT_PUBLIC_TEST_SOURCE_SCHEMA || '',
  source_table: process.env.NEXT_PUBLIC_TEST_SOURCE_TABLE || '',
  target_schema: process.env.NEXT_PUBLIC_TEST_TARGET_SCHEMA || '',
  target_table: process.env.NEXT_PUBLIC_TEST_TARGET_TABLE || '',
  selected_columns: parseList(process.env.NEXT_PUBLIC_TEST_SELECTED_COLUMNS),
  key_columns: parseList(process.env.NEXT_PUBLIC_TEST_KEY_COLUMNS),
  strategy: (process.env.NEXT_PUBLIC_TEST_STRATEGY as MappingCardPayload['strategy']) || 'INSERT',
  truncate_before_load: false,
  date_filter_column: process.env.NEXT_PUBLIC_TEST_DATE_FILTER_COLUMN || '',
  date_from: '',
  date_to: '',
  row_limit: null,
  batch_size: 500,
  masks: [],
  source_tables: [],
  target_tables: [],
  source_columns: [],
  target_columns: [],
  source_pks: [],
  source_dates: [],
  });

type MappingLoadState = {
  sourceTables: boolean;
  targetTables: boolean;
  columns: boolean;
};

const toErrorMessage = (resp: ApiResponse<unknown>) =>
  !resp.success && (resp.errors?.join('\n') || resp.message || '요청이 실패했습니다.');

export default function HomePage() {
  const [apiBase, setApiBase] = useState(() => process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api');
  const [source, setSource] = useState<DBState>(getDefaultDbState('source'));
  const [target, setTarget] = useState<DBState>(getDefaultDbState('target'));
  const [mappings, setMappings] = useState<MappingCardPayload[]>([newMapping()]);
  const [running, setRunning] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [mappingLoadState, setMappingLoadState] = useState<Record<string, MappingLoadState>>({});
  const [message, setMessage] = useState('');

  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<JobRecord | null>(null);
  const [loadingJob, setLoadingJob] = useState(false);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobRecord[]>([]);

  const pollStopRef = useRef(false);

  useEffect(() => {
    setApiBaseUrl(apiBase);
  }, [apiBase]);

  useEffect(() => {
    refreshJobs();
    return () => {
      pollStopRef.current = true;
    };
  }, []);

  const updateDb = (role: SourceOrTarget, field: keyof DBConfig, value: string) => {
    const setter = role === 'source' ? setSource : setTarget;
    setter((prev) => ({
      ...prev,
      [field]: value,
      testMessage: '',
    }));
  };

  const updateMapping = (id: string, field: keyof MappingCardPayload, value: unknown) => {
    setMappings((prev) =>
      prev.map((row) => {
        if (row.id !== id) {
          return row;
        }
        return { ...row, [field]: value } as MappingCardPayload;
      }),
    );
  };

  const setMappingBusy = (mappingId: string, patch: Partial<MappingLoadState>) => {
    const defaultState: MappingLoadState = { sourceTables: false, targetTables: false, columns: false };
    setMappingLoadState((prev) => ({
      ...prev,
      [mappingId]: {
        ...defaultState,
        ...(prev[mappingId] || defaultState),
        ...patch,
      },
    }));
  };

  const getMappingBusy = (mappingId: string): MappingLoadState => {
    const state = mappingLoadState[mappingId];
    return state || { sourceTables: false, targetTables: false, columns: false };
  };

  const addMapping = () => {
    const mapping = newMapping();
    setMappings((prev) => [...prev, mapping]);
    setMappingLoadState((prev) => ({
      ...prev,
      [mapping.id]: { sourceTables: false, targetTables: false, columns: false },
    }));
  };

  const removeMapping = (id: string) => {
    setMappings((prev) => (prev.length <= 1 ? prev : prev.filter((item) => item.id !== id)));
    setMappingLoadState((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const onTestConnection = async (role: SourceOrTarget) => {
    const current = role === 'source' ? source : target;
    const setter = role === 'source' ? setSource : setTarget;
    if (!current.url.trim()) {
      setter((prev) => ({ ...prev, testMessage: 'Database URL을 입력해 주세요.' }));
      return;
    }

    setter((prev) => ({ ...prev, testing: true, testMessage: '' }));
    try {
      const res = await testConnection({
        username: current.username,
        password: current.password,
        url: current.url,
      });
      const err = toErrorMessage(res);
      setter((prev) => ({
        ...prev,
        testMessage: err || `성공: ${res.data?.db_name || '연결 테스트 완료'}`,
      }));
      setMessage(err || '연결 테스트 완료');
    } catch {
      setter((prev) => ({ ...prev, testMessage: '연결 테스트 실패' }));
      setMessage('연결 테스트 실패');
    } finally {
      setter((prev) => ({ ...prev, testing: false }));
    }
  };

  const loadSchemaTables = async (mappingId: string, role: SourceOrTarget) => {
    const row = mappings.find((m) => m.id === mappingId);
    if (!row) return;
    const db = role === 'source' ? source : target;
    const schema = role === 'source' ? row.source_schema : row.target_schema;
    const isSource = role === 'source';

    setMappingBusy(mappingId, isSource ? { sourceTables: true } : { targetTables: true });
    try {
      const res = await fetchTables(db, schema || '');
      if (!res.success || !res.data) {
        setMessage(toErrorMessage(res) || '테이블 조회 실패');
        return;
      }

      updateMapping(mappingId, role === 'source' ? 'source_tables' : 'target_tables', res.data.tables);
      if (res.data.tables.length > 0) {
        updateMapping(mappingId, role === 'source' ? 'source_table' : 'target_table', res.data.tables[0]);
      }
      setMessage('테이블 조회 완료');
    } finally {
      setMappingBusy(mappingId, isSource ? { sourceTables: false } : { targetTables: false });
    }
  };

  const loadColumnsAndKeys = async (mappingId: string) => {
    const row = mappings.find((m) => m.id === mappingId);
    if (!row) return;
    if (!row.source_table || !row.target_table) {
      setMessage('Source/Target table을 먼저 입력해 주세요.');
      return;
    }

    setMappingBusy(mappingId, { columns: true });
    const [src, tgt] = await Promise.all([
      fetchColumns(source, row.source_schema || '', row.source_table),
      fetchColumns(target, row.target_schema || '', row.target_table),
    ]);
    try {
      if (!src.success || !src.data || !tgt.success || !tgt.data) {
        setMessage(toErrorMessage(src) || toErrorMessage(tgt) || '컬럼 조회 실패');
        return;
      }

      const common = intersectColumns(
        src.data.columns.map((c) => c.column_name),
        tgt.data.columns.map((c) => c.column_name),
      );

      updateMapping(mappingId, 'source_columns', src.data.columns);
      updateMapping(mappingId, 'target_columns', tgt.data.columns);
      updateMapping(mappingId, 'source_pks', src.data.primary_keys);
      updateMapping(mappingId, 'source_dates', src.data.date_columns);

      const selected = row.selected_columns.length > 0 ? row.selected_columns.filter((col) => common.includes(col)) : common;
      const defaultKey = src.data.primary_keys.filter((col) => common.includes(col));

      updateMapping(mappingId, 'selected_columns', selected);
      updateMapping(
        mappingId,
        'key_columns',
        row.key_columns.length > 0
          ? row.key_columns.filter((key) => selected.includes(key))
          : defaultKey.filter((key) => selected.includes(key)),
      );

      updateMapping(
        mappingId,
        'masks',
        (row.masks || []).filter((mask) => selected.includes(mask.column_name))
          .map((mask) => ({
            ...mask,
            mode: mask.mode || 'NONE',
          })),
      );

      setMessage('컬럼/PK 조회 완료');
    } finally {
      setMappingBusy(mappingId, { columns: false });
    }
  };

  const buildConfigs = () => {
    const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));

    const missing = mappings.find(
      (m) =>
        !m.source_table.trim() ||
        !m.target_table.trim() ||
        m.selected_columns.length === 0,
    );

    if (!source.url.trim() || !target.url.trim()) {
      setMessage('Source/Target Database URL을 입력해 주세요.');
      return null;
    }

    if (!mappings.length) {
      setMessage('최소 하나의 매핑이 필요합니다.');
      return null;
    }

    if (missing) {
      setMessage('모든 매핑에서 Source/Target table과 공통 컬럼을 설정해 주세요.');
      return null;
    }

    try {
      mappings.forEach((m) => {
        if (!m.date_filter_column) {
          if (m.date_from || m.date_to) {
            throw new Error('날짜 기준 컬럼이 없으면 시작일/종료일을 입력할 수 없습니다.');
          }
          return;
        }
        if ((m.date_from && !isValidDate(m.date_from)) || (m.date_to && !isValidDate(m.date_to))) {
          throw new Error('날짜 형식은 YYYY-MM-DD 이어야 합니다.');
        }
        if (m.date_from && m.date_to) {
          const from = Date.parse(`${m.date_from}T00:00:00`);
          const to = Date.parse(`${m.date_to}T00:00:00`);
          if (from > to) {
            throw new Error('시작일은 종료일보다 클 수 없습니다.');
          }
        }
      });

      const cfgs = mappings.map((item) => {
        const normalized = coerceJobConfig(item);
        if ((normalized.strategy === 'MERGE' || normalized.strategy === 'DELETE_INSERT') && normalized.key_columns.length === 0) {
          throw new Error('MERGE/DELETE_INSERT는 key 컬럼이 필요합니다.');
        }
        return normalized;
      });
      return cfgs;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '매핑 설정이 올바르지 않습니다.');
      return null;
    }
  };

  const runJob = async (dryRun: boolean) => {
    const configs = buildConfigs();
    if (!configs) return;
    if (!dryRun) {
      const needsConfirmation = configs.some((cfg) => cfg.strategy === 'DELETE_INSERT' || cfg.truncate_before_load);
      if (needsConfirmation && !window.confirm('실제 마이그레이션은 대상 데이터 변경(삭제/덮어쓰기/초기화)이 발생할 수 있습니다. 진행할까요?')) {
        return;
      }
    }
    const payload = buildRequestPayload(
      {
        username: source.username,
        password: source.password,
        url: source.url,
      },
      {
        username: target.username,
        password: target.password,
        url: target.url,
      },
      configs,
      dryRun,
    );

    try {
      setRunning(true);
      const res = await startJob(payload);
      if (!res.success || !res.data?.job_id) {
        setMessage(toErrorMessage(res) || '작업 시작 실패');
        return;
      }
      setJobId(res.data.job_id);
      setMessage(`${dryRun ? 'Dry Run' : '실행'} 시작: ${res.data.job_id}`);
      await loadJob(res.data.job_id);
      setPollingJobId(res.data.job_id);
      await refreshJobs();
    } finally {
      setRunning(false);
    }
  };

  const cancelCurrentJob = async () => {
    const targetId = (pollingJobId || job?.job_id || jobId).trim();
    if (!targetId) {
      setMessage('취소할 Job ID를 입력해 주세요.');
      return;
    }

    try {
      setCanceling(true);
      const res = await cancelJob(targetId);
      if (!res.success) {
        setMessage(toErrorMessage(res) || 'Job 취소 실패');
        return;
      }
      setMessage(`Job 취소 요청: ${targetId}`);
      await loadJob(targetId);
    } finally {
      setCanceling(false);
    }
  };

  const loadJob = async (id?: string | null) => {
    const targetId = typeof id === 'string' ? id.trim() : jobId.trim();
    if (!targetId) {
      setMessage('조회할 Job ID를 입력해 주세요.');
      return;
    }

    setLoadingJob(true);
    try {
      const res = await getJob(targetId);
      if (!res.success || !res.data) {
        setJob(null);
        setMessage(toErrorMessage(res) || 'Job 조회 실패');
        return;
      }
      const next = res.data;
      setJob(next);
      setMessage(`Job 상태: ${next.status}`);
      setPollingJobId((prev) =>
        ['RUNNING', 'PENDING', 'CANCEL_REQUESTED'].includes(next.status) ? targetId : prev === targetId ? null : prev,
      );
    } finally {
      setLoadingJob(false);
    }
  };

  const refreshJobs = async () => {
    const res = await getJobs();
    if (res.success && res.data?.jobs) {
      setRecentJobs(res.data.jobs);
    }
  };

  useEffect(() => {
    if (!pollingJobId) {
      return;
    }

    let retryCount = 0;
    let delay = 2500;
    pollStopRef.current = false;

    const poll = async () => {
      if (pollStopRef.current) {
        return;
      }
      try {
        const res = await getJob(pollingJobId);
        if (!res.success || !res.data) {
          throw new Error(res.errors?.join(', ') || 'Job 조회 실패');
        }
        setJob(res.data);
        if (['RUNNING', 'PENDING', 'CANCEL_REQUESTED'].includes(res.data.status)) {
          delay = 2500;
          retryCount = 0;
          setTimeout(poll, delay);
          return;
        }
        setPollingJobId(null);
        return;
      } catch (error) {
        retryCount += 1;
        if (retryCount >= 3) {
          setMessage(error instanceof Error ? error.message : 'Job 조회에 실패했습니다.');
          setPollingJobId(null);
          return;
        }
        delay = Math.min(delay * 2, 5000);
        setTimeout(poll, delay);
      }
    };

    const timer = setTimeout(poll, 600);

    return () => {
      pollStopRef.current = true;
      clearTimeout(timer);
    };
  }, [pollingJobId]);

  const isJobActive = Boolean(pollingJobId || ['RUNNING', 'PENDING', 'CANCEL_REQUESTED'].includes(job?.status || ''));
  const uiBusy = running || isJobActive;

  return (
    <div>
      <section className="card section">
        <h2 className="section-title">설정</h2>
        <label>
          <span className="label">FastAPI Base URL</span>
          <input
            className="input"
            value={apiBase}
            onChange={(e) => {
              setApiBase(e.target.value);
            }}
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
          onFieldChange={updateDb}
          onTest={onTestConnection}
          disabled={uiBusy}
          testInFlight={source.testing}
        />
        <ConnectionPanel
          role="target"
          username={target.username}
          password={target.password}
          url={target.url}
          onFieldChange={updateDb}
          onTest={onTestConnection}
          disabled={uiBusy}
          testInFlight={target.testing}
        />
      </section>

      {(source.testMessage || target.testMessage) && (
        <section className="card section">
          <p className="helper">{source.testMessage || target.testMessage}</p>
        </section>
      )}

      <div className="flex-gap" style={{ justifyContent: 'space-between', marginBottom: '0.6rem' }}>
        <h2 className="section-title">테이블 매핑 설정</h2>
        <div className="flex-gap">
          <button className="btn" type="button" onClick={addMapping} disabled={uiBusy}>
            매핑 추가
          </button>
          <button className="btn" type="button" onClick={() => removeMapping(mappings[mappings.length - 1].id)} disabled={uiBusy}>
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
          onUpdate={updateMapping}
          onFetchTables={loadSchemaTables}
          onFetchColumns={loadColumnsAndKeys}
          onRemove={removeMapping}
        />
      ))}

      <section className="grid-2 section">
        <JobControlPanel
          inFlight={uiBusy}
          onRunDry={() => runJob(true)}
          onRunReal={() => runJob(false)}
          onRefreshList={refreshJobs}
          onCancel={cancelCurrentJob}
          canCancel={isJobActive}
          cancelInFlight={canceling}
        />
        <JobStatusPanel jobId={jobId} onJobIdChange={setJobId} onLoad={loadJob} loading={loadingJob} job={job} />
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
        <pre className="code">
          {JSON.stringify(
            {
              source_db: {
                ...source,
                password: '***',
              },
              target_db: {
                ...target,
                password: '***',
              },
              table_configs: mappings.map((row) => coerceJobConfig(row)),
              dry_run: true,
            },
            null,
            2,
          )}
        </pre>
      </section>

      {recentJobs.length > 0 && (
        <section className="card section">
          <h3 className="card-title">최근 Job</h3>
          <ul className="helper">
            {recentJobs.slice(0, 5).map((item) => (
              <li className="flex-gap" key={item.job_id}>
                <span>
                  {item.job_id} / {item.status} / {item.progress}%
                </span>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setJobId(item.job_id);
                    void loadJob(item.job_id);
                  }}
                >
                  조회
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
