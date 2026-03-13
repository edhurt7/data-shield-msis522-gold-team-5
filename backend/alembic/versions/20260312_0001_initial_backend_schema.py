"""initial backend schema"""

from alembic import op
import sqlalchemy as sa


revision = "20260312_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "profiles",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=False),
        sa.Column("state", sa.String(length=120), nullable=False),
        sa.Column("approx_age", sa.String(length=32), nullable=True),
        sa.Column("privacy_email", sa.String(length=255), nullable=False),
        sa.Column("consent_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("optional_attributes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "procedure_documents",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("site", sa.String(length=255), nullable=False),
        sa.Column("channel_hint", sa.String(length=32), nullable=False),
        sa.Column("source_uri", sa.String(length=500), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_procedure_documents_site", "procedure_documents", ["site"])
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("profile_id", sa.String(length=64), sa.ForeignKey("profiles.id"), nullable=False),
        sa.Column("request_text", sa.Text(), nullable=False),
        sa.Column("requested_sites", sa.JSON(), nullable=False),
        sa.Column("profile_snapshot", sa.JSON(), nullable=False),
        sa.Column("intent_snapshot", sa.JSON(), nullable=False),
        sa.Column("current_phase", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("consent_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("targets", sa.JSON(), nullable=False),
        sa.Column("candidates", sa.JSON(), nullable=False),
        sa.Column("match_decisions", sa.JSON(), nullable=False),
        sa.Column("procedures", sa.JSON(), nullable=False),
        sa.Column("drafts", sa.JSON(), nullable=False),
        sa.Column("handoffs", sa.JSON(), nullable=False),
        sa.Column("outcomes", sa.JSON(), nullable=False),
        sa.Column("pending_review_reasons", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_agent_runs_profile_id", "agent_runs", ["profile_id"])
    op.create_table(
        "procedure_chunks",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("procedure_id", sa.String(length=64), sa.ForeignKey("procedure_documents.id"), nullable=False),
        sa.Column("doc_id", sa.String(length=128), nullable=False),
        sa.Column("chunk_order", sa.Integer(), nullable=False),
        sa.Column("quote", sa.Text(), nullable=False),
    )
    op.create_index("ix_procedure_chunks_procedure_id", "procedure_chunks", ["procedure_id"])
    op.create_table(
        "workflow_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("run_id", sa.String(length=64), sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("phase", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("site_id", sa.String(length=120), nullable=True),
        sa.Column("candidate_id", sa.String(length=255), nullable=True),
        sa.Column("review_reasons", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_workflow_events_run_id", "workflow_events", ["run_id"])
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("run_id", sa.String(length=64), sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_chat_messages_run_id", "chat_messages", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_run_id", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_workflow_events_run_id", table_name="workflow_events")
    op.drop_table("workflow_events")
    op.drop_index("ix_procedure_chunks_procedure_id", table_name="procedure_chunks")
    op.drop_table("procedure_chunks")
    op.drop_index("ix_agent_runs_profile_id", table_name="agent_runs")
    op.drop_table("agent_runs")
    op.drop_index("ix_procedure_documents_site", table_name="procedure_documents")
    op.drop_table("procedure_documents")
    op.drop_table("profiles")
