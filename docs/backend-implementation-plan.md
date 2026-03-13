# Backend Implementation Status

## Added in this pass

- New `backend/` FastAPI service
- Persistent run storage with SQLite-by-default SQLAlchemy models
- Alembic migration scaffold
- Built-in procedure document seed data
- Contract-aligned routes for agent run management and procedure retrieval
- `.env.example` documenting the keys and service credentials needed later
- Procedure ingestion and lexical RAG retrieval endpoints for site-specific opt-out documents

## Still to build next

- Real LLM orchestration and structured-output calls
- Playwright discovery and submission workers
- Auth and user accounts
- Full normalized evidence/candidate tables if you want richer analytics than JSON snapshots
- Embeddings and vector similarity search
- Scheduled re-scan jobs
- Artifact storage and screenshot upload flow
