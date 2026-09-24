"""Web pages as sources: the URL and when its snapshot was fetched.

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


# Plain column changes: a batch copy of the table would, with foreign keys on, cascade to the
# stored files when the old table is dropped.
def upgrade() -> None:
    op.add_column("source", sa.Column("url", sa.String(2000)))
    op.add_column("source", sa.Column("fetched_at", sa.DateTime))


def downgrade() -> None:
    op.drop_column("source", "fetched_at")
    op.drop_column("source", "url")
