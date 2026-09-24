"""Courses owned by a teacher, and their briefs with one column per field.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("taught_language", sa.String(10)),
        sa.Column("instruction_language", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "course_brief",
        sa.Column(
            "course_id",
            sa.Integer,
            sa.ForeignKey("course.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column("audience", sa.Text),
        sa.Column("level", sa.Text),
        sa.Column("goals", sa.Text),
        sa.Column("timeframe", sa.Text),
        sa.Column("preferred_exercise_types", sa.JSON, nullable=False),
        sa.Column("forbidden_exercise_types", sa.JSON, nullable=False),
        sa.Column("tone", sa.Text),
        sa.Column("feedback_mode", sa.String(20), nullable=False),
        sa.Column("retry_with_hint", sa.Boolean, nullable=False),
        sa.Column("second_round", sa.Boolean, nullable=False),
        sa.Column("notes", sa.Text),
    )


def downgrade() -> None:
    op.drop_table("course_brief")
    op.drop_table("course")
