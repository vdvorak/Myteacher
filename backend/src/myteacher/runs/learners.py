"""Who works on a run's releases: its students, or a link run's participants (ADR 0012). A run
never holds both, so within one run a learner's id says who they are."""

from sqlalchemy import ColumnElement, func, select

from myteacher.accounts.models import Account
from myteacher.persistence import InstanceSession
from myteacher.runs import participants
from myteacher.runs import service as runs
from myteacher.runs.models import Attempt, CourseRun, Participant

Learner = Account | Participant

# The id of whoever owns an attempt, student or participant.
OWNER_ID = func.coalesce(Attempt.student_id, Attempt.participant_id)


def owns(learner: Learner) -> ColumnElement[bool]:
    """Selects the learner's attempts."""
    if isinstance(learner, Participant):
        return Attempt.participant_id == learner.id
    return Attempt.student_id == learner.id


def same(one: Learner, other: Learner) -> bool:
    """Ids of students and participants overlap, so the kind has to agree too."""
    return type(one) is type(other) and one.id == other.id


def owner(learner: Learner) -> dict[str, int]:
    """The columns that make a new attempt the learner's."""
    if isinstance(learner, Participant):
        return {"participant_id": learner.id}
    return {"student_id": learner.id}


def owned_by(attempt: Attempt, learner: Learner) -> bool:
    if isinstance(learner, Participant):
        return attempt.participant_id == learner.id
    return attempt.student_id == learner.id


def owner_id(attempt: Attempt) -> int:
    owner = attempt.student_id if attempt.student_id is not None else attempt.participant_id
    assert owner is not None
    return owner


def of_run(db: InstanceSession, run: CourseRun) -> list[Learner]:
    """Everyone on the run now: its roster, or a link run's participants in the order they
    joined."""
    if run.mode == "link":
        return list(participants.participants_of(db, run))
    return [entry.student for entry in runs.roster(db, run)]


def with_ids(db: InstanceSession, run: CourseRun, ids: set[int]) -> list[Learner]:
    """The learners of the run's kind with the ids, whether on it now or not."""
    if run.mode == "link":
        return list(
            db.scalars(
                select(Participant)
                .where(Participant.id.in_(ids), Participant.run_id == run.id)
                .order_by(Participant.joined_at, Participant.id)
            )
        )
    return list(
        db.scalars(select(Account).where(Account.id.in_(ids)).order_by(Account.name, Account.email))
    )


def names(db: InstanceSession, run: CourseRun) -> "Names":
    return Names(participants.display_names(db, run) if run.mode == "link" else {})


class Names:
    """What the teacher calls each learner of a run: a student by name, and a participant by the
    name they typed, numbered where others of the run typed it too."""

    def __init__(self, numbered: dict[int, str]):
        self._numbered = numbered

    def __call__(self, learner: Learner) -> str:
        if isinstance(learner, Participant):
            return self._numbered.get(learner.id, learner.name)
        return learner.name or ""
