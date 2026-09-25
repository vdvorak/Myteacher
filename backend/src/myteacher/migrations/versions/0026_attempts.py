"""Attempts at released classroom material, their drafts and assessments, and the concepts the
assessments are about.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def _instance() -> sa.Column:
    return sa.Column(
        "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
    )


def _attempt_id(**kwargs) -> sa.Column:
    return sa.Column(
        "attempt_id",
        sa.Integer,
        sa.ForeignKey("attempt.id", ondelete="CASCADE"),
        nullable=False,
        **kwargs,
    )


def upgrade() -> None:
    op.create_table(
        "attempt",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        sa.Column(
            "release_id",
            sa.Integer,
            sa.ForeignKey("material_release.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "student_id",
            sa.Integer,
            sa.ForeignKey("account.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("seed", sa.String(64), nullable=False),
        sa.Column("started_at", sa.DateTime, nullable=False),
        sa.Column("submitted_at", sa.DateTime),
        sa.Column("late", sa.Boolean, nullable=False),
        sa.Column("second_round", sa.JSON),
        sa.Column("second_submitted_at", sa.DateTime),
        sa.UniqueConstraint("release_id", "student_id", "number"),
    )
    op.create_table(
        "attempt_draft",
        _attempt_id(primary_key=True),
        sa.Column("round", sa.String(10), primary_key=True),
        sa.Column("exercise_id", sa.String(100), primary_key=True),
        _instance(),
        sa.Column("answer", sa.JSON, nullable=False),
    )
    op.create_table(
        "assessment",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        _attempt_id(index=True),
        sa.Column("round", sa.String(10), nullable=False),
        sa.Column("exercise_id", sa.String(100), nullable=False),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("answer", sa.JSON, nullable=False),
        sa.Column("outcome", sa.JSON, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("score", sa.Float),
        sa.Column("correct", sa.Boolean),
        sa.Column("assessed_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("attempt_id", "round", "exercise_id", "number"),
    )
    op.create_table(
        "assessment_concept",
        sa.Column(
            "assessment_id",
            sa.Integer,
            sa.ForeignKey("assessment.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "concept_id",
            sa.Integer,
            sa.ForeignKey("concept.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
        _instance(),
    )


def downgrade() -> None:
    op.drop_table("assessment_concept")
    op.drop_table("assessment")
    op.drop_table("attempt_draft")
    op.drop_table("attempt")
