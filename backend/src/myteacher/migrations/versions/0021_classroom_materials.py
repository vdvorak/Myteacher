"""Classroom material of topics, its versions, and the students it targets.

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def _instance() -> sa.Column:
    return sa.Column(
        "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
    )


def _cascade(name: str, table: str) -> sa.Column:
    return sa.Column(
        name,
        sa.Integer,
        sa.ForeignKey(f"{table}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


def upgrade() -> None:
    op.create_table(
        "classroom_material",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        _cascade("course_id", "course"),
        _cascade("topic_id", "topic"),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("job.id", ondelete="SET NULL")),
        sa.Column("created_by_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("discarded_at", sa.DateTime),
    )
    op.create_table(
        "classroom_material_version",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        _cascade("material_id", "classroom_material"),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("lesson", sa.JSON, nullable=False),
        sa.Column("instruction", sa.Text),
        sa.Column(
            "previous_version_id", sa.Integer, sa.ForeignKey("classroom_material_version.id")
        ),
        sa.Column("generation_id", sa.Integer, sa.ForeignKey("generation_record.id")),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("material_id", "number"),
    )
    op.create_table(
        "classroom_material_target",
        _instance(),
        sa.Column(
            "material_id",
            sa.Integer,
            sa.ForeignKey("classroom_material.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "student_id",
            sa.Integer,
            sa.ForeignKey("account.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("classroom_material_target")
    op.drop_table("classroom_material_version")
    op.drop_table("classroom_material")
