"""Provider credentials with encrypted keys; the SMTP password encrypted the same way.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_credential",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "instance_id", sa.Integer, sa.ForeignKey("instance.id"), nullable=False, index=True
        ),
        sa.Column(
            "account_id",
            sa.Integer,
            sa.ForeignKey("account.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("key_encrypted", sa.String, nullable=False),
        # The last characters, kept readable so the key can be recognised without revealing it.
        sa.Column("key_tail", sa.String(4), nullable=False),
        sa.Column("strong_model", sa.String(200), nullable=False),
        sa.Column("fast_model", sa.String(200), nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("account_id", "provider"),
    )

    box = op.get_context().config.attributes["secret_box"]
    with op.batch_alter_table("smtp_settings") as table:
        table.add_column(sa.Column("password_encrypted", sa.String, nullable=True))
    smtp = sa.table(
        "smtp_settings",
        sa.column("id", sa.Integer),
        sa.column("password", sa.String),
        sa.column("password_encrypted", sa.String),
    )
    connection = op.get_bind()
    for row in connection.execute(sa.select(smtp.c.id, smtp.c.password)).all():
        if row.password is not None:
            connection.execute(
                smtp.update()
                .where(smtp.c.id == row.id)
                .values(password_encrypted=box.encrypt(row.password))
            )
    with op.batch_alter_table("smtp_settings") as table:
        table.drop_column("password")


def downgrade() -> None:
    box = op.get_context().config.attributes["secret_box"]
    with op.batch_alter_table("smtp_settings") as table:
        table.add_column(sa.Column("password", sa.String, nullable=True))
    smtp = sa.table(
        "smtp_settings",
        sa.column("id", sa.Integer),
        sa.column("password", sa.String),
        sa.column("password_encrypted", sa.String),
    )
    connection = op.get_bind()
    for row in connection.execute(sa.select(smtp.c.id, smtp.c.password_encrypted)).all():
        if row.password_encrypted is not None:
            connection.execute(
                smtp.update()
                .where(smtp.c.id == row.id)
                .values(password=box.decrypt(row.password_encrypted))
            )
    with op.batch_alter_table("smtp_settings") as table:
        table.drop_column("password_encrypted")
    op.drop_table("provider_credential")
