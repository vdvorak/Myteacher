from datetime import UTC, datetime

import pytest

from myteacher.accounts.service import get_account
from myteacher.courses import access
from myteacher.courses.service import get_course
from myteacher.persistence import open_session
from myteacher.policy import can_edit_course, can_fork_course, can_view_course
from tests.helpers import (
    TEACHER,
    TEACHER_PASSWORD,
    accept,
    as_student,
    back_to_teacher,
    create_engine_for,
    link_token,
    sign_in,
)
from tests.test_courses import COURSE, create_course, edit_brief

COLLEAGUE = "svoboda@skola.example"
THIRD = "kralova@skola.example"
NOW = datetime(2026, 9, 24, 8, tzinfo=UTC)


def invite_teachers(client, sender, *emails) -> dict[str, int]:
    """Invite teachers as the admin; leaves the client signed in as the first teacher."""
    ids = {}
    for email in emails:
        client.cookies.clear()
        sign_in(client)
        ids[email] = client.post(
            "/api/admin/teachers", json={"email": email, "language": "cs"}
        ).json()["id"]
        token = link_token(sender.sent[-1].message.text)
        client.cookies.clear()
        assert accept(client, token, TEACHER_PASSWORD).status_code == 200
    back_to_teacher(client)
    return ids


def as_teacher(client, email) -> None:
    client.cookies.clear()
    sign_in(client, email, TEACHER_PASSWORD)


def access_url(course_id: int) -> str:
    return f"/api/courses/{course_id}/access"


def grant(client, course_id, email, right):
    return client.post(access_url(course_id), json={"email": email, "right": right})


def transfer(client, course_id, email, **fields):
    return client.post(f"/api/courses/{course_id}/owner", json={"email": email, **fields})


@pytest.fixture
def colleagues(teacher, sender) -> dict[str, int]:
    ids = invite_teachers(teacher, sender, COLLEAGUE, THIRD)
    ids[TEACHER] = teacher.get("/api/auth/me").json()["id"]
    return ids


@pytest.fixture
def course(teacher, colleagues) -> dict:
    return create_course(teacher).json()


def entries(response) -> list[tuple[str, str]]:
    return [(entry["email"], entry["right"]) for entry in response.json()]


# The owner manages the list


def test_a_new_course_is_shared_with_nobody(teacher, course):
    assert teacher.get(access_url(course["id"])).json() == []


def test_the_owner_grants_rights_to_named_teachers(teacher, course, colleagues):
    granted = grant(teacher, course["id"], COLLEAGUE, "edit")
    grant(teacher, course["id"], f"  {THIRD.upper()} ", "fork")

    assert granted.status_code == 200
    assert granted.json() == [
        {"teacher_id": colleagues[COLLEAGUE], "email": COLLEAGUE, "right": "edit"}
    ]
    # By email, so the list reads the same for everyone.
    assert entries(teacher.get(access_url(course["id"]))) == [
        (THIRD, "fork"),
        (COLLEAGUE, "edit"),
    ]


def test_the_owner_changes_and_removes_a_right(teacher, course, colleagues):
    grant(teacher, course["id"], COLLEAGUE, "view")
    url = f"{access_url(course['id'])}/{colleagues[COLLEAGUE]}"

    changed = teacher.put(url, json={"right": "edit"})
    removed = teacher.delete(url)

    assert entries(changed) == [(COLLEAGUE, "edit")]
    assert removed.status_code == 200
    assert removed.json() == []
    assert teacher.put(url, json={"right": "view"}).status_code == 404
    assert teacher.delete(url).status_code == 404


def test_granting_to_a_teacher_already_listed_changes_their_right(teacher, course):
    grant(teacher, course["id"], COLLEAGUE, "view")

    assert entries(grant(teacher, course["id"], COLLEAGUE, "fork")) == [(COLLEAGUE, "fork")]


def test_only_the_three_rights_exist(teacher, course, colleagues):
    assert grant(teacher, course["id"], COLLEAGUE, "own").status_code == 422
    assert grant(teacher, course["id"], COLLEAGUE, None).status_code == 422
    grant(teacher, course["id"], COLLEAGUE, "view")
    url = f"{access_url(course['id'])}/{colleagues[COLLEAGUE]}"
    assert teacher.put(url, json={"right": "admin"}).status_code == 422


