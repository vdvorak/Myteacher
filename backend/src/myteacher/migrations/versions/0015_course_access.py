"""The course access list, and the course and detail of an audit event.

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_access",
        sa.Column(
            "course_id",
            sa.Integer,
            sa.ForeignKey("course.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "teacher_id", sa.Integer, sa.ForeignKey("account.id"), primary_key=True, index=True
        ),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column("right", sa.String(10), nullable=False),
        sa.Column("granted_at", sa.DateTime, nullable=False),
    )
    op.add_column("audit_event", sa.Column("course_id", sa.Integer))
    op.add_column("audit_event", sa.Column("detail", sa.String(50)))


def downgrade() -> None:
    with op.batch_alter_table("audit_event") as batch:
        batch.drop_column("detail")
        batch.drop_column("course_id")
    op.drop_table("course_access")
