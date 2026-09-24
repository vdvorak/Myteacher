"""Preparing all topics at once, and the assistant's diagnostic offer."""

import json

import pytest
from pydantic_ai.exceptions import ModelHTTPError

from tests.test_concept_maps import PROPOSAL, map_url, read
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_interview import add_key, job
from tests.test_topics import add, topics_url

OFFERED = {
    **PROPOSAL,
    "diagnostic_offer": "Students met ser and ir before; a diagnostic shows who needs them again.",
}


def maps_url(course_id: int) -> str:
    return f"/api/courses/{course_id}/concept-maps"


def prepare(client, course_id):
    return client.post(f"{maps_url(course_id)}/proposals")


def statuses(client, course_id) -> dict[int, dict]:
    return {m["topic_id"]: m for m in client.get(maps_url(course_id)).json()}


def topic_of(client, course_id, topic_id) -> dict:
    return next(t for t in client.get(topics_url(course_id)).json() if t["id"] == topic_id)


def offer_url(course_id, topic_id) -> str:
    return f"{topics_url(course_id)}/{topic_id}/diagnostic-offer"


@pytest.fixture
def course(teacher) -> tuple[int, list[int]]:
    """A course with the key to pay for proposals and three topics: (course id, topic ids)."""
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    for name in ("Presente", "Pretérito indefinido", "Imperfecto"):
        listed = add(teacher, cid, name).json()
    return cid, [t["id"] for t in listed]


def approve(client, course_id, topic_id) -> None:
    concept_map = read(client, (course_id, topic_id))
    approved = client.post(
        f"{map_url(course_id, topic_id)}/approval", json={"version": concept_map["version"]}
    )
    assert approved.status_code == 200


# Preparing all topics


def test_every_topic_starts_without_a_map(teacher, course):
    cid, ids = course

    listed = teacher.get(maps_url(cid)).json()

    assert listed == [{"topic_id": tid, "state": None, "concepts": 0, "job": None} for tid in ids]


def test_preparing_all_topics_starts_one_proposal_job_per_topic(teacher, course, models):
    cid, ids = course
    models.script(PROPOSAL, PROPOSAL, PROPOSAL)

    started = prepare(teacher, cid)

    assert started.status_code == 202
    body = started.json()
    assert [s["topic_id"] for s in body["started"]] == ids
    assert {s["job"]["kind"] for s in body["started"]} == {"concept_map"}
    assert {s["job"]["state"] for s in body["started"]} == {"queued"}
    assert body["skipped"] == []
    for s in body["started"]:
        assert job(teacher, s["job"]["id"])["state"] == "succeeded"
    after = statuses(teacher, cid)
    assert [after[tid]["state"] for tid in ids] == ["draft"] * 3
    assert [after[tid]["concepts"] for tid in ids] == [3] * 3
    assert [after[tid]["job"]["id"] for tid in ids] == [s["job"]["id"] for s in body["started"]]
    # Each proposal is about its own topic.
    sent = [json.loads(r["prompt"])["topic"]["name"] for r in models.requests]
    assert sent == ["Presente", "Pretérito indefinido", "Imperfecto"]


def test_progress_shows_which_proposals_are_still_running(teacher, course, models, monkeypatch):
    from myteacher.jobs import runner

    cid, ids = course
    # The jobs have not run yet.
    monkeypatch.setattr(runner, "run_together", lambda *args, **kwargs: None)

    prepare(teacher, cid)

    after = statuses(teacher, cid)
    assert [after[tid]["job"]["state"] for tid in ids] == ["queued"] * 3
    assert [after[tid]["state"] for tid in ids] == ["draft"] * 3


