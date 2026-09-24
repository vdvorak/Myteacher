"""Topics of a course, in the teacher's order, with the diagnostic-wanted flag.

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "topic",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column(
            "course_id",
            sa.Integer,
            sa.ForeignKey("course.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("diagnostic_wanted", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("topic")
