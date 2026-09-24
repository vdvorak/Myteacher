"""Topic interviews, the additions they store on a topic, and the assistant's diagnostic offer.

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

ADDITIONS = ("goals", "prior_knowledge", "emphasis", "notes")


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


# Plain column changes: a batch copy of the topic table would, with foreign keys on, cascade to
# the concept maps when the old table is dropped.
def upgrade() -> None:
    for name in ADDITIONS:
        op.add_column("topic", sa.Column(name, sa.Text))
    op.add_column("topic", sa.Column("diagnostic_offer", sa.Text))
    op.add_column("topic", sa.Column("diagnostic_offer_answer", sa.String(10)))
    op.create_table(
        "topic_interview",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance(),
        _cascade("course_id", "course"),
        _cascade("topic_id", "topic"),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("rounds", sa.JSON, nullable=False),
        sa.Column("summary", sa.Text),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("job.id", ondelete="SET NULL")),
        sa.Column("started_by_id", sa.Integer, sa.ForeignKey("account.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
    )
    op.create_index(
        "one_active_topic_interview",
        "topic_interview",
        ["topic_id"],
        unique=True,
        sqlite_where=sa.text("state = 'active'"),
        postgresql_where=sa.text("state = 'active'"),
    )


def downgrade() -> None:
    op.drop_table("topic_interview")
    op.drop_column("topic", "diagnostic_offer_answer")
    op.drop_column("topic", "diagnostic_offer")
    for name in reversed(ADDITIONS):
        op.drop_column("topic", name)
