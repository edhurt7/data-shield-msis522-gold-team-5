# Backend

This directory contains the first working FastAPI backend scaffold for the project.

## What is implemented

- FastAPI app with CORS and healthcheck
- SQLAlchemy models for profiles, agent runs, workflow events, chat messages, and procedure documents
- Alembic migration scaffold
- Built-in seed procedure documents for FastPeopleSearch, Spokeo, and Radaris
- Core API routes matching the frontend contract shape:
  - `POST /api/agent/runs/start`
  - `GET /api/agent/runs`
  - `GET /api/agent/runs/{run_id}`
  - `POST /api/agent/runs/{run_id}/chat`
  - `POST /api/agent/runs/{run_id}/approval`
  - `POST /api/agent/runs/{run_id}/rescan`
  - `POST /api/agent/runs/{run_id}/execution-results`
  - `POST /api/agent/runs/{run_id}/plan-submission`
  - `POST /api/procedures/retrieve`

## Local setup

1. Create a virtual environment and install dependencies.
2. Copy `.env.example` to `.env`.
3. Run Alembic migrations or rely on auto-create during development.
4. Start the server with `uvicorn app.main:app --reload`.

## Notes

- The default database is SQLite for local development speed.
- For team/demo deployment, switch `DATABASE_URL` to Postgres.
- The current scaffold does not yet execute Playwright jobs or live LLM calls. It gives us a persistent API and database foundation to build those next.
