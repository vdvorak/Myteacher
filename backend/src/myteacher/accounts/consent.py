"""Minors and guardian consent (ADR 0007): no minor's account works without recorded consent.

The invariant is that a minor without consent is never active. Activation refuses it, and
marking an active student as a minor deactivates them, so sign-in and invitation acceptance
refuse the account as inactive without knowing about consent.
"""

from datetime import datetime
from typing import Literal

from sqlalchemy import select

from myteacher.accounts import service
from myteacher.accounts.models import Account, GuardianConsent
from myteacher.persistence import InstanceSession

StudentState = Literal["invited", "active", "inactive", "awaiting_consent", "erased"]


class NotAMinor(Exception):
    pass


def latest_consents(db: InstanceSession) -> dict[int, GuardianConsent]:
    """Each student's latest consent, by student id."""
    rows = db.scalars(select(GuardianConsent).order_by(GuardianConsent.id))
    return {consent.student_id: consent for consent in rows}


def latest_consent(db: InstanceSession, student: Account) -> GuardianConsent | None:
    return db.scalars(
        select(GuardianConsent)
        .where(GuardianConsent.student_id == student.id)
        .order_by(GuardianConsent.id.desc())
    ).first()


def student_state(student: Account, consent: GuardianConsent | None) -> StudentState:
    if student.erased_at is not None:
        return "erased"
    if not student.active and student.is_minor and consent is None:
        return "awaiting_consent"
    return service.account_state(student)  # type: ignore[return-value]


def mark_new_minor(db: InstanceSession, student: Account, *, actor: Account, now: datetime) -> None:
    """Mark a student just created as a minor; they start inactive, awaiting consent."""
    student.is_minor = True
    student.active = False
    service.record_event(db, "minor_marked", at=now, actor=actor, subject=student)


def set_minor(
    db: InstanceSession, student: Account, minor: bool, *, actor: Account, now: datetime
) -> None:
    """Mark or unmark a minor; an active minor without consent is deactivated until it comes."""
    if minor == student.is_minor:
        return
    student.is_minor = minor
    kind = "minor_marked" if minor else "minor_unmarked"
    service.record_event(db, kind, at=now, actor=actor, subject=student)
    if minor and student.active and not service.has_guardian_consent(db, student):
        service.set_active(db, student, False, actor=actor, now=now)


def record_consent(
    db: InstanceSession, student: Account, *, actor: Account, now: datetime, note: str | None
) -> GuardianConsent:
    """Record the teacher's attestation of a guardian's consent; it does not activate anyone."""
    if not student.is_minor:
        raise NotAMinor()
    consent = GuardianConsent(
        student_id=student.id, attested_by_id=actor.id, recorded_at=now, note=note
    )
    db.add(consent)
    db.flush()
    service.record_event(db, "consent_recorded", at=now, actor=actor, subject=student)
    return consent
