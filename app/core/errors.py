from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ErrorInfo:
    code: str
    detail: str


def classify_error(exc: Exception) -> ErrorInfo:
    detail = str(exc).strip() or exc.__class__.__name__
    lowered = detail.lower()

    if isinstance(exc, ModuleNotFoundError):
        return ErrorInfo(code='DRIVER_MISSING', detail=detail)

    if any(token in lowered for token in ('insufficient privileges', 'permission denied', 'not authorized', 'ora-01031')):
        return ErrorInfo(code='PERMISSION_DENIED', detail=detail)

    if isinstance(exc, ValueError):
        if any(token in lowered for token in ('unsupported', 'capability', 'not available')):
            return ErrorInfo(code='BACKEND_CAPABILITY_MISMATCH', detail=detail)
        return ErrorInfo(code='VALIDATION_ERROR', detail=detail)

    return ErrorInfo(code='UNKNOWN_ERROR', detail=detail)
