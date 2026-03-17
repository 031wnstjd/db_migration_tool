import { ColumnMetadata, ColumnMaskRule, JobStartRequest, TableMigrationConfig } from './types';

export function normalizeColumns(cols: ColumnMetadata[]) {
  return (cols || []).map((col) => col.column_name).filter(Boolean);
}

export function intersectColumns(a: string[], b: string[]) {
  const set = new Set(b.map((v) => v.toUpperCase()));
  return Array.from(new Set(a.filter((v) => set.has(v.toUpperCase())))).sort();
}

export function coerceJobConfig(config: Partial<TableMigrationConfig>): TableMigrationConfig {
  const selected = Array.from(new Set((config.selected_columns || []).map((v) => v.trim()).filter(Boolean)));
  const keyColumns = Array.from(
    new Set((config.key_columns || []).filter((k) => selected.includes(k))),
  );

  const rawMasks = (config.masks || []) as ColumnMaskRule[];
  const masks = rawMasks
    .filter((mask) => selected.includes(mask.column_name))
    .map((mask) => ({
      column_name: mask.column_name,
      mode: mask.mode,
      value: mask.value || null,
    }));

  return {
    source_schema: (config.source_schema || '').trim(),
    source_table: (config.source_table || '').trim(),
    target_schema: (config.target_schema || '').trim(),
    target_table: (config.target_table || '').trim(),
    selected_columns: selected,
    key_columns: keyColumns,
    strategy: (config.strategy || 'INSERT') as TableMigrationConfig['strategy'],
    truncate_before_load: Boolean(config.truncate_before_load),
    date_filter_column: config.date_filter_column || null,
    date_from: config.date_from || null,
    date_to: config.date_to || null,
    row_limit: typeof config.row_limit === 'number' && config.row_limit > 0 ? config.row_limit : null,
    batch_size: typeof config.batch_size === 'number' && config.batch_size > 0 ? config.batch_size : 500,
    masks,
  };
}

export function buildPayload(source: { url: string }, target: { url: string }, mappings: TableMigrationConfig[], dryRun: boolean): JobStartRequest {
  return {
    source_db: source,
    target_db: target,
    table_configs: mappings.map((cfg) => coerceJobConfig(cfg)),
    dry_run: dryRun,
  };
}
