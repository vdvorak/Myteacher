"""Classes and class membership, a plain join resolved at read time.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "school_class",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("instance_id", "name"),
    )
    op.create_table(
        "class_membership",
        sa.Column(
            "class_id",
            sa.Integer,
            sa.ForeignKey("school_class.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "student_id",
            sa.Integer,
            sa.ForeignKey("account.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
    )


def downgrade() -> None:
    op.drop_table("class_membership")
    op.drop_table("school_class")