def test_rights_go_only_to_other_teachers(teacher, sender, course):
    as_student(teacher, sender)
    back_to_teacher(teacher)

    unknown = grant(teacher, course["id"], "nobody@skola.example", "view")
    a_student = grant(teacher, course["id"], "jana@skola.example", "view")
    the_owner = grant(teacher, course["id"], TEACHER, "edit")

    assert unknown.status_code == 422
    assert unknown.json() == {"detail": "not_a_teacher"}
    assert a_student.json() == {"detail": "not_a_teacher"}
    assert the_owner.status_code == 409
    assert the_owner.json() == {"detail": "is_owner"}
    assert teacher.get(access_url(course["id"])).json() == []


# What each right allows


def test_a_teacher_without_a_right_cannot_see_the_course_at_all(teacher, course):
    as_teacher(teacher, COLLEAGUE)
    cid = course["id"]

    assert teacher.get("/api/courses").json() == []
    assert teacher.get(f"/api/courses/{cid}").status_code == 404
    assert teacher.get(f"/api/courses/{cid}/topics").status_code == 404
    assert teacher.get(f"/api/courses/{cid}/interview").status_code == 404
    assert teacher.get(access_url(cid)).status_code == 404


@pytest.mark.parametrize("right", ["view", "fork"])
def test_a_viewer_reads_the_course_but_every_change_is_refused(teacher, course, colleagues, right):
    cid = course["id"]
    teacher.post(f"/api/courses/{cid}/topics", json={"name": "Presente"})
    edit_brief(teacher, cid, level="A2")
    grant(teacher, cid, COLLEAGUE, right)
    as_teacher(teacher, COLLEAGUE)

    read = teacher.get(f"/api/courses/{cid}").json()
    topics = teacher.get(f"/api/courses/{cid}/topics").json()

    assert read["brief"]["level"] == "A2"
    assert read["access"] == right
    assert read["can_edit"] is False
    assert read["can_manage_access"] is False
    assert [t["name"] for t in topics] == ["Presente"]
    assert teacher.get(f"/api/courses/{cid}/interview").status_code == 200
    assert teacher.get("/api/courses").json() == [{**COURSE, "id": cid, "access": right}]
    refused = [
        teacher.patch(f"/api/courses/{cid}", json={"name": "Mine"}),
        edit_brief(teacher, cid, level="C2"),
        teacher.post(f"/api/courses/{cid}/topics", json={"name": "Futuro"}),
        teacher.patch(f"/api/courses/{cid}/topics/{topics[0]['id']}", json={"name": "x"}),
        teacher.put(f"/api/courses/{cid}/topics/order", json={"topic_ids": [topics[0]["id"]]}),
        teacher.delete(f"/api/courses/{cid}/topics/{topics[0]['id']}"),
        teacher.post(f"/api/courses/{cid}/interview"),
        teacher.post(f"/api/courses/{cid}/interview/end"),
        teacher.get(access_url(cid)),
        grant(teacher, cid, THIRD, "view"),
        transfer(teacher, cid, THIRD),
    ]
    assert [r.status_code for r in refused] == [403] * len(refused)
    back_to_teacher(teacher)
    kept = teacher.get(f"/api/courses/{cid}").json()
    assert kept["name"] == COURSE["name"]
    assert kept["brief"]["level"] == "A2"


def test_an_editor_changes_the_course_but_not_its_access(teacher, course, colleagues):
    cid = course["id"]
    grant(teacher, cid, COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)

    renamed = teacher.patch(f"/api/courses/{cid}", json={"name": "Španělština 3.B"})
    briefed = edit_brief(teacher, cid, level="B1")
    topic = teacher.post(f"/api/courses/{cid}/topics", json={"name": "Presente"})

    assert renamed.status_code == 200
    assert renamed.json()["access"] == "edit"
    assert renamed.json()["can_edit"] is True
    assert renamed.json()["can_manage_access"] is False
    assert briefed.json()["level"] == "B1"
    assert topic.status_code == 201
    user = f"{access_url(cid)}/{colleagues[COLLEAGUE]}"
    refused = [
        teacher.get(access_url(cid)),
        grant(teacher, cid, THIRD, "edit"),
        teacher.put(user, json={"right": "view"}),
        teacher.delete(user),
        transfer(teacher, cid, COLLEAGUE),
    ]
    assert [r.status_code for r in refused] == [403] * len(refused)


