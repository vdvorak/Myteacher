"""Retracted attempts and releases.

Revision ID: 0028
Revises: 0027
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("attempt", "material_release"):
        op.add_column(table, sa.Column("retracted_at", sa.DateTime))
        op.add_column(table, sa.Column("retraction_reason", sa.Text))
        # A plain column with its reference written out, as in 0027: a batch copy of these
        # tables would cascade to their dependants.
        if op.get_bind().dialect.name == "sqlite":
            op.execute(
                f"ALTER TABLE {table} ADD COLUMN retracted_by_id INTEGER REFERENCES account (id)"
            )
        else:
            op.add_column(
                table, sa.Column("retracted_by_id", sa.Integer, sa.ForeignKey("account.id"))
            )


def downgrade() -> None:
    for table in ("attempt", "material_release"):
        for column in ("retracted_by_id", "retraction_reason", "retracted_at"):
            op.drop_column(table, column)
