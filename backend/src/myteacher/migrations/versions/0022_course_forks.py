"""The course a fork was made from.

Revision ID: 0022
Revises: 0021
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


# A plain column: a batch copy of the course table would, with foreign keys on, cascade to
# everything in the courses when the old table is dropped. SQLite adds a column with a reference
# when its default is null, but Alembic will not emit the constraint there, so it is written out.
def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        op.execute(
            "ALTER TABLE course ADD COLUMN forked_from_id INTEGER "
            "REFERENCES course (id) ON DELETE SET NULL"
        )
    else:
        op.add_column(
            "course",
            sa.Column(
                "forked_from_id", sa.Integer, sa.ForeignKey("course.id", ondelete="SET NULL")
            ),
        )


def downgrade() -> None:
    op.drop_column("course", "forked_from_id")
