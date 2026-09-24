"""The minor flag on accounts and the guardian consent recorded for minors.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("account") as table:
        table.add_column(
            sa.Column("is_minor", sa.Boolean, nullable=False, server_default=sa.false())
        )
    op.create_table(
        "guardian_consent",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column(
            "student_id",
            sa.Integer,
            sa.ForeignKey("account.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("attested_by_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("recorded_at", sa.DateTime, nullable=False),
        sa.Column("note", sa.String(1000), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("guardian_consent")
    with op.batch_alter_table("account") as table:
        table.drop_column("is_minor")
