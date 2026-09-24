"""The assistant foundation: generation records, background jobs and the course interview.

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def _instance() -> sa.Column:
    return sa.Column(
        "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
    )


def upgrade() -> None:
    op.create_table(
        "generation_record",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        sa.Column("task_kind", sa.String(50), nullable=False),
        sa.Column("prompt_version", sa.String(20), nullable=False),
        sa.Column("prompt_hash", sa.String(64), nullable=False),
        sa.Column(
            "account_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False, index=True
        ),
        sa.Column(
            "course_id", sa.Integer, sa.ForeignKey("course.id", ondelete="SET NULL"), index=True
        ),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("inputs", sa.JSON, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("output", sa.JSON),
        sa.Column("raw_output", sa.Text),
        sa.Column("error_kind", sa.String(30)),
        sa.Column("input_tokens", sa.Integer, nullable=False),
        sa.Column("output_tokens", sa.Integer, nullable=False),
        sa.Column("duration_ms", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "job",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        sa.Column(
            "account_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False, index=True
        ),
        sa.Column("kind", sa.String(50), nullable=False),
        sa.Column(
            "course_id", sa.Integer, sa.ForeignKey("course.id", ondelete="CASCADE"), index=True
        ),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("progress", sa.String(50)),
        sa.Column("result", sa.JSON),
        sa.Column("error_kind", sa.String(30)),
        sa.Column("raw_output", sa.Text),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("finished_at", sa.DateTime),
    )
    op.create_table(
        "interview",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        sa.Column(
            "course_id",
            sa.Integer,
            sa.ForeignKey("course.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("rounds", sa.JSON, nullable=False),
        sa.Column("sources_offered", sa.Boolean),
        sa.Column("summary", sa.Text),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("job.id", ondelete="SET NULL")),
        sa.Column("started_by_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
    )
    op.create_index(
        "one_active_interview",
        "interview",
        ["course_id"],
        unique=True,
        sqlite_where=sa.text("state = 'active'"),
        postgresql_where=sa.text("state = 'active'"),
    )


def downgrade() -> None:
    op.drop_table("interview")
    op.drop_table("job")
    op.drop_table("generation_record")
