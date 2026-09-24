import json

import pytest
from pydantic_ai.exceptions import ModelHTTPError
from sqlalchemy import select

from myteacher import erasure
from myteacher.assistant import prompts
from myteacher.courses.models import ConceptSuccession
from myteacher.persistence import open_session
from tests.helpers import as_student, create_engine_for
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_interview import KEY, add_key, generations, job
from tests.test_topics import add, back_to_teacher

PROPOSAL = {
    "concepts": [
        {
            "key": "ser",
            "name": "ser",
            "description": "Conjugation of ser in the preterite.",
            "prerequisites": [],
        },
        {
            "key": "ir",
            "name": "ir",
            "description": "Conjugation of ir, the same forms as ser.",
            "prerequisites": ["ser"],
        },
        {
            "key": "use",
            "name": "Completed actions",
            "description": "When the preterite describes a finished action.",
            "prerequisites": ["ser", "ir"],
        },
    ]
}


def map_url(course_id: int, topic_id: int) -> str:
    return f"/api/courses/{course_id}/topics/{topic_id}/concept-map"


@pytest.fixture
def topic(teacher) -> tuple[int, int]:
    """A course with the key to pay for proposals and one topic: (course id, topic id)."""
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Pretérito indefinido").json()[0]["id"]
    return cid, tid


def propose(client, topic):
    return client.post(f"{map_url(*topic)}/proposal")


def read(client, topic) -> dict:
    return client.get(map_url(*topic)).json()


def proposed(client, topic, models) -> dict:
    models.script(PROPOSAL)
    assert propose(client, topic).status_code == 202
    return read(client, topic)


def by_name(concept_map) -> dict[str, dict]:
    return {c["name"]: c for c in concept_map["concepts"]}


def concept_url(topic, concept_id) -> str:
    return f"{map_url(*topic)}/concepts/{concept_id}"


def successions(settings) -> list[tuple[int, int, str]]:
    with open_session(create_engine_for(settings)) as db:
        rows = db.scalars(select(ConceptSuccession).order_by(ConceptSuccession.id))
        return [(r.old_concept_id, r.new_concept_id, r.kind) for r in rows]


# Proposal


def test_a_topic_without_a_map_has_none(teacher, topic):
    assert teacher.get(map_url(*topic)).json() is None


def test_requesting_a_map_runs_a_job_with_the_strong_slot_and_records_it(
    teacher, topic, models, admin_settings
):
    models.script(PROPOSAL)

    started = propose(teacher, topic)

    assert started.status_code == 202
    assert started.json()["job"]["kind"] == "concept_map"
    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    assert models.calls[-1] == ("anthropic", "claude-opus-5-5", KEY)
    [record] = generations(admin_settings)
    assert record.task_kind == "concept_map"
    assert record.status == "succeeded"
    assert record.inputs["topic"]["name"] == "Pretérito indefinido"
    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["course"]["taught_language"] == "es"
    assert sent["topics"] == ["Pretérito indefinido"]


def test_the_proposal_becomes_a_draft_map_in_the_proposed_order(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)

    assert concept_map["state"] == "draft"
    assert concept_map["approved_at"] is None
    assert [c["name"] for c in concept_map["concepts"]] == ["ser", "ir", "Completed actions"]
    concepts = by_name(concept_map)
    assert concepts["ser"]["description"] == "Conjugation of ser in the preterite."
    assert concepts["ser"]["prerequisite_ids"] == []
    assert concepts["ir"]["prerequisite_ids"] == [concepts["ser"]["id"]]
    assert sorted(concepts["Completed actions"]["prerequisite_ids"]) == sorted(
        [concepts["ser"]["id"], concepts["ir"]["id"]]
    )


def test_a_proposal_with_unknown_or_circular_prerequisites_is_asked_for_again(
    teacher, topic, models
):
    circular = {
        "concepts": [
            {"key": "a", "name": "a", "description": "A.", "prerequisites": ["b"]},
            {"key": "b", "name": "b", "description": "B.", "prerequisites": ["a"]},
        ]
    }
    unknown = {"concepts": [{"key": "a", "name": "a", "description": "A.", "prerequisites": ["z"]}]}
    models.script(circular, unknown)

    started = propose(teacher, topic)

    assert job(teacher, started.json()["job"]["id"])["error_kind"] == "invalid_output"
    assert read(teacher, topic)["concepts"] == []


