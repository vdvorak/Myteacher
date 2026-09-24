"""Accounts, server-side sessions and the audit log; the singleton instance row.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _instance_id() -> sa.Column:
    return sa.Column(
        "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
    )


def upgrade() -> None:
    # Phase 1 has exactly one instance; every row below belongs to it (ADR 0003).
    op.execute(
        "INSERT INTO instance (id, name) SELECT 1, 'Myteacher'"
        " WHERE NOT EXISTS (SELECT 1 FROM instance)"
    )
    op.create_table(
        "account",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance_id(),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("password_hash", sa.String, nullable=True),
        sa.Column("is_admin", sa.Boolean, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("instance_id", "email"),
        sa.CheckConstraint("kind IN ('teacher', 'student')", name="account_kind"),
        sa.CheckConstraint("kind = 'teacher' OR NOT is_admin", name="only_teachers_are_admins"),
    )
    op.create_table(
        "auth_session",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        _instance_id(),
        sa.Column(
            "account_id",
            sa.Integer,
            sa.ForeignKey("account.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("expires_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "audit_event",
        sa.Column("id", sa.Integer, primary_key=True),
        _instance_id(),
        sa.Column("actor_id", sa.Integer, sa.ForeignKey("account.id"), nullable=True),
        sa.Column("subject_id", sa.Integer, sa.ForeignKey("account.id"), nullable=True),
        sa.Column("kind", sa.String(50), nullable=False),
        sa.Column("at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("audit_event")
    op.drop_table("auth_session")
    op.drop_table("account")
