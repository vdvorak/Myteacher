"""Reference documents of topics, their versions, and teachers' reactions to generations.

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def _instance() -> sa.Column:
    return sa.Column(
        "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
    )


def _cascade(name: str, table: str) -> sa.Column:
    return sa.Column(
        name,
        sa.Integer,
        sa.ForeignKey(f"{table}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


def upgrade() -> None:
    op.create_table(
        "generation_reaction",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        sa.Column(
            "generation_id",
            sa.Integer,
            sa.ForeignKey("generation_record.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("account_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("detail", sa.JSON),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "reference_document",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        _cascade("course_id", "course"),
        _cascade("topic_id", "topic"),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("generation_id", sa.Integer, sa.ForeignKey("generation_record.id")),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("job.id", ondelete="SET NULL")),
        sa.Column("created_by_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("discarded_at", sa.DateTime),
    )
    op.create_table(
        "reference_document_version",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        _cascade("document_id", "reference_document"),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("passages", sa.JSON, nullable=False),
        sa.Column("generation_id", sa.Integer, sa.ForeignKey("generation_record.id")),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("document_id", "number"),
    )


def downgrade() -> None:
    op.drop_table("reference_document_version")
    op.drop_table("reference_document")
    op.drop_table("generation_reaction")
