"""Concept maps of topics: the assistant proposes one, the teacher edits and approves it.

A concept keeps its identifier through edits to its text. Removing, merging or splitting retires
concepts instead of deleting them; a merge or a split creates new concepts and records which old
concept went to which new one, so that concept states (slice 4) can follow. Prerequisites link
current concepts of the same map and never form a cycle.
"""

from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.orm.exc import StaleDataError

from myteacher.accounts.models import Account
from myteacher.accounts.service import get_account
from myteacher.assistant.service import Task, generate
from myteacher.courses import service as courses
from myteacher.courses.models import (
    Concept,
    ConceptMap,
    ConceptPrerequisite,
    ConceptSuccession,
    Course,
    SuccessionKind,
    Topic,
)
from myteacher.courses.topics import topics_of
from myteacher.jobs.models import Job
from myteacher.jobs.runner import JobContext, Work
from myteacher.persistence import InstanceSession

TASK_KIND = "concept_map"

ConceptName = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]
ConceptDescription = Annotated[str, AfterValidator(str.strip), Field(max_length=1000)]


class ConceptProblem(Exception):
    """A change the map cannot take; `kind` says why."""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


# Prerequisites of each current concept of a map, by id.
Graph = dict[int, set[int]]


def _cycle(graph: Graph) -> bool:
    done: set[int] = set()
    on_path: set[int] = set()

    def visit(node: int) -> bool:
        if node in on_path:
            return True
        if node in done:
            return False
        on_path.add(node)
        found = any(visit(p) for p in graph.get(node, ()))
        on_path.discard(node)
        done.add(node)
        return found

    return any(visit(node) for node in graph)


# The assistant's proposal


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProposedConcept(_Strict):
    key: Annotated[str, Field(min_length=1, max_length=60)] = Field(
        description="A short identifier, unique in the proposal, that prerequisites refer to."
    )
    name: ConceptName
    description: ConceptDescription
    prerequisites: list[str] = Field(
        description="Keys of the concepts of this proposal that must be known first."
    )


class Proposal(_Strict):
    concepts: Annotated[list[ProposedConcept], Field(min_length=1, max_length=80)]

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        keys = [c.key for c in self.concepts]
        if len(set(keys)) != len(keys):
            raise ValueError("every key must be unique")
        unknown = {p for c in self.concepts for p in c.prerequisites} - set(keys)
        if unknown:
            raise ValueError(f"prerequisites name unknown keys: {sorted(unknown)}")
        if _cycle(
            {i: {keys.index(p) for p in c.prerequisites} for i, c in enumerate(self.concepts)}
        ):
            raise ValueError("prerequisites must not form a cycle")
        return self


PROPOSE = Task(kind=TASK_KIND, output_type=Proposal, slot="strong")


# Reading


def map_of(db: InstanceSession, topic: Topic) -> ConceptMap | None:
    return db.scalars(select(ConceptMap).where(ConceptMap.topic_id == topic.id)).first()


def ensure_map(db: InstanceSession, topic: Topic, *, now: datetime) -> ConceptMap:
    """The topic's map, created as an empty draft when it has none yet."""
    existing = map_of(db, topic)
    if existing is not None:
        return existing
    concept_map = ConceptMap(
        course_id=topic.course_id, topic_id=topic.id, state="draft", created_at=now
    )
    savepoint = db.begin_nested()
    db.add(concept_map)
    try:
        db.flush()
    except IntegrityError:
        # Another request created it meanwhile.
        savepoint.rollback()
        found = map_of(db, topic)
        assert found is not None
        return found
    savepoint.commit()
    return concept_map


def concepts_of(db: InstanceSession, concept_map: ConceptMap) -> list[Concept]:
    """The map's current concepts, in order."""
    return list(
        db.scalars(
            select(Concept)
            .where(Concept.concept_map_id == concept_map.id, Concept.retired_at.is_(None))
            .order_by(Concept.position, Concept.id)
        )
    )


def get_concept(db: InstanceSession, concept_map: ConceptMap, concept_id: int) -> Concept | None:
    return db.scalars(
        select(Concept).where(
            Concept.id == concept_id,
            Concept.concept_map_id == concept_map.id,
            Concept.retired_at.is_(None),
        )
    ).first()


def graph_of(db: InstanceSession, concept_map: ConceptMap) -> Graph:
    graph: Graph = {c.id: set() for c in concepts_of(db, concept_map)}
    edges = db.execute(
        select(ConceptPrerequisite.concept_id, ConceptPrerequisite.prerequisite_id).where(
            ConceptPrerequisite.concept_id.in_(graph)
        )
    )
    for concept_id, prerequisite_id in edges:
        graph[concept_id].add(prerequisite_id)
    return graph


