"""The device a link run participant's work is open on, and every device they opened it on
(ADR 0012).

Revision ID: 0036
Revises: 0035
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("participant", sa.Column("device", sa.String(64), nullable=True))
    op.create_table(
        "participant_device",
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column(
            "participant_id",
            sa.Integer,
            sa.ForeignKey("participant.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("device", sa.String(64), primary_key=True),
        sa.Column("first_opened_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("participant_device")
    with op.batch_alter_table("participant") as batch:
        batch.drop_column("device")
