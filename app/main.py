from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.core.logging_config import configure_logging
from app.services.repository import init_db

configure_logging()
init_db()

app = FastAPI(title="DB Migrator Tool", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")
