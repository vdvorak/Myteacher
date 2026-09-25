"""The course archive: exported by anyone who may view the course, as a backup and the one
portable representation of it (see `myteacher.courses.archive`)."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Response

from myteacher.accounts.models import Account
from myteacher.api.courses import course_for
from myteacher.api.deps import Db, Now, requires
from myteacher.courses import archive
from myteacher.policy import is_teacher

router = APIRouter(prefix="/courses/{course_id}", tags=["course archive"])
Teacher = Annotated[Account, requires(is_teacher)]


@router.get(
    "/export",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}, "description": "The course archive"}},
)
def export_course(course_id: int, db: Db, now: Now, actor: Teacher) -> Response:
    course = course_for(db, actor, course_id)
    # An ASCII fallback, and the course's own name for browsers that read RFC 6266.
    # Nothing of the name is safe unescaped there, not even a slash.
    name = quote(f"{course.name}.myteacher.zip", safe="")
    disposition = (
        f"attachment; filename=\"course-{course.id}.myteacher.zip\"; filename*=UTF-8''{name}"
    )
    return Response(
        content=archive.export(db, course, now=now),
        media_type="application/zip",
        headers={"Content-Disposition": disposition},
    )
