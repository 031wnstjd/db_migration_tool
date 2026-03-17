'use client';

import { useEffect, useRef, useState } from 'react';
import {
  buildRequestPayload,
  cancelJob,
  fetchColumns,
  fetchDdl,
  fetchTables,
  getJob,
  getJobs,
  inspectBackendDdlSupport,
  setApiBaseUrl,
  startJob,
  testConnection,
} from '../lib/api';
import MigrationTab from '../components/MigrationTab';
import DdlExtractPanel from '../components/DdlExtractPanel';
import { coerceJobConfig, intersectColumns } from '../lib/mappers';
import { ApiResponse, DBConfig, DdlExtractResponse, JobRecord, KnownApiErrorCode } from '../lib/types';
import { MappingCardPayload } from '../components/TableMappingCard';

type SourceOrTarget = 'source' | 'target';
type TestStatus = 'idle' | 'success' | 'error';
type AppTab = 'migration' | 'ddl';

type DBState = DBConfig & {
  testMessage: string;
  testStatus: TestStatus;
  testing: boolean;
};

type DdlState = DBConfig & {
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

const BASE_STATE: DBState = {
  url: '',
  testMessage: '',
  testStatus: 'idle',
  testing: false,
};

const BASE_DDL_STATE: DdlState = {
  url: '',
  schema: '',
  tableName: '',
  testMessage: '',
  testStatus: 'idle',
  testing: false,
  loadingTables: false,
  extracting: false,
  tables: [],
  result: null,
};

const getDefaultDdlState = (): DdlState => {
  const presetEnabled = process.env.NEXT_PUBLIC_TEST_PRESET_ENABLED === 'true';
  if (!presetEnabled) {
    return BASE_DDL_STATE;
  }

  return {
    url: process.env.NEXT_PUBLIC_TEST_DDL_URL || process.env.NEXT_PUBLIC_TEST_SOURCE_URL || '',
    schema: process.env.NEXT_PUBLIC_TEST_DDL_SCHEMA || process.env.NEXT_PUBLIC_TEST_SOURCE_SCHEMA || '',
    tableName: process.env.NEXT_PUBLIC_TEST_DDL_TABLE || process.env.NEXT_PUBLIC_TEST_SOURCE_TABLE || '',
    testMessage: '',
    testStatus: 'idle',
    testing: false,
    loadingTables: false,
    extracting: false,
    tables: [],
    result: null,
  };
};

const getDefaultDbState = (role: SourceOrTarget): DBState => {
  const presetEnabled = process.env.NEXT_PUBLIC_TEST_PRESET_ENABLED === 'true';
  if (!presetEnabled) {
    return BASE_STATE;
  }

  return {
    url:
      role === 'source'
        ? process.env.NEXT_PUBLIC_TEST_SOURCE_URL || ''
        : process.env.NEXT_PUBLIC_TEST_TARGET_URL || '',
    testMessage: '',
    testStatus: 'idle',
    testing: false,
  };
};

const toDbConfig = ({ url }: DBState | DdlState): DBConfig => ({ url: url.trim() });

const maskDbUrl = (url: string) => url.replace(/(\/\/[^/:?#]+:)([^@/]+)(@)/, '$1***$3');

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

const ERROR_CODE_MESSAGES: Record<KnownApiErrorCode, string> = {
  DRIVER_MISSING: 'DB 드라이버가 설치되지 않았습니다. 백엔드 Python 의존성과 드라이버 설정을 확인해 주세요.',
  PERMISSION_DENIED: 'DB 권한이 부족합니다. 계정 권한과 접근 가능한 스키마/오브젝트를 확인해 주세요.',
  BACKEND_CAPABILITY_MISMATCH: '현재 백엔드 기능 또는 버전이 요청한 작업을 지원하지 않습니다.',
  VALIDATION_ERROR: '입력값 또는 요청 형식이 올바르지 않습니다.',
};

const toErrorMessage = (resp: ApiResponse<unknown>) => {
  if (resp.success) {
    return '';
  }
  const first = resp.errors?.[0];
  if (!first) {
    return resp.message || '요청이 실패했습니다.';
  }
  const mapped = first.code && first.code in ERROR_CODE_MESSAGES ? ERROR_CODE_MESSAGES[first.code as KnownApiErrorCode] : '';
  if (mapped && first.message && first.message !== resp.message) {
    return `${mapped}\n${first.message}`;
  }
  return mapped || first.message || resp.message || '요청이 실패했습니다.';
};

const toConnectionSuccessMessage = (dbName?: string | null, dialect?: string | null, driver?: string | null) => {
  const label = dbName || '연결 테스트 완료';
  const dialectLabel = [dialect, driver].filter(Boolean).join(' / ');
  return dialectLabel ? `성공: ${label} (${dialectLabel})` : `성공: ${label}`;
};

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<AppTab>('migration');
  const [apiBase] = useState(() => process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api');
  const [source, setSource] = useState<DBState>(getDefaultDbState('source'));
  const [target, setTarget] = useState<DBState>(getDefaultDbState('target'));
  const [ddl, setDdl] = useState<DdlState>(getDefaultDdlState);
  const [mappings, setMappings] = useState<MappingCardPayload[]>([newMapping()]);
  const [running, setRunning] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [mappingLoadState, setMappingLoadState] = useState<Record<string, MappingLoadState>>({});
  const [migrationMessage, setMigrationMessage] = useState('');
  const [ddlMessage, setDdlMessage] = useState('');

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
    void refreshJobs();
    return () => {
      pollStopRef.current = true;
    };
  }, []);

  const updateDb = (role: SourceOrTarget, field: 'url', value: string) => {
    const setter = role === 'source' ? setSource : setTarget;
    setter((prev) => ({
      ...prev,
      [field]: value,
      testMessage: '',
      testStatus: 'idle',
    }));
  };

  const updateDdl = (field: 'url' | 'schema' | 'tableName', value: string) => {
    setDdl((prev) => ({
      ...prev,
      [field]: value,
      testMessage: field === 'tableName' ? prev.testMessage : '',
      testStatus: field === 'tableName' ? prev.testStatus : 'idle',
      result: null,
      tables: field === 'schema' ? [] : prev.tables,
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

  const removeLastMapping = () => {
    const last = mappings[mappings.length - 1];
    if (last) {
      removeMapping(last.id);
    }
  };

  const onTestConnection = async (role: SourceOrTarget) => {
    const current = role === 'source' ? source : target;
    const setter = role === 'source' ? setSource : setTarget;
    const roleLabel = role === 'source' ? 'Source DB' : 'Target DB';
    if (!current.url.trim()) {
      setter((prev) => ({ ...prev, testMessage: 'Database URL(DSN)을 입력해 주세요.', testStatus: 'error' }));
      return;
    }

    setter((prev) => ({ ...prev, testing: true, testMessage: '', testStatus: 'idle' }));
    try {
      const res = await testConnection(toDbConfig(current));
      const err = toErrorMessage(res);
      setter((prev) => ({
        ...prev,
        testStatus: err ? 'error' : 'success',
        testMessage: err || toConnectionSuccessMessage(res.data?.db_name, res.data?.dialect, res.data?.driver),
      }));
      setMigrationMessage(`${roleLabel}: ${err || '연결 테스트 완료'}`);
    } catch {
      setter((prev) => ({ ...prev, testMessage: '연결 테스트 실패', testStatus: 'error' }));
      setMigrationMessage(`${roleLabel}: 연결 테스트 실패`);
    } finally {
      setter((prev) => ({ ...prev, testing: false }));
    }
  };

  const onTestDdlConnection = async () => {
    if (!ddl.url.trim()) {
      setDdl((prev) => ({ ...prev, testMessage: 'Database URL(DSN)을 입력해 주세요.', testStatus: 'error' }));
      return;
    }

    setDdl((prev) => ({ ...prev, testing: true, testMessage: '', testStatus: 'idle' }));
    try {
      const res = await testConnection(toDbConfig(ddl));
      const err = toErrorMessage(res);
      setDdl((prev) => ({
        ...prev,
        testStatus: err ? 'error' : 'success',
        testMessage: err || toConnectionSuccessMessage(res.data?.db_name, res.data?.dialect, res.data?.driver),
      }));
      setDdlMessage(`DDL 대상 DB: ${err || '연결 테스트 완료'}`);
    } catch {
      setDdl((prev) => ({ ...prev, testMessage: '연결 테스트 실패', testStatus: 'error' }));
      setDdlMessage('DDL 대상 DB: 연결 테스트 실패');
    } finally {
      setDdl((prev) => ({ ...prev, testing: false }));
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
      const res = await fetchTables(toDbConfig(db), schema || '');
      if (!res.success || !res.data) {
        setMigrationMessage(toErrorMessage(res) || '테이블 조회 실패');
        return;
      }

      updateMapping(mappingId, role === 'source' ? 'source_tables' : 'target_tables', res.data.tables);
      if (res.data.tables.length > 0) {
        updateMapping(mappingId, role === 'source' ? 'source_table' : 'target_table', res.data.tables[0]);
      }
      setMigrationMessage('테이블 조회 완료');
    } finally {
      setMappingBusy(mappingId, isSource ? { sourceTables: false } : { targetTables: false });
    }
  };

  const loadColumnsAndKeys = async (mappingId: string) => {
    const row = mappings.find((m) => m.id === mappingId);
    if (!row) return;
    if (!row.source_table || !row.target_table) {
      setMigrationMessage('Source/Target table을 먼저 입력해 주세요.');
      return;
    }

    setMappingBusy(mappingId, { columns: true });
    const [src, tgt] = await Promise.all([
      fetchColumns(toDbConfig(source), row.source_schema || '', row.source_table),
      fetchColumns(toDbConfig(target), row.target_schema || '', row.target_table),
    ]);
    try {
      if (!src.success || !src.data || !tgt.success || !tgt.data) {
        setMigrationMessage(toErrorMessage(src) || toErrorMessage(tgt) || '컬럼 조회 실패');
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
        (row.masks || []).filter((mask) => selected.includes(mask.column_name)).map((mask) => ({
          ...mask,
          mode: mask.mode || 'NONE',
        })),
      );

      setMigrationMessage('컬럼/PK 조회 완료');
    } finally {
      setMappingBusy(mappingId, { columns: false });
    }
  };

  const loadDdlTables = async () => {
    if (!ddl.url.trim()) {
      setDdl((prev) => ({ ...prev, testMessage: 'Database URL(DSN)을 입력해 주세요.', testStatus: 'error' }));
      return;
    }

    setDdl((prev) => ({ ...prev, loadingTables: true }));
    try {
      const res = await fetchTables(toDbConfig(ddl), ddl.schema || '');
      if (!res.success || !res.data) {
        setDdlMessage(toErrorMessage(res) || 'DDL 대상 테이블 조회 실패');
        return;
      }
      setDdl((prev) => ({
        ...prev,
        tables: res.data?.tables || [],
        tableName: prev.tableName || res.data?.tables?.[0] || '',
      }));
      setDdlMessage('DDL 대상 테이블 조회 완료');
    } finally {
      setDdl((prev) => ({ ...prev, loadingTables: false }));
    }
  };

  const extractDdl = async () => {
    if (!ddl.url.trim()) {
      setDdlMessage('DDL 추출용 Database URL(DSN)을 입력해 주세요.');
      return;
    }
    if (!ddl.tableName.trim()) {
      setDdlMessage('DDL을 추출할 테이블명을 입력해 주세요.');
      return;
    }

    setDdl((prev) => ({ ...prev, extracting: true, result: null }));
    try {
      const res = await fetchDdl({
        ...toDbConfig(ddl),
        schema: ddl.schema || null,
        table_name: ddl.tableName,
      });
      if (!res.success || !res.data) {
        const errorMessage = toErrorMessage(res) || 'DDL 추출 실패';
        if (res.status_code === 404) {
          const backendInfo = await inspectBackendDdlSupport();
          if (backendInfo && !backendInfo.hasDdlRoute) {
            setDdlMessage(
              `현재 연결된 백엔드${backendInfo.title ? `(${backendInfo.title})` : ''}는 DDL 추출 API가 없는 구버전입니다. 백엔드를 재시작하거나 docker compose up -d --build backend frontend 로 다시 올리면 DDL 추출이 가능합니다.`,
            );
          } else {
            setDdlMessage('DDL 추출 API를 찾을 수 없습니다. 백엔드를 최신 코드로 재시작했는지 확인해 주세요.');
          }
        } else {
          setDdlMessage(errorMessage);
        }
        return;
      }
      setDdl((prev) => ({ ...prev, result: res.data }));
      setDdlMessage('DDL 추출 완료');
    } finally {
      setDdl((prev) => ({ ...prev, extracting: false }));
    }
  };

  const buildConfigs = () => {
    const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));

    const missing = mappings.find((m) => !m.source_table.trim() || !m.target_table.trim() || m.selected_columns.length === 0);

    if (!source.url.trim() || !target.url.trim()) {
      setMigrationMessage('Source/Target Database URL(DSN)을 입력해 주세요.');
      return null;
    }

    if (!mappings.length) {
      setMigrationMessage('최소 하나의 매핑이 필요합니다.');
      return null;
    }

    if (missing) {
      setMigrationMessage('모든 매핑에서 Source/Target table과 공통 컬럼을 설정해 주세요.');
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
      setMigrationMessage(error instanceof Error ? error.message : '매핑 설정이 올바르지 않습니다.');
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
    const payload = buildRequestPayload(toDbConfig(source), toDbConfig(target), configs, dryRun);

    try {
      setRunning(true);
      const res = await startJob(payload);
      if (!res.success || !res.data?.job_id) {
        setMigrationMessage(toErrorMessage(res) || '작업 시작 실패');
        return;
      }
      setJobId(res.data.job_id);
      setMigrationMessage(`${dryRun ? 'Dry Run' : '실행'} 시작: ${res.data.job_id}`);
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
      setMigrationMessage('취소할 Job ID를 입력해 주세요.');
      return;
    }

    try {
      setCanceling(true);
      const res = await cancelJob(targetId);
      if (!res.success) {
        setMigrationMessage(toErrorMessage(res) || 'Job 취소 실패');
        return;
      }
      setMigrationMessage(`Job 취소 요청: ${targetId}`);
      await loadJob(targetId);
    } finally {
      setCanceling(false);
    }
  };

  const loadJob = async (id?: string | null) => {
    const targetId = typeof id === 'string' ? id.trim() : jobId.trim();
    if (!targetId) {
      setMigrationMessage('조회할 Job ID를 입력해 주세요.');
      return;
    }

    setLoadingJob(true);
    try {
      const res = await getJob(targetId);
      if (!res.success || !res.data) {
        setJob(null);
        setMigrationMessage(toErrorMessage(res) || 'Job 조회 실패');
        return;
      }
      const next = res.data;
      setJob(next);
      setMigrationMessage(`Job 상태: ${next.status}`);
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
          throw new Error(toErrorMessage(res) || 'Job 조회 실패');
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
          setMigrationMessage(error instanceof Error ? error.message : 'Job 조회에 실패했습니다.');
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
  const requestPreview = {
    source_db: {
      ...toDbConfig(source),
      url: maskDbUrl(source.url.trim()),
    },
    target_db: {
      ...toDbConfig(target),
      url: maskDbUrl(target.url.trim()),
    },
    table_configs: mappings.map((row) => coerceJobConfig(row)),
    dry_run: true,
  };

  return (
    <div>
      <section className="card section">
        <div className="section-header-row compact">
          <div>
            <h2 className="section-title">작업 선택</h2>
            <p className="helper">동일한 디자인 언어 안에서 마이그레이션과 DDL 추출 기능을 탭으로 전환합니다.</p>
          </div>
        </div>
        <div className="tool-tabs" role="tablist" aria-label="DB managing tool tabs">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'migration'}
            className={`tab-button ${activeTab === 'migration' ? 'active' : ''}`}
            onClick={() => setActiveTab('migration')}
          >
            DB Table Migration
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ddl'}
            className={`tab-button ${activeTab === 'ddl' ? 'active' : ''}`}
            onClick={() => setActiveTab('ddl')}
          >
            DB Table DDL Extract
          </button>
        </div>
      </section>

      {activeTab === 'migration' ? (
        <MigrationTab
          source={source}
          target={target}
          onDbFieldChange={updateDb}
          onTestConnection={onTestConnection}
          uiBusy={uiBusy}
          mappings={mappings}
          getMappingBusy={getMappingBusy}
          onUpdateMapping={updateMapping}
          onFetchTables={loadSchemaTables}
          onFetchColumns={loadColumnsAndKeys}
          onRemoveMapping={removeMapping}
          onAddMapping={addMapping}
          onRemoveLastMapping={removeLastMapping}
          canRemoveLastMapping={mappings.length > 1}
          onRunDry={() => void runJob(true)}
          onRunReal={() => void runJob(false)}
          onRefreshJobs={() => void refreshJobs()}
          onCancelJob={() => void cancelCurrentJob()}
          canCancelJob={isJobActive}
          cancelInFlight={canceling}
          jobId={jobId}
          onJobIdChange={setJobId}
          onLoadJob={() => loadJob()}
          loadingJob={loadingJob}
          job={job}
          message={migrationMessage}
          requestPreview={requestPreview}
          recentJobs={recentJobs}
          onSelectRecentJob={(nextJobId) => {
            setJobId(nextJobId);
            void loadJob(nextJobId);
          }}
        />
      ) : (
        <DdlExtractPanel
          state={ddl}
          message={ddlMessage}
          onFieldChange={updateDdl}
          onTestConnection={() => void onTestDdlConnection()}
          onLoadTables={() => void loadDdlTables()}
          onExtractDdl={() => void extractDdl()}
          disabled={ddl.extracting}
        />
      )}
    </div>
  );
}
