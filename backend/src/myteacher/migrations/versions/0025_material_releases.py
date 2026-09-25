"""Classroom material versions released to course runs, and the students chosen for them.

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def _instance() -> sa.Column:
    return sa.Column(
        "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
    )


def upgrade() -> None:
    op.create_table(
        "material_release",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        sa.Column(
            "run_id",
            sa.Integer,
            sa.ForeignKey("course_run.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "material_id",
            sa.Integer,
            sa.ForeignKey("classroom_material.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "version_id",
            sa.Integer,
            sa.ForeignKey("classroom_material_version.id"),
            nullable=False,
        ),
        sa.Column("audience", sa.String(10), nullable=False),
        sa.Column("feedback_mode", sa.String(20), nullable=False),
        sa.Column("due_at", sa.DateTime),
        sa.Column("late_submissions", sa.String(10), nullable=False),
        sa.Column("attempts", sa.String(10), nullable=False),
        sa.Column("show_solutions", sa.Boolean, nullable=False),
        sa.Column("released_by_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("released_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "release_student",
        sa.Column(
            "release_id",
            sa.Integer,
            sa.ForeignKey("material_release.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "student_id",
            sa.Integer,
            sa.ForeignKey("account.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
        _instance(),
    )


def downgrade() -> None:
    op.drop_table("release_student")
    op.drop_table("material_release")
