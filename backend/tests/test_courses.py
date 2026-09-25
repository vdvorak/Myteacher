from myteacher import erasure
from myteacher.courses import service as courses
from myteacher.persistence import open_session
from tests.helpers import (
    TEACHER,
    TEACHER_PASSWORD,
    accept,
    as_student,
    back_to_teacher,
    create_engine_for,
    create_student,
    link_token,
    sign_in,
)

OTHER_TEACHER = "svoboda@skola.example"

COURSE = {
    "name": "Španělština 2.B",
    "subject": "Spanish",
    "taught_language": "es",
    "instruction_language": "cs",
}

DEFAULT_BRIEF = {
    "audience": None,
    "level": None,
    "goals": None,
    "timeframe": None,
    "preferred_exercise_types": [],
    "forbidden_exercise_types": [],
    "tone": None,
    "feedback_mode": "immediate",
    "retry_with_hint": True,
    "second_round": True,
    "notes": None,
}


def create_course(client, **fields):
    return client.post("/api/courses", json={**COURSE, **fields})


def edit_brief(client, course_id, **fields):
    return client.patch(f"/api/courses/{course_id}/brief", json=fields)


def as_other_teacher(client, sender) -> None:
    """Invite a second teacher as the admin and leave the client signed in as them."""
    client.cookies.clear()
    sign_in(client)
    client.post("/api/admin/teachers", json={"email": OTHER_TEACHER, "language": "cs"})
    token = link_token(sender.sent[-1].message.text)
    client.cookies.clear()
    assert accept(client, token, TEACHER_PASSWORD).status_code == 200


# Creating and listing


def test_a_teacher_creates_a_course_with_an_empty_brief(teacher, clock):
    me = teacher.get("/api/auth/me").json()

    created = create_course(teacher)

    assert created.status_code == 201
    body = created.json()
    assert body == {
        "id": body["id"],
        **COURSE,
        "owner_id": me["id"],
        "created_at": "2026-09-24T08:00:00Z",
        "brief": DEFAULT_BRIEF,
        "access": "owner",
        "can_edit": True,
        "can_manage_access": True,
        "can_fork": True,
        "forked_from_id": None,
    }
    assert teacher.get(f"/api/courses/{body['id']}").json() == body


def test_the_course_list_holds_the_teachers_courses_by_name(teacher):
    b = create_course(teacher, name="Zeměpis").json()
    a = create_course(teacher, name="Algebra", subject="Mathematics", taught_language=None).json()

    assert teacher.get("/api/courses").json() == [
        {
            "id": a["id"],
            "name": "Algebra",
            "subject": "Mathematics",
            "taught_language": None,
            "instruction_language": "cs",
            "access": "owner",
        },
        {
            "id": b["id"],
            "name": "Zeměpis",
            "subject": "Spanish",
            "taught_language": "es",
            "instruction_language": "cs",
            "access": "owner",
        },
    ]


def test_the_language_taught_is_separate_from_the_language_of_explanations(teacher):
    course = create_course(teacher, taught_language="es", instruction_language="cs").json()

    changed = teacher.patch(f"/api/courses/{course['id']}", json={"instruction_language": "es"})

    assert changed.json()["taught_language"] == "es"
    assert changed.json()["instruction_language"] == "es"
    assert create_course(teacher, taught_language=None).json()["taught_language"] is None


def test_the_course_basics_are_validated(teacher):
    assert create_course(teacher, name="   ").status_code == 422
    assert create_course(teacher, name="x" * 201).status_code == 422
    assert create_course(teacher, subject="").status_code == 422
    assert create_course(teacher, instruction_language="Czech").status_code == 422
    assert create_course(teacher, taught_language="spanish").status_code == 422
    assert create_course(teacher, instruction_language=None).status_code == 422
    assert create_course(teacher, owner_id=1).status_code == 422
    assert create_course(teacher, name="  Dějepis  ").json()["name"] == "Dějepis"