# Changing


def _changed(concept_map: ConceptMap) -> None:
    """Bump the map's version, whichever of its rows changed."""
    flag_modified(concept_map, "state")


def _renumber(concepts: list[Concept]) -> None:
    for position, concept in enumerate(concepts):
        concept.position = position


def _save_graph(db: InstanceSession, concept_map: ConceptMap, graph: Graph) -> None:
    if _cycle(graph):
        raise ConceptProblem("prerequisite_cycle")
    in_map = select(Concept.id).where(Concept.concept_map_id == concept_map.id)
    db.execute(delete(ConceptPrerequisite).where(ConceptPrerequisite.concept_id.in_(in_map)))
    db.add_all(
        ConceptPrerequisite(concept_id=concept_id, prerequisite_id=prerequisite_id)
        for concept_id, prerequisites in graph.items()
        for prerequisite_id in prerequisites
    )


def _checked(graph: Graph, prerequisite_ids: list[int]) -> set[int]:
    if not set(prerequisite_ids) <= set(graph):
        raise ConceptProblem("unknown_prerequisite")
    return set(prerequisite_ids)


def _new(
    concept_map: ConceptMap, name: str, description: str, position: int, now: datetime
) -> Concept:
    return Concept(
        course_id=concept_map.course_id,
        concept_map_id=concept_map.id,
        position=position,
        name=name,
        description=description,
        created_at=now,
    )


def add_concept(
    db: InstanceSession,
    concept_map: ConceptMap,
    *,
    name: str,
    description: str,
    prerequisite_ids: list[int],
    now: datetime,
) -> Concept:
    """Add a concept at the end of the map."""
    graph = graph_of(db, concept_map)
    prerequisites = _checked(graph, prerequisite_ids)
    concept = _new(concept_map, name, description, len(graph), now)
    db.add(concept)
    db.flush()
    graph[concept.id] = prerequisites
    _save_graph(db, concept_map, graph)
    _changed(concept_map)
    return concept


def change_concept(
    db: InstanceSession, concept_map: ConceptMap, concept: Concept, changes: dict[str, Any]
) -> None:
    """Change the text or the prerequisites of a concept; its identifier stays."""
    for field in ("name", "description"):
        if field in changes:
            setattr(concept, field, changes[field])
    if "prerequisite_ids" in changes:
        graph = graph_of(db, concept_map)
        graph[concept.id] = _checked(graph, changes["prerequisite_ids"])
        _save_graph(db, concept_map, graph)
    _changed(concept_map)


def _retire(graph: Graph, retired: list[Concept], now: datetime) -> None:
    """Take concepts out of the graph; the caller links what required them to their successors."""
    for concept in retired:
        concept.retired_at = now
        graph.pop(concept.id)


def _succeed(
    db: InstanceSession,
    concept_map: ConceptMap,
    pairs: list[tuple[Concept, Concept]],
    kind: SuccessionKind,
    now: datetime,
) -> None:
    db.add_all(
        ConceptSuccession(
            course_id=concept_map.course_id,
            old_concept_id=old.id,
            new_concept_id=new.id,
            kind=kind,
            created_at=now,
        )
        for old, new in pairs
    )


def remove_concept(
    db: InstanceSession, concept_map: ConceptMap, concept: Concept, *, now: datetime
) -> None:
    """Retire the concept; what required it no longer does."""
    graph = graph_of(db, concept_map)
    _retire(graph, [concept], now)
    for prerequisites in graph.values():
        prerequisites.discard(concept.id)
    _save_graph(db, concept_map, graph)
    _renumber([c for c in concepts_of(db, concept_map) if c.id != concept.id])
    _changed(concept_map)


def merge(
    db: InstanceSession,
    concept_map: ConceptMap,
    merged: list[Concept],
    *,
    name: str,
    description: str,
    now: datetime,
) -> Concept:
    """Replace the concepts with one new concept in the place of the first of them.

    The new concept requires what any of them required, and whatever required any of them
    requires the new concept.
    """
    graph = graph_of(db, concept_map)
    old_ids = {c.id for c in merged}
    current = concepts_of(db, concept_map)
    concept = _new(concept_map, name, description, 0, now)
    db.add(concept)
    db.flush()
    prerequisites = set().union(*(graph[c.id] for c in merged)) - old_ids
    _retire(graph, merged, now)
    for required in graph.values():
        if required & old_ids:
            required -= old_ids
            required.add(concept.id)
    graph[concept.id] = prerequisites
    _save_graph(db, concept_map, graph)
    first = min(merged, key=lambda c: c.position)
    order = [concept if c is first else c for c in current if c is first or c.id not in old_ids]
    _renumber(order)
    _succeed(db, concept_map, [(old, concept) for old in merged], "merge", now)
    _changed(concept_map)
    return concept