def test_topics_that_are_prepared_or_being_prepared_are_skipped(
    teacher, course, models, admin_settings
):
    from myteacher.jobs.models import Job
    from myteacher.persistence import open_session
    from tests.helpers import create_engine_for

    cid, (approved, drafted, running) = course
    models.script(PROPOSAL, PROPOSAL, PROPOSAL)
    for tid in (approved, drafted, running):
        teacher.post(f"{map_url(cid, tid)}/proposal")
    approve(teacher, cid, approved)
    with open_session(create_engine_for(admin_settings)) as db:
        db.get_one(Job, read(teacher, (cid, running))["job"]["id"]).state = "running"
        db.commit()
    fresh = add(teacher, cid, "Futuro").json()[-1]["id"]
    models.script(PROPOSAL)

    body = prepare(teacher, cid).json()

    assert [s["topic_id"] for s in body["started"]] == [fresh]
    assert body["skipped"] == [
        {"topic_id": approved, "reason": "approved_before"},
        # A draft with concepts is the teacher's to review; it is not replaced.
        {"topic_id": drafted, "reason": "has_concepts"},
        {"topic_id": running, "reason": "proposal_running"},
    ]


def test_a_reopened_map_is_not_proposed_again(teacher, course, models):
    cid, (first, *_) = course
    models.script(PROPOSAL)
    teacher.post(f"{map_url(cid, first)}/proposal")
    approve(teacher, cid, first)
    teacher.post(f"{map_url(cid, first)}/reopening")
    teacher.delete(
        f"{map_url(cid, first)}/concepts/{read(teacher, (cid, first))['concepts'][0]['id']}"
    )
    models.script(PROPOSAL, PROPOSAL)

    body = prepare(teacher, cid).json()

    assert {"topic_id": first, "reason": "approved_before"} in body["skipped"]


def test_a_failed_proposal_is_prepared_again(teacher, course, models):
    cid, (first, second, third) = course
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}), PROPOSAL, PROPOSAL)
    prepare(teacher, cid)
    assert statuses(teacher, cid)[first]["job"]["error_kind"] == "quota"
    models.script(PROPOSAL)

    body = prepare(teacher, cid).json()

    assert [s["topic_id"] for s in body["started"]] == [first]
    assert statuses(teacher, cid)[first]["concepts"] == 3


def test_preparing_needs_a_key(teacher):
    cid = create_course(teacher).json()["id"]
    add(teacher, cid, "Presente")

    refused = prepare(teacher, cid)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_provider_key"}
    assert statuses(teacher, cid)[teacher.get(topics_url(cid)).json()[0]["id"]]["state"] is None


def test_a_viewer_sees_the_progress_but_cannot_prepare(teacher, sender, course, models):
    cid, ids = course
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, cid, COLLEAGUE, "view")
    as_teacher(teacher, COLLEAGUE)

    assert list(statuses(teacher, cid)) == ids
    assert prepare(teacher, cid).status_code == 403


def test_a_course_the_teacher_cannot_see_is_not_found(teacher, sender, course):
    cid, _ = course
    invite_teachers(teacher, sender, COLLEAGUE)
    as_teacher(teacher, COLLEAGUE)

    assert teacher.get(maps_url(cid)).status_code == 404
    assert prepare(teacher, cid).status_code == 404


# The diagnostic offer


def test_a_topic_has_no_diagnostic_offer_at_first(teacher, course):
    cid, (first, *_) = course

    assert topic_of(teacher, cid, first)["diagnostic_offer"] is None


def test_the_proposal_may_offer_a_diagnostic_without_setting_the_flag(teacher, course, models):
    cid, (first, *_) = course
    models.script(OFFERED)

    teacher.post(f"{map_url(cid, first)}/proposal")

    topic = topic_of(teacher, cid, first)
    assert topic["diagnostic_offer"] == {"reason": OFFERED["diagnostic_offer"], "answer": None}
    assert topic["diagnostic_wanted"] is False


def test_accepting_the_offer_sets_the_flag(teacher, course, models):
    cid, (first, *_) = course
    models.script(OFFERED)
    teacher.post(f"{map_url(cid, first)}/proposal")

    accepted = teacher.post(offer_url(cid, first), json={"accept": True})

    assert accepted.status_code == 200
    topic = next(t for t in accepted.json() if t["id"] == first)
    assert topic["diagnostic_wanted"] is True
    assert topic["diagnostic_offer"]["answer"] == "accepted"