def test_a_new_proposal_replaces_the_draft_with_new_identifiers(teacher, topic, models):
    first = proposed(teacher, topic, models)

    second = proposed(teacher, topic, models)

    assert not {c["id"] for c in first["concepts"]} & {c["id"] for c in second["concepts"]}
    assert len(second["concepts"]) == 3


def test_a_failed_proposal_keeps_the_draft_and_says_why(teacher, topic, models):
    first = proposed(teacher, topic, models)
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))

    started = propose(teacher, topic)

    assert job(teacher, started.json()["job"]["id"])["error_kind"] == "quota"
    after = read(teacher, topic)
    assert after["concepts"] == first["concepts"]
    assert after["job"]["state"] == "failed"


def test_proposing_needs_a_provider_key(teacher):
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Presente").json()[0]["id"]

    refused = propose(teacher, (cid, tid))

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_provider_key"}


def test_a_map_that_was_approved_is_changed_by_hand_not_proposed_again(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    teacher.post(f"{map_url(*topic)}/approval", json={"version": concept_map["version"]})
    teacher.post(f"{map_url(*topic)}/reopening")

    refused = propose(teacher, topic)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "approved_before"}


def test_nothing_changes_while_a_proposal_runs(teacher, topic, models, admin_settings):
    from myteacher.jobs.models import Job

    concept_map = proposed(teacher, topic, models)
    with open_session(create_engine_for(admin_settings)) as db:
        db.get_one(Job, concept_map["job"]["id"]).state = "running"
        db.commit()
    ser = by_name(concept_map)["ser"]["id"]

    refused = [
        propose(teacher, topic),
        teacher.patch(concept_url(topic, ser), json={"name": "ser (pretérito)"}),
        teacher.post(f"{map_url(*topic)}/approval", json={"version": concept_map["version"]}),
    ]

    assert [r.status_code for r in refused] == [409] * 3
    assert {r.json()["detail"] for r in refused} == {"proposal_running"}


# Editing


def test_a_concept_keeps_its_identifier_through_renames_and_description_edits(
    teacher, topic, models
):
    concept_map = proposed(teacher, topic, models)
    ser = by_name(concept_map)["ser"]

    renamed = teacher.patch(
        concept_url(topic, ser["id"]),
        json={"name": " ser (pretérito) ", "description": "Fui, fuiste, fue."},
    )

    assert renamed.status_code == 200
    concept = by_name(renamed.json())["ser (pretérito)"]
    assert concept["id"] == ser["id"]
    assert concept["description"] == "Fui, fuiste, fue."
    assert renamed.json()["version"] > concept_map["version"]
    blank = teacher.patch(concept_url(topic, ser["id"]), json={"name": "  "})
    assert blank.status_code == 422


