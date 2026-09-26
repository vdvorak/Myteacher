"""When a link run's participants' names and answers were deleted, and the participant whose
answer a generation record holds (ADR 0012).

Revision ID: 0035
Revises: 0034
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("course_run", sa.Column("participants_erased_at", sa.DateTime, nullable=True))
    with op.batch_alter_table("generation_record") as batch:
        batch.add_column(sa.Column("participant_id", sa.Integer, nullable=True))
        batch.create_foreign_key(
            "fk_generation_record_participant",
            "participant",
            ["participant_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_generation_record_participant_id", ["participant_id"])


def downgrade() -> None:
    with op.batch_alter_table("generation_record") as batch:
        batch.drop_index("ix_generation_record_participant_id")
        batch.drop_constraint("fk_generation_record_participant", type_="foreignkey")
        batch.drop_column("participant_id")
    with op.batch_alter_table("course_run") as batch:
        batch.drop_column("participants_erased_at")
