"""SMTP settings of the instance.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "smtp_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, unique=True
        ),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer, nullable=False),
        sa.Column("security", sa.String(10), nullable=False),
        sa.Column("username", sa.String(255), nullable=False),
        sa.Column("password", sa.String, nullable=True),
        sa.Column("sender", sa.String(320), nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("security IN ('starttls', 'ssl', 'none')", name="smtp_security"),
        sa.CheckConstraint("port BETWEEN 1 AND 65535", name="smtp_port"),
    )


def downgrade() -> None:
    op.drop_table("smtp_settings")
