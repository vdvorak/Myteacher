"""An account's light or dark theme.

Revision ID: 0029
Revises: 0028
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("account", sa.Column("theme", sa.String(5)))


def downgrade() -> None:
    op.drop_column("account", "theme")
