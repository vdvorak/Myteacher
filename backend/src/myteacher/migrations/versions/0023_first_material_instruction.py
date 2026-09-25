"""The instruction classroom material was first asked for with.

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


# A plain column, not a batch copy: dropping the old table would cascade to the versions.
def upgrade() -> None:
    op.add_column("classroom_material", sa.Column("instruction", sa.Text))


def downgrade() -> None:
    op.drop_column("classroom_material", "instruction")
