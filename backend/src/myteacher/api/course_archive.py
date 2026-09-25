"""The course archive: exported by anyone who may view the course, as a backup and the one
portable representation of it (see `myteacher.courses.archive`). A fork is that export imported
again as a new course of the forking teacher (ADR 0008)."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Response

from myteacher.accounts.models import Account
from myteacher.api.courses import CourseOut, course_for
from myteacher.api.deps import Db, Now, requires
from myteacher.courses import archive
from myteacher.policy import can_fork_course, is_teacher

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


@router.post("/fork", status_code=201, responses={403: {"description": "No fork right"}})
def fork_course(course_id: int, db: Db, now: Now, actor: Teacher) -> CourseOut:
    """Make the actor's own copy of the course: owned by them, recording its origin, and never
    following later changes of the original. Everything in it gets identifiers of its own."""
    course = course_for(db, actor, course_id)
    if not can_fork_course(actor, course):
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        copy = archive.import_course(
            db, archive.export(db, course, now=now), actor, now=now, forked_from=course
        )
    except archive.ArchiveInvalid:
        # The course's own export always reads back; a failure here is the app's own bug.
        raise HTTPException(status_code=500, detail="archive_invalid") from None
    db.refresh(copy)
    return CourseOut.of(copy, actor)
