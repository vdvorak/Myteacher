"""The two course steps a teacher confirms by hand.

Revision ID: 0030
Revises: 0029
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in ("brief_confirmed", "sources_skipped"):
        op.add_column(
            "course", sa.Column(column, sa.Boolean, nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    for column in ("brief_confirmed", "sources_skipped"):
        op.drop_column("course", column)
