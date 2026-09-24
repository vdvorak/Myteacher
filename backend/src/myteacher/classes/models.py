from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from myteacher import erasure
from myteacher.persistence import Base, InstanceOwned, UTCDateTime


class SchoolClass(InstanceOwned, Base):
    """A named group of students, such as "2.B 2026/27", maintained by any teacher."""

    __tablename__ = "school_class"
    __table_args__ = (UniqueConstraint("instance_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


class ClassMembership(InstanceOwned, Base):
    """A student in a class. A plain join, read at request time, so membership is always live."""

    __tablename__ = "class_membership"

    class_id: Mapped[int] = mapped_column(
        ForeignKey("school_class.id", ondelete="CASCADE"), primary_key=True
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), primary_key=True
    )


erasure.register(erasure.Rule(table="class_membership", student_column="student_id"))
