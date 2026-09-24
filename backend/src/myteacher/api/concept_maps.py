"""The concept map of a topic: proposed by the assistant on an editor's key, edited and approved by
the course's owner and editors, read by anyone who may view the course.

Every change answers with the whole map. Only a draft changes; an approved map is reopened first.
The proposal runs as a job; the client polls it, then reads the map again.
"""

from datetime import datetime
from typing import Annotated, Self

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)
from sqlalchemy.orm.exc import StaleDataError

from myteacher.accounts.models import Account
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.api.jobs import JobOut
from myteacher.assistant.service import paying_credential
from myteacher.courses import concepts, topics
from myteacher.courses.concepts import ConceptDescription, ConceptName
from myteacher.courses.models import Concept, ConceptMap, Course, Topic
from myteacher.jobs import runner
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(
    prefix="/courses/{course_id}/topics/{topic_id}/concept-map", tags=["concept maps"]
)
Teacher = Annotated[Account, requires(is_teacher)]


class ConceptOut(BaseModel):
    id: int
    name: str
    description: str
    # Current concepts of the same map, in map order.
    prerequisite_ids: list[int]


class ConceptMapOut(BaseModel):
    id: int
    topic_id: int
    state: str
    # Changes with every change of the map; approval names the version the teacher saw.
    version: int
    approved_at: datetime | None
    # Whether it was ever approved: then it is changed by hand, not proposed again.
    approved_before: bool
    concepts: list[ConceptOut]
    # The latest proposal.
    job: JobOut | None

    @field_serializer("approved_at")
    def _utc(self, at: datetime | None) -> str | None:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ") if at else None


class Started(BaseModel):
    concept_map: ConceptMapOut
    job: JobOut


class ConceptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ConceptName
    description: ConceptDescription = ""
    prerequisite_ids: list[int] = []


class ConceptChange(BaseModel):
    """Only the fields present change; none of them can be unset."""

    model_config = ConfigDict(extra="forbid")

    name: ConceptName | None = None
    description: ConceptDescription | None = None
    prerequisite_ids: list[int] | None = None

    @field_validator("name", "description", "prerequisite_ids")
    @classmethod
    def _cannot_be_unset(cls, value: object) -> object:
        if value is None:
            raise ValueError("can be changed but not unset")
        return value


class Merge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept_ids: Annotated[list[int], Field(min_length=2)]
    name: ConceptName
    description: ConceptDescription = ""

    @model_validator(mode="after")
    def _distinct(self) -> Self:
        if len(set(self.concept_ids)) != len(self.concept_ids):
            raise ValueError("each concept once")
        return self


