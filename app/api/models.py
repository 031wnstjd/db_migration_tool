from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class DBConfig(BaseModel):
    url: str
    username: str | None = None
    password: str | None = None


class ConnectionTestRequest(DBConfig):
    pass


class TablesRequest(DBConfig):
    schema_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices('schema', 'schema_name'),
        serialization_alias='schema',
    )


class ColumnsRequest(DBConfig):
    schema_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices('schema', 'schema_name'),
        serialization_alias='schema',
    )
    table_name: str


class DdlExtractRequest(DBConfig):
    schema_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices('schema', 'schema_name'),
        serialization_alias='schema',
    )
    table_name: str


class ColumnMaskRule(BaseModel):
    column_name: str
    mode: Literal['NONE', 'NULL', 'FIXED', 'HASH', 'PARTIAL'] = 'NONE'
    value: str | None = None


class TableMigrationConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source_schema: str | None = None
    source_table: str
    target_schema: str | None = None
    target_table: str
    selected_columns: list[str] = Field(default_factory=list)
    key_columns: list[str] = Field(default_factory=list)
    strategy: Literal['INSERT', 'MERGE', 'DELETE_INSERT'] = 'INSERT'
    truncate_before_load: bool = False
    date_filter_column: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    row_limit: int | None = None
    batch_size: int = 500
    masks: list[ColumnMaskRule] = Field(default_factory=list)


class JobStartRequest(BaseModel):
    source_db: DBConfig
    target_db: DBConfig
    table_configs: list[TableMigrationConfig]
    dry_run: bool = True


class IssueDetail(BaseModel):
    code: str
    message: str
    target: str | None = None
    details: dict[str, Any] | None = None


class ApiResponse(BaseModel):
    success: bool
    message: str
    data: dict | list | None = None
    errors: list[IssueDetail] = Field(default_factory=list)
    warnings: list[IssueDetail] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)
