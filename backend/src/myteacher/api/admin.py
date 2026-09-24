from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel, field_serializer

from myteacher.accounts import service
from myteacher.api.deps import Db, requires
from myteacher.policy import is_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[requires(is_admin)])


class AuditEventOut(BaseModel):
    kind: str
    actor_id: int | None
    subject_id: int | None
    at: datetime

    @field_serializer("at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/audit-events")
def list_audit_events(db: Db) -> list[AuditEventOut]:
    """The instance's account events, newest first."""
    return [
        AuditEventOut(kind=e.kind, actor_id=e.actor_id, subject_id=e.subject_id, at=e.at)
        for e in service.audit_events(db)
    ]
