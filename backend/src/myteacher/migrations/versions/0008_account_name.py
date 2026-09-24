"""A name on accounts, given to students when a teacher creates them.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("account") as table:
        # None for teachers, who are known by their email.
        table.add_column(sa.Column("name", sa.String(200), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("account") as table:
        table.drop_column("name")
