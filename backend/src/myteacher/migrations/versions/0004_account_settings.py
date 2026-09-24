"""Interface language and digest time on accounts; the instance's default digest time.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("instance") as table:
        table.add_column(
            sa.Column("default_digest_time", sa.String(5), nullable=False, server_default="07:00")
        )
    with op.batch_alter_table("account") as table:
        # None until the person chooses; the interface then follows the browser.
        table.add_column(sa.Column("language", sa.String(2), nullable=True))
        # None follows the instance default.
        table.add_column(sa.Column("digest_time", sa.String(5), nullable=True))
        table.create_check_constraint("account_language", "language IN ('cs', 'en')")


def downgrade() -> None:
    with op.batch_alter_table("account") as table:
        table.drop_constraint("account_language", type_="check")
        table.drop_column("digest_time")
        table.drop_column("language")
    with op.batch_alter_table("instance") as table:
        table.drop_column("default_digest_time")