def test_a_concept_is_added_at_the_end(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    ser = by_name(concept_map)["ser"]["id"]

    added = teacher.post(
        f"{map_url(*topic)}/concepts",
        json={"name": "estar", "description": "Estuve, estuviste.", "prerequisite_ids": [ser]},
    )

    assert added.status_code == 201
    assert added.json()["concepts"][-1]["name"] == "estar"
    assert added.json()["concepts"][-1]["prerequisite_ids"] == [ser]


def test_a_teacher_starts_a_map_by_hand(teacher, topic):
    added = teacher.post(
        f"{map_url(*topic)}/concepts",
        json={"name": "ser", "description": "", "prerequisite_ids": []},
    )

    assert added.status_code == 201
    assert added.json()["state"] == "draft"
    assert [c["name"] for c in added.json()["concepts"]] == ["ser"]


def test_prerequisites_are_changed_but_never_circular_or_foreign(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    concepts = by_name(concept_map)
    ser, ir = concepts["ser"]["id"], concepts["ir"]["id"]
    other_topic = add(teacher, topic[0], "Imperfecto").json()[1]["id"]
    foreign = teacher.post(
        f"{map_url(topic[0], other_topic)}/concepts",
        json={"name": "era", "description": "", "prerequisite_ids": []},
    ).json()["concepts"][0]["id"]

    cleared = teacher.patch(concept_url(topic, ir), json={"prerequisite_ids": []})
    circular = teacher.patch(concept_url(topic, ser), json={"prerequisite_ids": [ser]})
    teacher.patch(concept_url(topic, ir), json={"prerequisite_ids": [ser]})
    loop = teacher.patch(concept_url(topic, ser), json={"prerequisite_ids": [ir]})
    elsewhere = teacher.patch(concept_url(topic, ser), json={"prerequisite_ids": [foreign]})

    assert by_name(cleared.json())["ir"]["prerequisite_ids"] == []
    assert circular.status_code == 422
    assert circular.json() == {"detail": "prerequisite_cycle"}
    assert loop.json() == {"detail": "prerequisite_cycle"}
    assert elsewhere.status_code == 422
    assert elsewhere.json() == {"detail": "unknown_prerequisite"}
    assert by_name(read(teacher, topic))["ser"]["prerequisite_ids"] == []


def test_a_removed_concept_leaves_the_map_and_the_prerequisites_of_others(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    concepts = by_name(concept_map)

    removed = teacher.delete(concept_url(topic, concepts["ir"]["id"]))

    assert removed.status_code == 200
    after = by_name(removed.json())
    assert list(after) == ["ser", "Completed actions"]
    assert after["Completed actions"]["prerequisite_ids"] == [concepts["ser"]["id"]]
    assert teacher.delete(concept_url(topic, concepts["ir"]["id"])).status_code == 404


def test_identifiers_are_never_reused(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    last = concept_map["concepts"][-1]["id"]
    teacher.delete(concept_url(topic, last))
    # Removing the topic deletes its concepts, the highest identifiers included.
    teacher.delete(f"/api/courses/{topic[0]}/topics/{topic[1]}")
    tid = add(teacher, topic[0], "Presente").json()[0]["id"]

    added = teacher.post(
        f"{map_url(topic[0], tid)}/concepts",
        json={"name": "ser", "description": "", "prerequisite_ids": []},
    )

    assert added.json()["concepts"][0]["id"] > last


def test_merging_creates_a_new_concept_and_records_where_the_old_ones_went(
    teacher, topic, models, admin_settings
):
    concept_map = proposed(teacher, topic, models)
    concepts = by_name(concept_map)
    ser, ir, use = (concepts[n]["id"] for n in ("ser", "ir", "Completed actions"))

    merged = teacher.post(
        f"{map_url(*topic)}/merges",
        json={"concept_ids": [ser, ir], "name": "ser / ir", "description": "Fui, fuiste, fue."},
    )

    assert merged.status_code == 200
    after = by_name(merged.json())
    assert list(after) == ["ser / ir", "Completed actions"]
    new = after["ser / ir"]["id"]
    assert new not in (ser, ir, use)
    assert after["ser / ir"]["description"] == "Fui, fuiste, fue."
    assert after["ser / ir"]["prerequisite_ids"] == []
    # What required either now requires the merged concept.
    assert after["Completed actions"]["prerequisite_ids"] == [new]
    assert successions(admin_settings) == [(ser, new, "merge"), (ir, new, "merge")]


def test_a_merge_needs_two_concepts_of_the_map(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    ser = by_name(concept_map)["ser"]["id"]
    url = f"{map_url(*topic)}/merges"

    alone = teacher.post(url, json={"concept_ids": [ser], "name": "x", "description": ""})
    twice = teacher.post(url, json={"concept_ids": [ser, ser], "name": "x", "description": ""})
    unknown = teacher.post(url, json={"concept_ids": [ser, 99999], "name": "x", "description": ""})

    assert alone.status_code == 422
    assert twice.status_code == 422
    assert unknown.status_code == 404


def test_a_merge_that_would_make_prerequisites_circular_is_refused(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    concepts = by_name(concept_map)
    ser, use = concepts["ser"]["id"], concepts["Completed actions"]["id"]

    # "Completed actions" requires "ir", which requires "ser": merging the two ends makes the
    # merged concept require "ir", which requires it.
    refused = teacher.post(
        f"{map_url(*topic)}/merges",
        json={"concept_ids": [ser, use], "name": "x", "description": ""},
    )

    assert refused.status_code == 422
    assert refused.json() == {"detail": "prerequisite_cycle"}
    assert len(read(teacher, topic)["concepts"]) == 3


def test_splitting_creates_new_concepts_in_place_and_records_the_mapping(
    teacher, topic, models, admin_settings
):
    concept_map = proposed(teacher, topic, models)
    concepts = by_name(concept_map)
    ser, ir, use = (concepts[n]["id"] for n in ("ser", "ir", "Completed actions"))

    split = teacher.post(
        f"{concept_url(topic, ir)}/split",
        json={
            "parts": [
                {"name": "ir: singular", "description": "Fui, fuiste, fue."},
                {"name": "ir: plural", "description": "Fuimos, fuisteis, fueron."},
            ]
        },
    )

    assert split.status_code == 200
    after = by_name(split.json())
    assert list(after) == ["ser", "ir: singular", "ir: plural", "Completed actions"]
    singular, plural = after["ir: singular"]["id"], after["ir: plural"]["id"]
    # Each part keeps the prerequisites; what required the whole requires every part.
    assert after["ir: singular"]["prerequisite_ids"] == [ser]
    assert after["ir: plural"]["prerequisite_ids"] == [ser]
    assert sorted(after["Completed actions"]["prerequisite_ids"]) == sorted([ser, singular, plural])
    assert successions(admin_settings) == [(ir, singular, "split"), (ir, plural, "split")]
    assert use in [c["id"] for c in split.json()["concepts"]]


def test_a_split_needs_two_named_parts(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    url = f"{concept_url(topic, by_name(concept_map)['ser']['id'])}/split"

    one = teacher.post(url, json={"parts": [{"name": "a", "description": ""}]})
    unnamed = teacher.post(
        url, json={"parts": [{"name": "a", "description": ""}, {"name": " ", "description": ""}]}
    )

    assert one.status_code == 422
    assert unnamed.status_code == 422


# Approval


def test_the_teacher_approves_the_map_they_saw(teacher, topic, models, clock):
    concept_map = proposed(teacher, topic, models)

    approved = teacher.post(f"{map_url(*topic)}/approval", json={"version": concept_map["version"]})

    assert approved.status_code == 200
    assert approved.json()["state"] == "approved"
    assert approved.json()["approved_at"] == "2026-09-24T08:00:00Z"
    assert approved.json()["concepts"] == concept_map["concepts"]


def test_a_map_changed_since_the_teacher_saw_it_is_not_approved(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    teacher.patch(concept_url(topic, concept_map["concepts"][0]["id"]), json={"name": "ser!"})

    refused = teacher.post(f"{map_url(*topic)}/approval", json={"version": concept_map["version"]})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "map_changed"}
    assert read(teacher, topic)["state"] == "draft"


def test_an_empty_map_is_not_approved(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    for concept in concept_map["concepts"]:
        concept_map = teacher.delete(concept_url(topic, concept["id"])).json()

    refused = teacher.post(f"{map_url(*topic)}/approval", json={"version": concept_map["version"]})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "empty_map"}


def test_an_approved_map_is_not_edited_until_reopened(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    ser = concept_map["concepts"][0]["id"]
    approved = teacher.post(f"{map_url(*topic)}/approval", json={"version": concept_map["version"]})

    refused = teacher.patch(concept_url(topic, ser), json={"name": "ser!"})
    reopened = teacher.post(f"{map_url(*topic)}/reopening")
    edited = teacher.patch(concept_url(topic, ser), json={"name": "ser!"})
    again = teacher.post(f"{map_url(*topic)}/approval", json={"version": edited.json()["version"]})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "map_approved"}
    assert reopened.json()["state"] == "draft"
    assert by_name(edited.json())["ser!"]["id"] == ser
    assert again.json()["state"] == "approved"
    assert again.json()["version"] > approved.json()["version"]


def test_only_an_approved_map_is_reopened(teacher, topic, models):
    proposed(teacher, topic, models)

    refused = teacher.post(f"{map_url(*topic)}/reopening")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "not_approved"}


# Access


def test_a_viewer_reads_the_map_but_cannot_change_it(teacher, sender, topic, models):
    concept_map = proposed(teacher, topic, models)
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, topic[0], COLLEAGUE, "view")
    as_teacher(teacher, COLLEAGUE)
    ser = concept_map["concepts"][0]["id"]

    assert read(teacher, topic)["concepts"] == concept_map["concepts"]
    refused = [
        propose(teacher, topic),
        teacher.post(f"{map_url(*topic)}/concepts", json={"name": "x", "description": ""}),
        teacher.patch(concept_url(topic, ser), json={"name": "x"}),
        teacher.delete(concept_url(topic, ser)),
        teacher.post(
            f"{concept_url(topic, ser)}/split",
            json={"parts": [{"name": "a"}, {"name": "b"}]},
        ),
        teacher.post(f"{map_url(*topic)}/approval", json={"version": concept_map["version"]}),
    ]
    assert [r.status_code for r in refused] == [403] * 6


def test_an_editor_changes_and_approves_the_map(teacher, sender, topic, models):
    concept_map = proposed(teacher, topic, models)
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, topic[0], COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)

    edited = teacher.patch(concept_url(topic, concept_map["concepts"][0]["id"]), json={"name": "x"})
    approved = teacher.post(
        f"{map_url(*topic)}/approval", json={"version": edited.json()["version"]}
    )

    assert approved.json()["state"] == "approved"


def test_a_teacher_without_a_right_cannot_see_the_map(teacher, sender, topic, models):
    proposed(teacher, topic, models)
    invite_teachers(teacher, sender, COLLEAGUE)
    as_teacher(teacher, COLLEAGUE)

    assert teacher.get(map_url(*topic)).status_code == 404
    assert propose(teacher, topic).status_code == 404


def test_a_topic_of_another_course_has_no_map_here(teacher, topic, models):
    proposed(teacher, topic, models)
    other = create_course(teacher, name="Algebra").json()["id"]

    assert teacher.get(map_url(other, topic[1])).status_code == 404


def test_a_concept_of_another_topic_is_not_found_here(teacher, topic, models):
    concept_map = proposed(teacher, topic, models)
    other = add(teacher, topic[0], "Imperfecto").json()[1]["id"]

    changed = teacher.patch(
        concept_url((topic[0], other), concept_map["concepts"][0]["id"]), json={"name": "x"}
    )

    assert changed.status_code == 404


def test_students_cannot_reach_concept_maps(teacher, sender, topic):
    as_student(teacher, sender)

    assert teacher.get(map_url(*topic)).status_code == 403
    back_to_teacher(teacher)


def test_concept_maps_hold_no_student_data():
    tables = {rule.table for rule in erasure.rules()}

    assert not {"concept_map", "concept", "concept_prerequisite", "concept_succession"} & tables


def test_the_concept_map_prompt_is_versioned():
    assert prompts.current_version("concept_map") == "v2"
    # The earlier version stays for the generation records that point at it.
    assert prompts.load("concept_map", "v1").version == "v1"


def test_a_topic_removed_while_its_map_is_proposed_ends_the_job_quietly(
    teacher, topic, models, admin_settings
):
    from myteacher.courses.models import Topic

    def remove_topic_meanwhile():
        with open_session(create_engine_for(admin_settings)) as db:
            db.delete(db.get_one(Topic, topic[1]))
            db.commit()
        return PROPOSAL

    models.script(remove_topic_meanwhile)

    started = propose(teacher, topic)

    finished = job(teacher, started.json()["job"]["id"])
    assert finished["state"] == "succeeded"
    assert finished["result"] == {"superseded": True}
