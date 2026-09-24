"""When a student's account was erased; the row stays, with placeholders.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("account") as table:
        table.add_column(sa.Column("erased_at", sa.DateTime, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("account") as table:
        table.drop_column("erased_at")
