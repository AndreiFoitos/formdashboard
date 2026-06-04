"""add friend_invites table + friendships.invite_token_id

Per-invite shareable link with 90-day expiry. Friendship.invite_token_id is
nullable so existing username-invited friendships stay untouched, and SET NULL
on invite delete so revoking a link never cascades to unfriending people.

Revision ID: c3d4e5f6a8b9
Revises: b2c3d4e5f6a8
Create Date: 2026-06-02 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3d4e5f6a8b9"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "friend_invites",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("inviter_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["inviter_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_friend_invites_token"),
    )
    op.create_index("ix_friend_invites_inviter_id", "friend_invites", ["inviter_id"])
    op.create_index("ix_friend_invites_token", "friend_invites", ["token"])

    op.add_column(
        "friendships",
        sa.Column(
            "invite_token_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("friend_invites.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_friendships_invite_token_id",
        "friendships",
        ["invite_token_id"],
        postgresql_where=sa.text("invite_token_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_friendships_invite_token_id", table_name="friendships")
    op.drop_column("friendships", "invite_token_id")
    op.drop_index("ix_friend_invites_token", table_name="friend_invites")
    op.drop_index("ix_friend_invites_inviter_id", table_name="friend_invites")
    op.drop_table("friend_invites")
