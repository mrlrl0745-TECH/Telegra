"""Store teacher onboarding profiles.

Revision ID: 0004_teacher_profiles
Revises: 0003_read_only_telegram_bot
"""
from alembic import op

from app.models import TeacherProfile

revision = "0004_teacher_profiles"
down_revision = "0003_read_only_telegram_bot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    TeacherProfile.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    TeacherProfile.__table__.drop(bind=op.get_bind(), checkfirst=True)
