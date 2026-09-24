"""Concept maps of topics: their concepts, prerequisites and where merged or split concepts went.

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def _instance() -> sa.Column:
    return sa.Column(
        "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
    )


def _course() -> sa.Column:
    return sa.Column(
        "course_id",
        sa.Integer,
        sa.ForeignKey("course.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


def _concept(name: str, **options) -> sa.Column:
    return sa.Column(
        name, sa.Integer, sa.ForeignKey("concept.id", ondelete="CASCADE"), nullable=False, **options
    )


def upgrade() -> None:
    op.create_table(
        "concept_map",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        _course(),
        sa.Column(
            "topic_id",
            sa.Integer,
            sa.ForeignKey("topic.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("approved_at", sa.DateTime),
        sa.Column("approved_by_id", sa.Integer, sa.ForeignKey("account.id")),
        sa.Column("approved_before", sa.Boolean, nullable=False),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("job.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
    )
    op.create_table(
        "concept",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        _course(),
        sa.Column(
            "concept_map_id",
            sa.Integer,
            sa.ForeignKey("concept_map.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("retired_at", sa.DateTime),
        # Identifiers are never reused, not even those of deleted rows.
        sqlite_autoincrement=True,
    )
    op.create_table(
        "concept_prerequisite",
        _concept("concept_id", primary_key=True),
        _concept("prerequisite_id", primary_key=True, index=True),
        _instance(),
    )
    op.create_table(
        "concept_succession",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        _course(),
        _concept("old_concept_id", index=True),
        _concept("new_concept_id", index=True),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("concept_succession")
    op.drop_table("concept_prerequisite")
    op.drop_table("concept")
    op.drop_table("concept_map")
