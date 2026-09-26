"""Classroom material transcribed from a source: the source and answer key it came from, the
answers the assistant proposed, and the component backlog its paper-only exercises feed.

Revision ID: 0037
Revises: 0036
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("classroom_material") as batch:
        batch.add_column(
            sa.Column("transcribed", sa.Boolean, nullable=False, server_default=sa.false())
        )
        batch.add_column(sa.Column("source_id", sa.Integer, nullable=True))
        batch.add_column(sa.Column("key_source_id", sa.Integer, nullable=True))
        batch.create_foreign_key(
            "fk_classroom_material_source_id_source",
            "source",
            ["source_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_foreign_key(
            "fk_classroom_material_key_source_id_source",
            "source",
            ["key_source_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.add_column(
        "classroom_material_version", sa.Column("proposed_answers", sa.JSON, nullable=True)
    )
    op.create_table(
        "component_need",
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
        sa.Column(
            "material_id",
            sa.Integer,
            sa.ForeignKey("classroom_material.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("block_id", sa.String(64), nullable=False),
        sa.Column("prompt", sa.Text, nullable=False),
        sa.Column("need", sa.Text, nullable=False),
        sa.Column(
            "generation_id", sa.Integer, sa.ForeignKey("generation_record.id"), nullable=True
        ),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("component_need")
    with op.batch_alter_table("classroom_material_version") as batch:
        batch.drop_column("proposed_answers")
    with op.batch_alter_table("classroom_material") as batch:
        batch.drop_constraint("fk_classroom_material_key_source_id_source", type_="foreignkey")
        batch.drop_constraint("fk_classroom_material_source_id_source", type_="foreignkey")
        batch.drop_column("key_source_id")
        batch.drop_column("source_id")
        batch.drop_column("transcribed")
