"""Course runs with the classes and students enrolled in them.

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def _instance() -> sa.Column:
    return sa.Column(
        "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
    )


def upgrade() -> None:
    op.create_table(
        "course_run",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        sa.Column("course_id", sa.Integer, sa.ForeignKey("course.id"), nullable=False, index=True),
        sa.Column(
            "teacher_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False, index=True
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "run_class",
        sa.Column(
            "run_id",
            sa.Integer,
            sa.ForeignKey("course_run.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "class_id",
            sa.Integer,
            sa.ForeignKey("school_class.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
        _instance(),
    )
    op.create_table(
        "run_student",
        sa.Column(
            "run_id",
            sa.Integer,
            sa.ForeignKey("course_run.id", ondelete="CASCADE"),
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
    op.drop_table("run_student")
    op.drop_table("run_class")
    op.drop_table("course_run")