def test_the_owner_sees_the_course_as_owner(teacher, course):
    read = teacher.get(f"/api/courses/{course['id']}").json()

    assert read["access"] == "owner"
    assert read["can_edit"] is True
    assert read["can_manage_access"] is True
    assert teacher.get("/api/courses").json()[0]["access"] == "owner"


def test_removing_a_right_takes_the_course_away(teacher, course, colleagues):
    grant(teacher, course["id"], COLLEAGUE, "edit")
    teacher.delete(f"{access_url(course['id'])}/{colleagues[COLLEAGUE]}")
    as_teacher(teacher, COLLEAGUE)

    assert teacher.get(f"/api/courses/{course['id']}").status_code == 404
    assert teacher.get("/api/courses").json() == []


def test_the_right_is_per_course(teacher, course, colleagues):
    other = create_course(teacher, name="Algebra").json()
    grant(teacher, course["id"], COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)

    assert [c["name"] for c in teacher.get("/api/courses").json()] == [COURSE["name"]]
    assert teacher.get(f"/api/courses/{other['id']}").status_code == 404


def test_the_rights_are_ordered(course, colleagues, admin_settings):
    with open_session(create_engine_for(admin_settings)) as db:
        colleague = get_account(db, colleagues[COLLEAGUE])
        found = get_course(db, course["id"])
        allowed = {}
        for right in ("view", "fork", "edit"):
            access.grant(
                db, found, colleague, right, actor=get_account(db, found.owner_id), now=NOW
            )
            db.flush()
            allowed[right] = (
                can_view_course(colleague, found),
                can_fork_course(colleague, found),
                can_edit_course(colleague, found),
            )
        db.rollback()

    assert allowed == {
        "view": (True, False, False),
        "fork": (True, True, False),
        "edit": (True, True, True),
    }


def test_the_admin_has_no_right_by_being_admin(teacher, course):
    teacher.cookies.clear()
    sign_in(teacher)

    assert teacher.get(f"/api/courses/{course['id']}").status_code == 404
    assert teacher.get(access_url(course["id"])).status_code == 404


def test_students_cannot_reach_the_access_list(teacher, sender, course):
    as_student(teacher, sender)

    assert teacher.get(access_url(course["id"])).status_code == 403
    assert grant(teacher, course["id"], COLLEAGUE, "view").status_code == 403
    assert transfer(teacher, course["id"], COLLEAGUE).status_code == 403


# Ownership transfer


def test_the_owner_transfers_ownership_and_keeps_no_right(teacher, course, colleagues):
    cid = course["id"]
    grant(teacher, cid, COLLEAGUE, "view")
    grant(teacher, cid, THIRD, "edit")

    moved = transfer(teacher, cid, COLLEAGUE)

    assert moved.status_code == 204
    assert teacher.get(f"/api/courses/{cid}").status_code == 404
    assert teacher.get("/api/courses").json() == []
    as_teacher(teacher, COLLEAGUE)
    now = teacher.get(f"/api/courses/{cid}").json()
    assert now["owner_id"] == colleagues[COLLEAGUE]
    assert now["access"] == "owner"
    # The new owner is no longer on the list; everyone else keeps their right.
    assert entries(teacher.get(access_url(cid))) == [(THIRD, "edit")]


def test_the_previous_owner_keeps_a_right_only_when_granted_one(teacher, course, colleagues):
    moved = transfer(teacher, course["id"], COLLEAGUE, previous_owner_keeps="edit")

    assert moved.status_code == 204
    read = teacher.get(f"/api/courses/{course['id']}").json()
    assert read["access"] == "edit"
    assert read["can_manage_access"] is False


def test_ownership_goes_only_to_another_teacher(teacher, sender, course):
    as_student(teacher, sender)
    back_to_teacher(teacher)

    assert transfer(teacher, course["id"], "nobody@skola.example").json() == {
        "detail": "not_a_teacher"
    }
    assert transfer(teacher, course["id"], "jana@skola.example").status_code == 422
    assert transfer(teacher, course["id"], TEACHER).status_code == 409
    assert transfer(teacher, course["id"], COLLEAGUE, previous_owner_keeps="own").status_code == 422
    assert teacher.get(f"/api/courses/{course['id']}").json()["access"] == "owner"