def test_the_course_basics_are_edited_one_at_a_time(teacher):
    course = create_course(teacher).json()
    url = f"/api/courses/{course['id']}"

    renamed = teacher.patch(url, json={"name": "Španělština 3.B"})

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Španělština 3.B"
    assert renamed.json()["subject"] == "Spanish"
    assert teacher.patch(url, json={"taught_language": None}).json()["taught_language"] is None
    assert teacher.patch(url, json={"name": ""}).status_code == 422
    assert teacher.patch(url, json={"instruction_language": None}).status_code == 422
    assert teacher.patch(url, json={"owner_id": 1}).status_code == 422


# The brief


def test_every_brief_field_is_edited_on_its_own(teacher):
    course = create_course(teacher).json()
    cid = course["id"]

    edit_brief(teacher, cid, audience="Sixteen-year-olds, second year of Spanish")
    edit_brief(teacher, cid, level="A2")
    edit_brief(teacher, cid, goals="Talk about the past in writing and speech.")
    edit_brief(teacher, cid, timeframe="Two lessons a week, September to June")
    edit_brief(teacher, cid, tone="Friendly, a little humour")
    edit_brief(teacher, cid, notes="Half of the class had a different teacher last year.")
    response = edit_brief(teacher, cid, level="A2+")

    assert response.status_code == 200
    assert response.json() == {
        **DEFAULT_BRIEF,
        "audience": "Sixteen-year-olds, second year of Spanish",
        "level": "A2+",
        "goals": "Talk about the past in writing and speech.",
        "timeframe": "Two lessons a week, September to June",
        "tone": "Friendly, a little humour",
        "notes": "Half of the class had a different teacher last year.",
    }
    assert teacher.get(f"/api/courses/{cid}").json()["brief"] == response.json()


def test_a_brief_field_is_cleared_with_null_or_blank_text(teacher):
    cid = create_course(teacher).json()["id"]
    edit_brief(teacher, cid, audience="Adults", level="B1")

    edit_brief(teacher, cid, audience=None)
    cleared = edit_brief(teacher, cid, level="   ")

    assert cleared.json()["audience"] is None
    assert cleared.json()["level"] is None


def test_brief_text_is_trimmed_and_limited(teacher):
    cid = create_course(teacher).json()["id"]

    assert edit_brief(teacher, cid, level="  A2  ").json()["level"] == "A2"
    assert edit_brief(teacher, cid, goals="x" * 5001).status_code == 422
    assert edit_brief(teacher, cid, goals="x" * 5000).status_code == 200
    assert edit_brief(teacher, cid, unknown="x").status_code == 422


def test_exercise_types_are_chosen_from_the_component_catalog(teacher):
    cid = create_course(teacher).json()["id"]

    chosen = edit_brief(
        teacher,
        cid,
        preferred_exercise_types=["cloze", "matching", "cloze"],
        forbidden_exercise_types=["free_text"],
    )

    assert chosen.status_code == 200
    assert chosen.json()["preferred_exercise_types"] == ["cloze", "matching"]
    assert chosen.json()["forbidden_exercise_types"] == ["free_text"]
    # A type without a renderer in this phase is not in the catalog.
    for outside in ("listening", "custom", "explanation", "anything"):
        assert edit_brief(teacher, cid, preferred_exercise_types=[outside]).status_code == 422


def test_a_type_cannot_be_both_preferred_and_forbidden(teacher):
    cid = create_course(teacher).json()["id"]
    edit_brief(teacher, cid, preferred_exercise_types=["cloze"])

    refused = edit_brief(teacher, cid, forbidden_exercise_types=["cloze"])
    at_once = edit_brief(
        teacher, cid, preferred_exercise_types=["matching"], forbidden_exercise_types=["matching"]
    )

    assert refused.status_code == 409
    assert refused.json() == {"detail": "type_preferred_and_forbidden"}
    assert at_once.status_code == 409
    brief = teacher.get(f"/api/courses/{cid}").json()["brief"]
    assert brief["preferred_exercise_types"] == ["cloze"]
    assert brief["forbidden_exercise_types"] == []
    moved = edit_brief(
        teacher, cid, preferred_exercise_types=[], forbidden_exercise_types=["cloze"]
    )
    assert moved.status_code == 200


