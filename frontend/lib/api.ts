import {
  ApiResponse,
  ColumnMetadata,
  DBConfig,
  JobRecord,
  JobStartRequest,
  TableMigrationConfig,
} from './types';

let BASE_URL = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || 'http://localhost:8000/api';

export function setApiBaseUrl(url: string) {
  BASE_URL = url?.replace(/\/$/, '') || 'http://localhost:8000/api';
}

function toErrorMessage(err: unknown): string {
  if (typeof err === 'string') {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return '요청 중 오류가 발생했습니다.';
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch (err) {
    return {
      success: false,
      message: 'Network request failed',
      data: null,
      errors: [toErrorMessage(err)],
      logs: [],
    };
  }

  const payload = (await res.json().catch(() => ({ success: false, message: 'Invalid JSON response' }))) as ApiResponse<T>;
  if (!res.ok) {
    return {
      success: false,
      message: payload?.message || `HTTP ${res.status}`,
      data: payload?.data ?? null,
      errors: payload?.errors?.length ? payload.errors : [toErrorMessage(`HTTP ${res.status}`)],
      logs: payload?.logs || [],
    };
  }

  return {
    success: Boolean(payload.success),
    message: payload.message,
    data: payload.data ?? null,
    errors: payload.errors || [],
    logs: payload.logs || [],
  };
}

export async function testConnection(db: DBConfig): Promise<ApiResponse<{ db_name: string; server_time: string }>> {
  return apiRequest('/connections/test', {
    method: 'POST',
    body: JSON.stringify(db),
  });
}

export async function fetchTables(db: DBConfig, schema?: string): Promise<ApiResponse<{ tables: string[] }>> {
  return apiRequest('/metadata/tables', {
    method: 'POST',
    body: JSON.stringify({ ...db, schema }),
  });
}

export async function fetchColumns(
  db: DBConfig,
  schema: string = '',
  tableName: string,
): Promise<ApiResponse<{ columns: ColumnMetadata[]; primary_keys: string[]; date_columns: string[] }>> {
  return apiRequest('/metadata/columns', {
    method: 'POST',
    body: JSON.stringify({ ...db, schema, table_name: tableName }),
  });
}

export async function startJob(payload: JobStartRequest): Promise<ApiResponse<{ job_id: string }>> {
  return apiRequest('/jobs/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getJob(jobId: string): Promise<ApiResponse<JobRecord>> {
  return apiRequest(`/jobs/${encodeURIComponent(jobId)}`);
}

export async function getJobs(): Promise<ApiResponse<{ jobs: JobRecord[] }>> {
  return apiRequest('/jobs');
}

export async function cancelJob(jobId: string): Promise<ApiResponse<{ cancelled: boolean }>> {
  return apiRequest(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
}

export function buildRequestPayload(
  source: DBConfig,
  target: DBConfig,
  tableConfigs: TableMigrationConfig[],
  dryRun: boolean,
): JobStartRequest {
  return {
    source_db: source,
    target_db: target,
    table_configs: tableConfigs,
    dry_run: dryRun,
  };
}