# Audit


def test_access_changes_and_transfers_are_in_the_audit_log(teacher, course, colleagues, clock):
    cid = course["id"]
    grant(teacher, cid, COLLEAGUE, "view")
    grant(teacher, cid, COLLEAGUE, "fork")
    teacher.put(f"{access_url(cid)}/{colleagues[COLLEAGUE]}", json={"right": "edit"})
    teacher.delete(f"{access_url(cid)}/{colleagues[COLLEAGUE]}")
    transfer(teacher, cid, THIRD, previous_owner_keeps="view")
    teacher.cookies.clear()
    sign_in(teacher)

    events = [
        (e["kind"], e["actor_id"], e["subject_id"], e["course_id"], e["detail"])
        for e in teacher.get("/api/admin/audit-events").json()
        if e["kind"].startswith("course_")
    ]

    owner, colleague, third = colleagues[TEACHER], colleagues[COLLEAGUE], colleagues[THIRD]
    assert events == [
        ("course_access_granted", owner, owner, cid, "view"),
        ("course_ownership_transferred", owner, third, cid, None),
        ("course_access_removed", owner, colleague, cid, None),
        ("course_access_changed", owner, colleague, cid, "edit"),
        ("course_access_changed", owner, colleague, cid, "fork"),
        ("course_access_granted", owner, colleague, cid, "view"),
    ]


def test_a_refused_change_leaves_no_audit_event(teacher, course):
    grant(teacher, course["id"], "nobody@skola.example", "view")
    transfer(teacher, course["id"], TEACHER)
    teacher.cookies.clear()
    sign_in(teacher)

    kinds = [e["kind"] for e in teacher.get("/api/admin/audit-events").json()]
    assert not [k for k in kinds if k.startswith("course_")]


# Concurrency


def test_two_grants_to_the_same_teacher_leave_one_entry(
    teacher, course, colleagues, admin_settings
):
    engine = create_engine_for(admin_settings)
    with open_session(engine) as first, open_session(engine) as second:
        one, other = get_course(first, course["id"]), get_course(second, course["id"])
        owner = get_account(first, one.owner_id)
        access.grant(
            first, one, get_account(first, colleagues[COLLEAGUE]), "view", actor=owner, now=NOW
        )
        first.commit()
        with pytest.raises(access.AccessChanged):
            access.grant(
                second,
                other,
                get_account(second, colleagues[COLLEAGUE]),
                "edit",
                actor=owner,
                now=NOW,
            )

    assert entries(teacher.get(access_url(course["id"]))) == [(COLLEAGUE, "view")]


def test_a_grant_to_the_new_owner_made_during_a_transfer_is_refused(
    course, colleagues, admin_settings
):
    engine = create_engine_for(admin_settings)

    # Both requests read the course before either has written.
    with open_session(engine) as first, open_session(engine) as second:
        one, other = get_course(first, course["id"]), get_course(second, course["id"])
        owner = get_account(first, one.owner_id)
        access.transfer(
            first,
            one,
            get_account(first, colleagues[COLLEAGUE]),
            previous_owner_keeps=None,
            actor=owner,
            now=NOW,
        )
        first.commit()
        with pytest.raises(access.AccessChanged):
            access.grant(
                second,
                other,
                get_account(second, colleagues[COLLEAGUE]),
                "view",
                actor=get_account(second, owner.id),
                now=NOW,
            )

    with open_session(engine) as db:
        assert get_course(db, course["id"]).access == []


def test_of_two_concurrent_transfers_the_second_is_refused(course, colleagues, admin_settings):
    engine = create_engine_for(admin_settings)

    with open_session(engine) as first, open_session(engine) as second:
        one, other = get_course(first, course["id"]), get_course(second, course["id"])
        owner = get_account(first, one.owner_id)
        access.transfer(
            first,
            one,
            get_account(first, colleagues[COLLEAGUE]),
            previous_owner_keeps=None,
            actor=owner,
            now=NOW,
        )
        first.commit()
        with pytest.raises(access.AccessChanged):
            access.transfer(
                second,
                other,
                get_account(second, colleagues[THIRD]),
                previous_owner_keeps=None,
                actor=get_account(second, owner.id),
                now=NOW,
            )

    with open_session(engine) as db:
        assert get_course(db, course["id"]).owner_id == colleagues[COLLEAGUE]
