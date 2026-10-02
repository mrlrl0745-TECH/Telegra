"""Track short-lived Telegram initData hashes to reject replayed logins.

Revision ID: 0002_telegram_auth_replays
Revises: 0001_initial
"""
from alembic import op

from app.models import TelegramAuthReplay

revision = "0002_telegram_auth_replays"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    TelegramAuthReplay.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    TelegramAuthReplay.__table__.drop(bind=op.get_bind(), checkfirst=True)
