"""Open answers assessed by the assistant, the teacher's overrides, published results, and the
student whose work a generation record holds.

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def _add_reference(table: str, column: str, target: str, on_delete: str | None = None) -> None:
    # A plain column: a batch copy of these tables would, with foreign keys on, cascade to their
    # dependants when the old table is dropped. SQLite adds a column with a reference when its
    # default is null, but Alembic will not emit the constraint there, so it is written out.
    if op.get_bind().dialect.name == "sqlite":
        suffix = f" ON DELETE {on_delete}" if on_delete else ""
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN {column} INTEGER REFERENCES {target} (id){suffix}"
        )
    else:
        op.add_column(
            table, sa.Column(column, sa.Integer, sa.ForeignKey(f"{target}.id", ondelete=on_delete))
        )


def upgrade() -> None:
    _add_reference("material_release", "assessment_job_id", "job", "SET NULL")
    _add_reference("generation_record", "student_id", "account")
    op.create_index("ix_generation_record_student_id", "generation_record", ["student_id"])
    _add_reference("assessment", "generation_id", "generation_record")
    _add_reference("assessment", "overridden_by_id", "account")
    op.add_column("assessment", sa.Column("assistant_score", sa.Float))
    op.add_column("assessment", sa.Column("justification", sa.Text))
    op.add_column("assessment", sa.Column("feedback", sa.Text))
    op.add_column(
        "assessment",
        sa.Column("assistant_failed", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.add_column("assessment", sa.Column("override_score", sa.Float))
    op.add_column("assessment", sa.Column("override_reason", sa.Text))
    op.add_column("assessment", sa.Column("overridden_at", sa.DateTime))
    op.add_column("assessment", sa.Column("published", sa.JSON))


def downgrade() -> None:
    for column in (
        "published",
        "overridden_at",
        "override_reason",
        "override_score",
        "assistant_failed",
        "feedback",
        "justification",
        "assistant_score",
        "overridden_by_id",
        "generation_id",
    ):
        op.drop_column("assessment", column)
    op.drop_index("ix_generation_record_student_id", "generation_record")
    op.drop_column("generation_record", "student_id")
    op.drop_column("material_release", "assessment_job_id")
