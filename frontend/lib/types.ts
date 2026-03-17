export type DBConfig = {
  url: string;
  username?: string | null;
  password?: string | null;
};

export type KnownApiErrorCode =
  | 'DRIVER_MISSING'
  | 'PERMISSION_DENIED'
  | 'BACKEND_CAPABILITY_MISMATCH'
  | 'VALIDATION_ERROR';

export type ApiErrorCode = KnownApiErrorCode | (string & {});

export type ColumnMaskMode = 'NONE' | 'NULL' | 'FIXED' | 'HASH' | 'PARTIAL';

export type ColumnMaskRule = {
  column_name: string;
  mode: ColumnMaskMode;
  value: string | null;
};

export type StrategyType = 'INSERT' | 'MERGE' | 'DELETE_INSERT';

export type TableMigrationConfig = {
  source_schema: string;
  source_table: string;
  target_schema: string;
  target_table: string;
  selected_columns: string[];
  key_columns: string[];
  strategy: StrategyType;
  truncate_before_load: boolean;
  date_filter_column: string | null;
  date_from: string | null;
  date_to: string | null;
  row_limit: number | null;
  batch_size: number;
  masks: ColumnMaskRule[];
};

export type JobStartRequest = {
  source_db: DBConfig;
  target_db: DBConfig;
  table_configs: TableMigrationConfig[];
  dry_run: boolean;
};

export type DdlExtractResult = {
  dialect: string;
  schema: string | null;
  table_name: string;
  combined_sql: string;
  table_sql: string;
  index_sql: string;
  constraint_sql: string;
  partition_sql: string;
  warnings: string[];
  warning_codes: string[];
};

export type DdlExtractRequest = DBConfig & {
  schema?: string | null;
  table_name: string;
};

export type DdlExtractResponse = {
  dialect: string;
  schema: string | null;
  table_name: string;
  table_sql: string;
  index_sql: string;
  constraint_sql: string;
  partition_sql: string;
  combined_sql: string;
  warnings: string[];
  warning_codes: string[];
};

export type ConnectionTestResponse = {
  db_name: string;
  dialect?: string | null;
  driver?: string | null;
  server_time: string;
};

export type ApiIssue = {
  code: ApiErrorCode;
  message: string;
  target?: string | null;
  details?: Record<string, unknown> | null;
};

export type ApiResponse<T = unknown> = {
  success: boolean;
  message: string;
  data: T | null;
  errors: ApiIssue[];
  warnings?: ApiIssue[];
  logs: string[];
  status_code?: number;
};

export type JobRecord = {
  job_id: string;
  status: string;
  progress: number;
  dry_run: boolean;
  cancel_requested?: boolean;
  created_at: string;
  updated_at: string;
  request_json: JobStartRequest;
  result_json: unknown;
  logs_json: string[];
};

export type ColumnMetadata = {
  column_name: string;
  data_type: string;
  nullable: string;
  data_length: number | null;
  data_precision: number | null;
  data_scale: number | null;
  column_id: number;
};

export type ErrorLike = string | { message?: string };
