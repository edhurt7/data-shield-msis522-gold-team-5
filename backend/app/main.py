from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.db.base import Base
from app.db.init_data import seed_builtin_procedures
from app.db.session import SessionLocal, engine
from app.models import (
    AgentRun,
    ChatMessage,
    ProcedureChunk,
    ProcedureChunkEmbedding,
    ProcedureDocument,
    Profile,
    RemovalRequest,
    RemovalStatusEvent,
    WorkflowEvent,
)


settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.auto_create_tables:
        Base.metadata.create_all(bind=engine)
        with SessionLocal() as db:
            seed_builtin_procedures(db)
    yield


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api_router, prefix=settings.api_prefix)
