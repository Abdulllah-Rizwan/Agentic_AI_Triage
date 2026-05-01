"""
Create the first admin user and a test responder.

Usage:
    python scripts/create_admin.py

Creates:
  - Org: "MediReach System" (GOVT, ACTIVE)  → admin@medireach.app / admin123
  - Org: "Test Hospital" (HOSPITAL, ACTIVE)  → responder@test.com / test123
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import sync_session
from app.models.db import User, Organization, OrgType, OrgStatus
from app.core.security import hash_password


def get_or_create_org(db, name: str, org_type: OrgType, access_code: str) -> Organization:
    org = db.query(Organization).filter_by(name=name).first()
    if not org:
        org = Organization(
            name=name,
            type=org_type,
            access_code=access_code,
            status=OrgStatus.ACTIVE,
        )
        db.add(org)
        db.flush()
        print(f"  Created org: {name}")
    else:
        print(f"  Org already exists: {name}")
    return org


def get_or_create_user(db, email: str, password: str, role: str, org_id) -> bool:
    existing = db.query(User).filter_by(email=email).first()
    if existing:
        print(f"  User already exists: {email}")
        return False
    user = User(
        email=email,
        password_hash=hash_password(password),
        role=role,
        org_id=org_id,
    )
    db.add(user)
    print(f"  Created user: {email}  role={role}  password={password}")
    return True


with sync_session() as db:
    print("\n--- Admin account ---")
    system_org = get_or_create_org(db, "MediReach System", OrgType.GOVT, "SYSTEM-ADMIN")
    get_or_create_user(db, "admin@medireach.app", "admin123", "ADMIN", system_org.id)

    print("\n--- Responder account ---")
    hospital_org = get_or_create_org(db, "Test Hospital", OrgType.HOSPITAL, "TESTHOSPITAL")
    get_or_create_user(db, "responder@test.com", "test123", "RESPONDER", hospital_org.id)

print("\nDone. You can now log in at http://localhost:3000")
print("  Admin:     admin@medireach.app / admin123")
print("  Responder: responder@test.com  / test123")
