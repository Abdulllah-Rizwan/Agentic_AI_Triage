"""add practitioners, practitioner_slots, appointments tables

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-07 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "practitioners",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("specialty", sa.String(), nullable=False),
        sa.Column("city", sa.String(), nullable=False),
        sa.Column("clinic_name", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "practitioner_slots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("practitioner_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("practitioners.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slot_date", sa.String(), nullable=False),
        sa.Column("slot_time", sa.String(), nullable=False),
        sa.Column("is_booked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "appointments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("practitioner_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("practitioners.id"), nullable=False),
        sa.Column("slot_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("practitioner_slots.id"), nullable=False),
        sa.Column("case_id", sa.String(), sa.ForeignKey("cases.id"), nullable=True),
        sa.Column("patient_name", sa.String(), nullable=False),
        sa.Column("patient_phone", sa.String(), nullable=False),
        sa.Column("chief_complaint", sa.String(), nullable=False),
        sa.Column("triage_level", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="PENDING"),
        sa.Column("booked_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("appointments")
    op.drop_table("practitioner_slots")
    op.drop_table("practitioners")
