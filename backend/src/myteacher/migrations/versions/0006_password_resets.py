"""Password resets: single-use, short-lived links to set a new password.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column(
            "account_id",
            sa.Integer,
            sa.ForeignKey("account.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.Column("used_at", sa.DateTime, nullable=True),
        sa.Column("revoked_at", sa.DateTime, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("password_reset")
