from fastapi import APIRouter

from app.api.routes.agent import router as agent_router
from app.api.routes.monitoring import router as monitoring_router
from app.api.routes.procedures import router as procedures_router


api_router = APIRouter()
api_router.include_router(agent_router, prefix="/agent", tags=["agent"])
api_router.include_router(monitoring_router, prefix="/monitoring", tags=["monitoring"])
api_router.include_router(procedures_router, prefix="/procedures", tags=["procedures"])
