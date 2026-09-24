"""Sources of a course: the original file and the text extracted from it.

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "source",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column(
            "course_id",
            sa.Integer,
            sa.ForeignKey("course.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("media_type", sa.String(50), nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("visible_to_students", sa.Boolean, nullable=False),
        sa.Column("text", sa.Text),
        sa.Column("extracted_with", sa.String(10)),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("job.id", ondelete="SET NULL")),
        sa.Column("uploaded_by_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "source_file",
        sa.Column(
            "source_id",
            sa.Integer,
            sa.ForeignKey("source.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column("content", sa.LargeBinary, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("source_file")
    op.drop_table("source")
