"""Attempts by participants of link runs as well as by students (ADR 0012).

Revision ID: 0033
Revises: 0032
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("attempt") as batch:
        batch.alter_column("student_id", existing_type=sa.Integer, nullable=True)
        batch.add_column(sa.Column("participant_id", sa.Integer, nullable=True))
        batch.create_foreign_key(
            "fk_attempt_participant", "participant", ["participant_id"], ["id"], ondelete="CASCADE"
        )
        batch.create_index("ix_attempt_participant_id", ["participant_id"])
        batch.create_unique_constraint(
            "uq_attempt_participant_number", ["release_id", "participant_id", "number"]
        )
        batch.create_check_constraint(
            "ck_attempt_one_owner", "(student_id IS NULL) != (participant_id IS NULL)"
        )


def downgrade() -> None:
    op.execute("DELETE FROM attempt WHERE participant_id IS NOT NULL")
    with op.batch_alter_table("attempt") as batch:
        batch.drop_constraint("ck_attempt_one_owner", type_="check")
        batch.drop_constraint("uq_attempt_participant_number", type_="unique")
        batch.drop_index("ix_attempt_participant_id")
        batch.drop_constraint("fk_attempt_participant", type_="foreignkey")
        batch.drop_column("participant_id")
        batch.alter_column("student_id", existing_type=sa.Integer, nullable=False)
