"""When published results were shown to a student, and when the student last looked.

Revision ID: 0031
Revises: 0030
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assessment", sa.Column("published_at", sa.DateTime, nullable=True))
    op.add_column("attempt", sa.Column("results_seen_at", sa.DateTime, nullable=True))


def downgrade() -> None:
    op.drop_column("attempt", "results_seen_at")
    op.drop_column("assessment", "published_at")