def test_the_brief_holds_feedback_and_retry_defaults(teacher):
    cid = create_course(teacher).json()["id"]

    changed = edit_brief(teacher, cid, feedback_mode="at_the_end", retry_with_hint=False)
    changed = edit_brief(teacher, cid, second_round=False)

    assert changed.json()["feedback_mode"] == "at_the_end"
    assert changed.json()["retry_with_hint"] is False
    assert changed.json()["second_round"] is False
    assert edit_brief(teacher, cid, feedback_mode="never").status_code == 422
    assert edit_brief(teacher, cid, feedback_mode=None).status_code == 422
    assert edit_brief(teacher, cid, second_round=None).status_code == 422


def test_an_empty_brief_edit_changes_nothing(teacher):
    cid = create_course(teacher).json()["id"]
    edit_brief(teacher, cid, level="A2")

    assert edit_brief(teacher, cid).json()["level"] == "A2"


def test_concurrent_saves_of_different_fields_both_land(teacher, admin_settings):
    cid = create_course(teacher).json()["id"]
    engine = create_engine_for(admin_settings)

    # Both requests read the brief before either has written.
    with open_session(engine) as first, open_session(engine) as second:
        one = courses.get_course(first, cid)
        other = courses.get_course(second, cid)
        courses.change_brief(one, {"goals": "Talk about the past"})
        first.commit()
        courses.change_brief(other, {"tone": "Friendly"})
        second.commit()

    brief = teacher.get(f"/api/courses/{cid}").json()["brief"]
    assert brief["goals"] == "Talk about the past"
    assert brief["tone"] == "Friendly"


# Access


def test_another_teacher_cannot_see_or_change_the_course(teacher, sender):
    course = create_course(teacher).json()
    url = f"/api/courses/{course['id']}"
    as_other_teacher(teacher, sender)

    assert teacher.get("/api/courses").json() == []
    assert teacher.get(url).status_code == 404
    assert teacher.patch(url, json={"name": "Mine now"}).status_code == 404
    assert edit_brief(teacher, course["id"], level="C2").status_code == 404

    back_to_teacher(teacher)
    kept = teacher.get(url).json()
    assert kept["name"] == COURSE["name"]
    assert kept["brief"]["level"] is None


def test_the_admin_is_not_the_owner_either(teacher):
    course = create_course(teacher).json()
    teacher.cookies.clear()
    sign_in(teacher)

    assert teacher.get("/api/courses").json() == []
    assert teacher.get(f"/api/courses/{course['id']}").status_code == 404


def test_students_cannot_reach_courses(teacher, sender):
    course = create_course(teacher).json()
    as_student(teacher, sender)

    assert teacher.get("/api/courses").status_code == 403
    assert create_course(teacher).status_code == 403
    assert teacher.get(f"/api/courses/{course['id']}").status_code == 403
    assert teacher.patch(f"/api/courses/{course['id']}", json={"name": "x"}).status_code == 403
    assert edit_brief(teacher, course["id"], level="x").status_code == 403


def test_signed_out_visitors_cannot_reach_courses(teacher):
    course = create_course(teacher).json()
    teacher.cookies.clear()

    assert teacher.get("/api/courses").status_code == 401
    assert teacher.get(f"/api/courses/{course['id']}").status_code == 401


def test_an_unknown_course_is_not_found(teacher):
    assert teacher.get("/api/courses/999").status_code == 404
    assert teacher.patch("/api/courses/999", json={"name": "x"}).status_code == 404
    assert edit_brief(teacher, 999, level="x").status_code == 404


# Erasure


def test_course_tables_hold_no_student_data(teacher):
    tables = {rule.table for rule in erasure.rules()}

    assert not {"course"} & tables
    student = create_student(teacher).json()
    course = create_course(teacher).json()
    teacher.cookies.clear()
    sign_in(teacher)
    erased = teacher.post(
        f"/api/admin/students/{student['id']}/erasure", json={"confirmation": "Jana Veselá"}
    )
    assert erased.status_code == 204
    teacher.cookies.clear()
    sign_in(teacher, TEACHER, TEACHER_PASSWORD)
    assert teacher.get(f"/api/courses/{course['id']}").status_code == 200
