"""Grant the Telegram bot read-only access to its two required tables.

Revision ID: 0003_read_only_telegram_bot
Revises: 0002_telegram_auth_replays
"""
from alembic import op
from sqlalchemy import text

revision = "0003_read_only_telegram_bot"
down_revision = "0002_telegram_auth_replays"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name != "postgresql":
        return
    role_exists = connection.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :name"), {"name": "ksp_bot"}).first()
    if role_exists:
        op.execute("GRANT SELECT ON TABLE users, lesson_plans TO ksp_bot")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name != "postgresql":
        return
    role_exists = connection.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :name"), {"name": "ksp_bot"}).first()
    if role_exists:
        op.execute("REVOKE SELECT ON TABLE users, lesson_plans FROM ksp_bot")
