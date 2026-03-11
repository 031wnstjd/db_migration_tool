from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.api.models import ApiResponse, ColumnsRequest, ConnectionTestRequest, JobStartRequest, TablesRequest
from app.services import repository
from app.services.metadata_service import MetadataService
from app.services.migration_service import MigrationService

router = APIRouter()
logger = logging.getLogger(__name__)
metadata_service = MetadataService()
migration_service = MigrationService()


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
        return ApiResponse(success=False, message='Connection failed', errors=[str(exc)], logs=['Check database url and credentials'])


@router.post('/metadata/tables', response_model=ApiResponse)
def get_tables(request: TablesRequest) -> ApiResponse:
    try:
        tables = metadata_service.get_tables(request.username, request.password, request.url, request.schema_name)
        return ApiResponse(success=True, message='Tables loaded', data={'tables': tables})
    except Exception as exc:
        logger.exception('Load tables failed')
        return ApiResponse(success=False, message='Failed to load tables', errors=[str(exc)])


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
        return ApiResponse(success=False, message='Failed to load columns', errors=[str(exc)])


@router.post('/jobs/start', response_model=ApiResponse)
def start_job(request: JobStartRequest) -> ApiResponse:
    try:
        job_id = migration_service.start_job(request)
        mode = 'Dry Run' if request.dry_run else 'Actual migration'
        return ApiResponse(success=True, message=f'{mode} job started', data={'job_id': job_id})
    except Exception as exc:
        logger.exception('Start job failed')
        return ApiResponse(success=False, message='Failed to start job', errors=[str(exc)])


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
                errors=['Job cannot be cancelled'],
            )
        return ApiResponse(success=True, message='Cancel requested', data={'cancelled': True})
    except Exception as exc:
        logger.exception('Cancel job failed')
        return ApiResponse(success=False, message='Failed to cancel job', errors=[str(exc)])