def split(
    db: InstanceSession,
    concept_map: ConceptMap,
    concept: Concept,
    parts: list[tuple[str, str]],
    *,
    now: datetime,
) -> list[Concept]:
    """Replace the concept with new concepts, named and described as `parts`, in its place.

    Every part requires what the concept required, and whatever required the concept requires
    every part.
    """
    graph = graph_of(db, concept_map)
    current = concepts_of(db, concept_map)
    new = [_new(concept_map, name, description, 0, now) for name, description in parts]
    db.add_all(new)
    db.flush()
    prerequisites = graph[concept.id]
    _retire(graph, [concept], now)
    for required in graph.values():
        if concept.id in required:
            required.discard(concept.id)
            required.update(c.id for c in new)
    for part in new:
        graph[part.id] = set(prerequisites)
    _save_graph(db, concept_map, graph)
    order: list[Concept] = []
    for c in current:
        order.extend(new if c is concept else [c])
    _renumber(order)
    _succeed(db, concept_map, [(concept, part) for part in new], "split", now)
    _changed(concept_map)
    return new


def approve(concept_map: ConceptMap, approver: Account, *, now: datetime) -> None:
    concept_map.state = "approved"
    concept_map.approved_at = now
    concept_map.approved_by_id = approver.id
    concept_map.approved_before = True


def reopen(concept_map: ConceptMap) -> None:
    concept_map.state = "draft"
    concept_map.approved_at = None
    concept_map.approved_by_id = None


# The proposal job


def _inputs(db: InstanceSession, course: Course, topic: Topic) -> dict[str, Any]:
    return {
        "course": {
            "name": course.name,
            "subject": course.subject,
            "taught_language": course.taught_language,
            "instruction_language": course.instruction_language,
        },
        "brief": courses.brief_of(course).model_dump(mode="json"),
        "topics": [t.name for t in topics_of(db, course)],
        "topic": {"name": topic.name, "position": topic.position},
    }


def _replace(db: InstanceSession, concept_map: ConceptMap, proposal: Proposal, now: datetime):
    """Retire the draft's concepts and put the proposed ones in their place."""
    graph = graph_of(db, concept_map)
    _retire(graph, concepts_of(db, concept_map), now)
    new = [
        _new(concept_map, c.name, c.description, position, now)
        for position, c in enumerate(proposal.concepts)
    ]
    db.add_all(new)
    db.flush()
    ids = {
        proposed.key: concept.id for proposed, concept in zip(proposal.concepts, new, strict=True)
    }
    for proposed, concept in zip(proposal.concepts, new, strict=True):
        graph[concept.id] = {ids[key] for key in proposed.prerequisites}
    _save_graph(db, concept_map, graph)
    _changed(concept_map)


def proposal(concept_map_id: int) -> Work:
    """The work of a proposal job for the map."""

    async def work(db: InstanceSession, job: Job, ctx: JobContext) -> dict[str, Any]:
        concept_map = db.get(ConceptMap, concept_map_id)
        if concept_map is None or concept_map.job_id != job.id:
            return {"superseded": True}
        topic = db.get_one(Topic, concept_map.topic_id)
        course = courses.get_course(db, concept_map.course_id)
        teacher = get_account(db, job.account_id)
        assert course is not None and teacher is not None
        output = await generate(
            ctx.assistant,
            db,
            PROPOSE,
            teacher=teacher,
            inputs=_inputs(db, course, topic),
            course_id=course.id,
        )
        # Nothing else changes the map while the job runs, but land on a fresh row and once more
        # if a concurrent change wins the race anyway. The topic, and with it the map, may have
        # been removed meanwhile.
        for attempt in range(2):
            fresh = db.get(ConceptMap, concept_map_id, populate_existing=True)
            if fresh is None or fresh.job_id != job.id or fresh.state != "draft":
                return {"superseded": True}
            concept_map = fresh
            _replace(db, concept_map, output, ctx.assistant.clock())
            try:
                db.flush()
                break
            except StaleDataError:
                db.rollback()
                if attempt == 1:
                    raise
        return {"concept_map_id": concept_map.id}

    return work
