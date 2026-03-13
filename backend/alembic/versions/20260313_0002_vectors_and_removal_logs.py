"""add vector store and removal logs"""

from alembic import op
import sqlalchemy as sa


revision = "20260313_0002"
down_revision = "20260312_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "procedure_chunk_embeddings",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("chunk_id", sa.String(length=64), sa.ForeignKey("procedure_chunks.id"), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=128), nullable=False),
        sa.Column("vector", sa.JSON(), nullable=False),
        sa.Column("embedding_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_procedure_chunk_embeddings_chunk_id", "procedure_chunk_embeddings", ["chunk_id"])
    op.create_index("ix_procedure_chunk_embeddings_content_hash", "procedure_chunk_embeddings", ["content_hash"])

    op.create_table(
        "removal_requests",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("run_id", sa.String(length=64), sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("site_id", sa.String(length=120), nullable=False),
        sa.Column("candidate_id", sa.String(length=255), nullable=False),
        sa.Column("candidate_url", sa.Text(), nullable=False),
        sa.Column("procedure_id", sa.String(length=128), nullable=True),
        sa.Column("submission_channel", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("latest_ticket_id", sa.String(length=255), nullable=True),
        sa.Column("latest_confirmation_text", sa.Text(), nullable=True),
        sa.Column("latest_error_text", sa.Text(), nullable=True),
        sa.Column("review_reasons", sa.JSON(), nullable=False),
        sa.Column("request_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_removal_requests_run_id", "removal_requests", ["run_id"])
    op.create_index("ix_removal_requests_site_id", "removal_requests", ["site_id"])

    op.create_table(
        "removal_status_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("removal_request_id", sa.String(length=64), sa.ForeignKey("removal_requests.id"), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("ticket_ids", sa.JSON(), nullable=False),
        sa.Column("screenshot_ref", sa.Text(), nullable=True),
        sa.Column("error_text", sa.Text(), nullable=True),
        sa.Column("confirmation_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_removal_status_events_removal_request_id", "removal_status_events", ["removal_request_id"])


def downgrade() -> None:
    op.drop_index("ix_removal_status_events_removal_request_id", table_name="removal_status_events")
    op.drop_table("removal_status_events")
    op.drop_index("ix_removal_requests_site_id", table_name="removal_requests")
    op.drop_index("ix_removal_requests_run_id", table_name="removal_requests")
    op.drop_table("removal_requests")
    op.drop_index("ix_procedure_chunk_embeddings_content_hash", table_name="procedure_chunk_embeddings")
    op.drop_index("ix_procedure_chunk_embeddings_chunk_id", table_name="procedure_chunk_embeddings")
    op.drop_table("procedure_chunk_embeddings")
