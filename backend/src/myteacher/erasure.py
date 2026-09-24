"""Erasure of a student (ADR 0007): the one operation that physically removes personal data.

Every module whose tables hold student data registers a rule here, next to its models: the rows
are deleted, or anonymised in place when later statistics need them (such as attempts). Before
anything is touched, every rule is checked against the live schema, so a renamed or missing
table fails loudly instead of leaving the student's data behind.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

import sqlalchemy as sa

from myteacher.persistence import InstanceSession

# A placeholder value, or a function of the student's id giving one.
Placeholder = object | Callable[[int], object]


@dataclass(frozen=True)
class Rule:
    table: str
    # The column holding the student's account id.
    student_column: str
    # None deletes the student's rows; otherwise these columns are overwritten in place.
    anonymise: Mapping[str, Placeholder] | None = None


class ErasureMisconfigured(RuntimeError):
    """A registered rule names a table or column the database does not have."""


_rules: list[Rule] = []


def register(rule: Rule) -> None:
    _rules.append(rule)


def rules() -> list[Rule]:
    return list(_rules)


def check(db: InstanceSession) -> None:
    """Refuse to run unless every registered table and column exists."""
    inspector = sa.inspect(db.connection())
    tables = set(inspector.get_table_names())
    problems: list[str] = []
    for rule in rules():
        if rule.table not in tables:
            problems.append(f"table {rule.table} does not exist")
            continue
        columns = {column["name"] for column in inspector.get_columns(rule.table)}
        needed = ["instance_id", rule.student_column, *(rule.anonymise or {})]
        problems.extend(
            f"column {rule.table}.{c} does not exist" for c in needed if c not in columns
        )
    if problems:
        raise ErasureMisconfigured("; ".join(problems))


def erase(db: InstanceSession, student_id: int) -> None:
    """Remove or anonymise every registered row of the student in the session's instance.

    Deletions run before anonymisation, so rows pointing at an anonymised row go first.
    """
    check(db)
    ordered = sorted(rules(), key=lambda rule: rule.anonymise is not None)
    for rule in ordered:
        columns = ["instance_id", rule.student_column, *(rule.anonymise or {})]
        table = sa.table(rule.table, *(sa.column(c) for c in columns))
        where = sa.and_(
            table.c.instance_id == db.instance_id, table.c[rule.student_column] == student_id
        )
        if rule.anonymise is None:
            db.execute(sa.delete(table).where(where))
        else:
            values = {
                column: value(student_id) if callable(value) else value
                for column, value in rule.anonymise.items()
            }
            db.execute(sa.update(table).where(where).values(values))
