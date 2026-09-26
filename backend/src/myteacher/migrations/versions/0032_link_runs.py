"""Link runs, which people join through a link as participants without accounts (ADR 0012).

Revision ID: 0032
Revises: 0031
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("course_run") as batch:
        batch.add_column(
            sa.Column("mode", sa.String(10), nullable=False, server_default="enrolled")
        )
        batch.add_column(sa.Column("capacity", sa.Integer, nullable=True))
        batch.add_column(sa.Column("join_token", sa.String(64), nullable=True))
        batch.create_unique_constraint("uq_course_run_join_token", ["join_token"])
    op.create_table(
        "participant",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column(
            "run_id",
            sa.Integer,
            sa.ForeignKey("course_run.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("joined_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("participant")
    with op.batch_alter_table("course_run") as batch:
        batch.drop_constraint("uq_course_run_join_token", type_="unique")
        batch.drop_column("join_token")
        batch.drop_column("capacity")
        batch.drop_column("mode")
