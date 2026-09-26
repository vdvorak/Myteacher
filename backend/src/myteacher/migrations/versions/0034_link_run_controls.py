"""Closing a link run to newcomers, and removing its participants (ADR 0012).

Revision ID: 0034
Revises: 0033
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "course_run",
        sa.Column("joining_open", sa.Boolean, nullable=False, server_default=sa.true()),
    )
    op.add_column("participant", sa.Column("removed_at", sa.DateTime, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("participant") as batch:
        batch.drop_column("removed_at")
    with op.batch_alter_table("course_run") as batch:
        batch.drop_column("joining_open")