class Part(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ConceptName
    description: ConceptDescription = ""


class Split(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parts: Annotated[list[Part], Field(min_length=2)]


class Approval(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The version of the map the teacher saw.
    version: int


def _out(db: InstanceSession, concept_map: ConceptMap) -> ConceptMapOut:
    job = runner.get_job(db, concept_map.job_id) if concept_map.job_id else None
    current = concepts.concepts_of(db, concept_map)
    graph = concepts.graph_of(db, concept_map)
    return ConceptMapOut(
        id=concept_map.id,
        topic_id=concept_map.topic_id,
        state=concept_map.state,
        version=concept_map.version,
        approved_at=concept_map.approved_at,
        approved_before=concept_map.approved_before,
        concepts=[
            ConceptOut(
                id=c.id,
                name=c.name,
                description=c.description,
                prerequisite_ids=[p.id for p in current if p.id in graph[c.id]],
            )
            for c in current
        ],
        job=JobOut.of(job) if job else None,
    )


def _topic(db: InstanceSession, course: Course, topic_id: int) -> Topic:
    topic = topics.get_topic(db, course, topic_id)
    if topic is None:
        raise HTTPException(status_code=404)
    return topic


def _map(db: InstanceSession, topic: Topic) -> ConceptMap:
    concept_map = concepts.map_of(db, topic)
    if concept_map is None:
        raise HTTPException(status_code=404)
    return concept_map


def _busy(db: InstanceSession, concept_map: ConceptMap) -> bool:
    job = runner.get_job(db, concept_map.job_id) if concept_map.job_id else None
    return job is not None and job.state in ("queued", "running")


def _editable_map(
    db: InstanceSession, actor: Account, course_id: int, topic_id: int, *, now: datetime
) -> ConceptMap:
    """The topic's map as a draft the actor may change, created when there is none yet."""
    course = editable_course(db, actor, course_id)
    concept_map = concepts.ensure_map(db, _topic(db, course, topic_id), now=now)
    if _busy(db, concept_map):
        raise HTTPException(status_code=409, detail="proposal_running")
    if concept_map.state != "draft":
        raise HTTPException(status_code=409, detail="map_approved")
    return concept_map


def _concept(db: InstanceSession, concept_map: ConceptMap, concept_id: int) -> Concept:
    concept = concepts.get_concept(db, concept_map, concept_id)
    if concept is None:
        raise HTTPException(status_code=404)
    return concept


def _save(db: InstanceSession) -> None:
    """Write now, so that a concurrent change to the map is refused rather than mixed in."""
    try:
        db.flush()
    except StaleDataError:
        raise HTTPException(status_code=409, detail="map_changed") from None


def _changed(db: InstanceSession, concept_map: ConceptMap, change) -> ConceptMapOut:
    try:
        change()
    except concepts.ConceptProblem as problem:
        raise HTTPException(status_code=422, detail=problem.kind) from None
    _save(db)
    return _out(db, concept_map)


@router.get("")
def read_map(course_id: int, topic_id: int, db: Db, actor: Teacher) -> ConceptMapOut | None:
    """The topic's concept map, or null when it has none yet."""
    topic = _topic(db, course_for(db, actor, course_id), topic_id)
    concept_map = concepts.map_of(db, topic)
    return _out(db, concept_map) if concept_map else None


@router.post(
    "/proposal",
    status_code=202,
    responses={409: {"description": "Running, approved before, or no provider key"}},
)
def propose(
    course_id: int,
    topic_id: int,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Let the assistant propose the map; the proposal replaces the draft's concepts."""
    course = editable_course(db, actor, course_id)
    topic = _topic(db, course, topic_id)
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    concept_map = concepts.ensure_map(db, topic, now=now)
    if concept_map.approved_before:
        # Its concepts may be tracked: replacing them would lose their identifiers.
        raise HTTPException(status_code=409, detail="approved_before")
    if _busy(db, concept_map):
        raise HTTPException(status_code=409, detail="proposal_running")
    job = runner.create_job(db, concepts.TASK_KIND, starter=actor, course_id=course.id, now=now)
    concept_map.job_id = job.id
    _save(db)
    # Runs after the response, once this request's transaction has committed.
    background.add_task(
        runner.run, request.app.state.jobs, job.id, concepts.proposal(concept_map.id)
    )
    return Started(concept_map=_out(db, concept_map), job=JobOut.of(job))


@router.post("/concepts", status_code=201)
def add_concept(
    course_id: int, topic_id: int, body: ConceptIn, db: Db, now: Now, actor: Teacher
) -> ConceptMapOut:
    """Add a concept at the end of the map, starting the map when the topic has none."""
    concept_map = _editable_map(db, actor, course_id, topic_id, now=now)
    return _changed(
        db,
        concept_map,
        lambda: concepts.add_concept(
            db,
            concept_map,
            name=body.name,
            description=body.description,
            prerequisite_ids=body.prerequisite_ids,
            now=now,
        ),
    )


@router.patch("/concepts/{concept_id}")
def change_concept(
    course_id: int,
    topic_id: int,
    concept_id: int,
    body: ConceptChange,
    db: Db,
    now: Now,
    actor: Teacher,
) -> ConceptMapOut:
    concept_map = _editable_map(db, actor, course_id, topic_id, now=now)
    concept = _concept(db, concept_map, concept_id)
    changes = {field: getattr(body, field) for field in body.model_fields_set}
    return _changed(
        db, concept_map, lambda: concepts.change_concept(db, concept_map, concept, changes)
    )


@router.delete("/concepts/{concept_id}")
def remove_concept(
    course_id: int, topic_id: int, concept_id: int, db: Db, now: Now, actor: Teacher
) -> ConceptMapOut:
    concept_map = _editable_map(db, actor, course_id, topic_id, now=now)
    concept = _concept(db, concept_map, concept_id)
    return _changed(
        db, concept_map, lambda: concepts.remove_concept(db, concept_map, concept, now=now)
    )


@router.post("/merges")
def merge_concepts(
    course_id: int, topic_id: int, body: Merge, db: Db, now: Now, actor: Teacher
) -> ConceptMapOut:
    """Merge concepts into a new one; the old ones are recorded as merged into it."""
    concept_map = _editable_map(db, actor, course_id, topic_id, now=now)
    merged = [_concept(db, concept_map, concept_id) for concept_id in body.concept_ids]
    return _changed(
        db,
        concept_map,
        lambda: concepts.merge(
            db, concept_map, merged, name=body.name, description=body.description, now=now
        ),
    )


@router.post("/concepts/{concept_id}/split")
def split_concept(
    course_id: int,
    topic_id: int,
    concept_id: int,
    body: Split,
    db: Db,
    now: Now,
    actor: Teacher,
) -> ConceptMapOut:
    """Split a concept into new ones; the old one is recorded as split into them."""
    concept_map = _editable_map(db, actor, course_id, topic_id, now=now)
    concept = _concept(db, concept_map, concept_id)
    parts = [(part.name, part.description) for part in body.parts]
    return _changed(
        db, concept_map, lambda: concepts.split(db, concept_map, concept, parts, now=now)
    )


@router.post(
    "/approval",
    responses={409: {"description": "Changed since seen, empty, approved or being proposed"}},
)
def approve_map(
    course_id: int, topic_id: int, body: Approval, db: Db, now: Now, actor: Teacher
) -> ConceptMapOut:
    """Approve the map as the teacher saw it: its concepts are what is tracked."""
    concept_map = _editable_map(db, actor, course_id, topic_id, now=now)
    if concept_map.version != body.version:
        raise HTTPException(status_code=409, detail="map_changed")
    if not concepts.concepts_of(db, concept_map):
        raise HTTPException(status_code=409, detail="empty_map")
    concepts.approve(concept_map, actor, now=now)
    _save(db)
    return _out(db, concept_map)


@router.post("/reopening", responses={409: {"description": "Not approved"}})
def reopen_map(course_id: int, topic_id: int, db: Db, actor: Teacher) -> ConceptMapOut:
    """Make an approved map a draft again, to change it and approve it once more."""
    course = editable_course(db, actor, course_id)
    concept_map = _map(db, _topic(db, course, topic_id))
    if concept_map.state != "approved":
        raise HTTPException(status_code=409, detail="not_approved")
    concepts.reopen(concept_map)
    _save(db)
    return _out(db, concept_map)