def test_declining_the_offer_leaves_the_flag(teacher, course, models):
    cid, (first, *_) = course
    models.script(OFFERED)
    teacher.post(f"{map_url(cid, first)}/proposal")

    declined = teacher.post(offer_url(cid, first), json={"accept": False})

    assert declined.status_code == 200
    topic = topic_of(teacher, cid, first)
    assert topic["diagnostic_wanted"] is False
    assert topic["diagnostic_offer"]["answer"] == "declined"
    # Answered once; the flag itself stays the teacher's to change.
    assert teacher.post(offer_url(cid, first), json={"accept": True}).json() == {
        "detail": "no_open_offer"
    }


def test_there_is_nothing_to_answer_without_an_offer(teacher, course, models):
    cid, (first, *_) = course
    models.script(PROPOSAL)
    teacher.post(f"{map_url(cid, first)}/proposal")

    refused = teacher.post(offer_url(cid, first), json={"accept": True})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_open_offer"}
    assert topic_of(teacher, cid, first)["diagnostic_wanted"] is False


def test_a_topic_that_already_wants_a_diagnostic_gets_no_offer(teacher, course, models):
    cid, (first, *_) = course
    teacher.patch(f"{topics_url(cid)}/{first}", json={"diagnostic_wanted": True})
    models.script(OFFERED)

    teacher.post(f"{map_url(cid, first)}/proposal")

    assert topic_of(teacher, cid, first)["diagnostic_offer"] is None


def test_a_new_proposal_brings_a_new_offer_or_withdraws_it(teacher, course, models):
    cid, (first, *_) = course
    models.script(OFFERED)
    teacher.post(f"{map_url(cid, first)}/proposal")
    teacher.post(offer_url(cid, first), json={"accept": False})
    models.script(OFFERED)

    teacher.post(f"{map_url(cid, first)}/proposal")
    assert topic_of(teacher, cid, first)["diagnostic_offer"]["answer"] is None

    models.script(PROPOSAL)
    teacher.post(f"{map_url(cid, first)}/proposal")
    assert topic_of(teacher, cid, first)["diagnostic_offer"] is None


def test_a_viewer_sees_the_offer_but_cannot_answer_it(teacher, sender, course, models):
    cid, (first, *_) = course
    models.script(OFFERED)
    teacher.post(f"{map_url(cid, first)}/proposal")
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, cid, COLLEAGUE, "view")
    as_teacher(teacher, COLLEAGUE)

    assert (
        topic_of(teacher, cid, first)["diagnostic_offer"]["reason"] == OFFERED["diagnostic_offer"]
    )
    assert teacher.post(offer_url(cid, first), json={"accept": True}).status_code == 403


def test_the_proposal_prompt_asks_about_a_diagnostic(teacher, course, models):
    from myteacher.assistant import prompts

    assert "diagnostic" in prompts.load("concept_map").text.lower()


def test_the_proposals_of_all_topics_run_side_by_side(teacher, course, models, admin_settings):
    from sqlalchemy import func, select

    from myteacher.jobs.models import Job
    from myteacher.persistence import open_session
    from tests.helpers import create_engine_for

    cid, _ = course
    running = []

    def count_running():
        with open_session(create_engine_for(admin_settings)) as db:
            running.append(db.scalar(select(func.count()).where(Job.state == "running")))
        return PROPOSAL

    models.script(count_running, count_running, count_running)

    prepare(teacher, cid)

    # Every proposal was already running when the first reached the assistant: no topic waits
    # for the others to finish.
    assert running[0] == 3


def test_the_offer_follows_the_flag_changed_by_hand(teacher, course, models):
    cid, (first, *_) = course
    url = f"{topics_url(cid)}/{first}"
    models.script(OFFERED)
    teacher.post(f"{map_url(cid, first)}/proposal")

    # Ticking the flag by hand settles the open offer.
    teacher.patch(url, json={"diagnostic_wanted": True})
    assert topic_of(teacher, cid, first)["diagnostic_offer"]["answer"] == "accepted"
    assert teacher.post(offer_url(cid, first), json={"accept": False}).status_code == 409

    # Unticking it after accepting no longer says accepted.
    teacher.patch(url, json={"diagnostic_wanted": False})
    assert topic_of(teacher, cid, first)["diagnostic_offer"]["answer"] == "declined"
    teacher.patch(url, json={"name": "Presente simple"})
    assert topic_of(teacher, cid, first)["diagnostic_offer"]["answer"] == "declined"
