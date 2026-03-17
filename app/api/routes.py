from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.api.models import ApiResponse, ColumnsRequest, ConnectionTestRequest, DdlExtractRequest, IssueDetail, JobStartRequest, TablesRequest
from app.core.errors import classify_error
from app.services.ddl_service import DdlService
from app.services import repository
from app.services.metadata_service import MetadataService
from app.services.migration_service import MigrationService

router = APIRouter()
logger = logging.getLogger(__name__)
metadata_service = MetadataService()
migration_service = MigrationService()
ddl_service = DdlService()


def _error_response(message: str, exc: Exception, *, log_message: str | None = None) -> ApiResponse:
    info = classify_error(exc)
    return ApiResponse(
        success=False,
        message=message,
        errors=[IssueDetail(code=info.code, message=info.detail)],
        logs=[log_message] if log_message else [],
    )


@router.get('/health', response_model=ApiResponse)
def health() -> ApiResponse:
    return ApiResponse(success=True, message='ok', data={'status': 'up'})


@router.post('/connections/test', response_model=ApiResponse)
def test_connection(request: ConnectionTestRequest) -> ApiResponse:
    try:
        data = metadata_service.test_connection(request.username, request.password, request.url)
        return ApiResponse(success=True, message='Connection successful', data=data, logs=[f"Connected via {data['dialect']}"])
    except Exception as exc:
        logger.exception('Connection test failed')
        return _error_response('Connection failed', exc, log_message='Check database url and credentials')


@router.post('/metadata/tables', response_model=ApiResponse)
def get_tables(request: TablesRequest) -> ApiResponse:
    try:
        tables = metadata_service.get_tables(request.username, request.password, request.url, request.schema_name)
        return ApiResponse(success=True, message='Tables loaded', data={'tables': tables})
    except Exception as exc:
        logger.exception('Load tables failed')
        return _error_response('Failed to load tables', exc)


@router.post('/metadata/columns', response_model=ApiResponse)
def get_columns(request: ColumnsRequest) -> ApiResponse:
    try:
        columns = metadata_service.get_columns(request.username, request.password, request.url, request.schema_name, request.table_name)
        pks = metadata_service.get_primary_keys(request.username, request.password, request.url, request.schema_name, request.table_name)
        date_columns = metadata_service.get_date_columns(request.username, request.password, request.url, request.schema_name, request.table_name)
        return ApiResponse(
            success=True,
            message='Columns loaded',
            data={'columns': columns, 'primary_keys': pks, 'date_columns': date_columns},
        )
    except Exception as exc:
        logger.exception('Load columns failed')
        return _error_response('Failed to load columns', exc)


@router.post('/metadata/ddl', response_model=ApiResponse)
@router.post('/metadata/ddl/', response_model=ApiResponse, include_in_schema=False)
def extract_ddl(request: DdlExtractRequest) -> ApiResponse:
    try:
        ddl = ddl_service.extract_table_ddl(request.username, request.password, request.url, request.schema_name, request.table_name)
        return ApiResponse(success=True, message='DDL extracted', data=ddl)
    except Exception as exc:
        logger.exception('DDL extraction failed')
        return _error_response('Failed to extract DDL', exc)


@router.post('/jobs/start', response_model=ApiResponse)
def start_job(request: JobStartRequest) -> ApiResponse:
    try:
        job_id = migration_service.start_job(request)
        mode = 'Dry Run' if request.dry_run else 'Actual migration'
        return ApiResponse(success=True, message=f'{mode} job started', data={'job_id': job_id})
    except Exception as exc:
        logger.exception('Start job failed')
        return _error_response('Failed to start job', exc)


@router.get('/jobs/{job_id}', response_model=ApiResponse)
def get_job(job_id: str) -> ApiResponse:
    job = repository.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail='Job not found')
    return ApiResponse(success=True, message='Job loaded', data=job)


@router.get('/jobs', response_model=ApiResponse)
def list_jobs() -> ApiResponse:
    return ApiResponse(success=True, message='Jobs loaded', data={'jobs': repository.list_jobs()})


@router.post('/jobs/{job_id}/cancel', response_model=ApiResponse)
def cancel_job(job_id: str) -> ApiResponse:
    try:
        ok = repository.request_cancel(job_id)
        if not ok:
            return ApiResponse(
                success=False,
                message='Job not found or already finished',
                errors=[IssueDetail(code='VALIDATION_ERROR', message='Job cannot be cancelled')],
            )
        return ApiResponse(success=True, message='Cancel requested', data={'cancelled': True})
    except Exception as exc:
        logger.exception('Cancel job failed')
        return _error_response('Failed to cancel job', exc)
