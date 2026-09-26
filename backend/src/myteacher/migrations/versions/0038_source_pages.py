"""The text of a PDF source page by page, each page with how it was read, and the pages classroom
material was transcribed from and its answer key read from.

Revision ID: 0038
Revises: 0037
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("source", sa.Column("pages", sa.JSON, nullable=True))
    op.add_column("classroom_material", sa.Column("source_pages", sa.JSON, nullable=True))
    op.add_column("classroom_material", sa.Column("key_pages", sa.JSON, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("classroom_material") as batch:
        batch.drop_column("key_pages")
        batch.drop_column("source_pages")
    with op.batch_alter_table("source") as batch:
        batch.drop_column("pages")
