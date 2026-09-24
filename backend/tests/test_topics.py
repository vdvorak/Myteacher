from tests.helpers import as_student
from tests.test_courses import as_other_teacher, create_course


def topics_url(course_id: int) -> str:
    return f"/api/courses/{course_id}/topics"


def add(client, course_id, name):
    return client.post(topics_url(course_id), json={"name": name})


def names(response) -> list[str]:
    return [topic["name"] for topic in response.json()]


def course_with_topics(client, *topic_names) -> tuple[int, list[dict]]:
    cid = create_course(client).json()["id"]
    for name in topic_names:
        add(client, cid, name)
    return cid, client.get(topics_url(cid)).json()


def test_a_new_course_has_no_topics(teacher):
    cid = create_course(teacher).json()["id"]

    assert teacher.get(topics_url(cid)).json() == []


def test_topics_are_added_at_the_end_in_order(teacher):
    cid = create_course(teacher).json()["id"]

    add(teacher, cid, "Presente")
    added = add(teacher, cid, "  Pretérito indefinido  ")

    assert added.status_code == 201
    topics = added.json()
    assert topics == [
        {"id": topics[0]["id"], "name": "Presente", "position": 0, "diagnostic_wanted": False},
        {
            "id": topics[1]["id"],
            "name": "Pretérito indefinido",
            "position": 1,
            "diagnostic_wanted": False,
        },
    ]
    assert teacher.get(topics_url(cid)).json() == topics


def test_a_topic_name_is_required_and_limited(teacher):
    cid = create_course(teacher).json()["id"]

    assert add(teacher, cid, "   ").status_code == 422
    assert add(teacher, cid, "x" * 201).status_code == 422
    assert teacher.post(topics_url(cid), json={"name": "x", "position": 3}).status_code == 422


def test_a_topic_is_renamed_and_keeps_its_place(teacher):
    cid, (first, second) = course_with_topics(teacher, "Presente", "Pretérito")

    renamed = teacher.patch(f"{topics_url(cid)}/{first['id']}", json={"name": "El presente"})

    assert renamed.status_code == 200
    assert names(renamed) == ["El presente", "Pretérito"]
    assert teacher.patch(f"{topics_url(cid)}/{first['id']}", json={"name": ""}).status_code == 422
    assert teacher.patch(f"{topics_url(cid)}/{first['id']}", json={"name": None}).status_code == 422


def test_the_diagnostic_wanted_flag_is_set_per_topic(teacher):
    cid, (first, second) = course_with_topics(teacher, "Presente", "Pretérito")

    changed = teacher.patch(f"{topics_url(cid)}/{second['id']}", json={"diagnostic_wanted": True})

    assert [t["diagnostic_wanted"] for t in changed.json()] == [False, True]
    again = teacher.patch(f"{topics_url(cid)}/{second['id']}", json={"diagnostic_wanted": False})
    assert again.json()[1]["diagnostic_wanted"] is False
    refused = teacher.patch(f"{topics_url(cid)}/{second['id']}", json={"diagnostic_wanted": None})
    assert refused.status_code == 422


def test_topics_are_reordered(teacher):
    cid, (a, b, c) = course_with_topics(teacher, "A", "B", "C")

    reordered = teacher.put(
        f"{topics_url(cid)}/order", json={"topic_ids": [c["id"], a["id"], b["id"]]}
    )

    assert reordered.status_code == 200
    assert names(reordered) == ["C", "A", "B"]
    assert [t["position"] for t in reordered.json()] == [0, 1, 2]
    assert names(teacher.get(topics_url(cid))) == ["C", "A", "B"]


def test_an_order_must_name_every_topic_exactly_once(teacher):
    cid, (a, b, c) = course_with_topics(teacher, "A", "B", "C")
    other, (foreign,) = course_with_topics(teacher, "X")

    for ids in (
        [a["id"], b["id"]],
        [a["id"], b["id"], c["id"], c["id"]],
        [a["id"], b["id"], foreign["id"]],
        [],
    ):
        refused = teacher.put(f"{topics_url(cid)}/order", json={"topic_ids": ids})
        assert refused.status_code == 409, ids
        assert refused.json() == {"detail": "order_mismatch"}
    assert names(teacher.get(topics_url(cid))) == ["A", "B", "C"]


def test_a_removed_topic_closes_the_gap(teacher):
    cid, (a, b, c) = course_with_topics(teacher, "A", "B", "C")

    removed = teacher.delete(f"{topics_url(cid)}/{b['id']}")

    assert removed.status_code == 200
    assert [(t["name"], t["position"]) for t in removed.json()] == [("A", 0), ("C", 1)]
    assert names(add(teacher, cid, "D")) == ["A", "C", "D"]


def test_a_topic_of_another_course_is_not_found_here(teacher):
    cid, (a,) = course_with_topics(teacher, "A")
    other, (foreign,) = course_with_topics(teacher, "X")
    url = f"{topics_url(cid)}/{foreign['id']}"

    assert teacher.patch(url, json={"name": "Stolen"}).status_code == 404
    assert teacher.delete(url).status_code == 404
    assert teacher.patch(f"{topics_url(cid)}/999", json={"name": "x"}).status_code == 404
    assert names(teacher.get(topics_url(other))) == ["X"]


# Access


def test_another_teacher_cannot_see_or_change_the_topics(teacher, sender):
    cid, (a,) = course_with_topics(teacher, "A")
    as_other_teacher(teacher, sender)

    assert teacher.get(topics_url(cid)).status_code == 404
    assert add(teacher, cid, "Mine").status_code == 404
    assert teacher.patch(f"{topics_url(cid)}/{a['id']}", json={"name": "x"}).status_code == 404
    assert teacher.delete(f"{topics_url(cid)}/{a['id']}").status_code == 404
    assert teacher.put(f"{topics_url(cid)}/order", json={"topic_ids": [a["id"]]}).status_code == 404


def test_a_viewer_reads_the_topics_but_cannot_change_them(teacher, sender, monkeypatch):
    from myteacher.api import courses as courses_api

    cid, (a,) = course_with_topics(teacher, "A")
    as_other_teacher(teacher, sender)
    # Until the course access list exists, grant view right to every teacher.
    monkeypatch.setattr(courses_api, "can_view_course", lambda actor, course: True)

    assert names(teacher.get(topics_url(cid))) == ["A"]
    assert teacher.get(f"/api/courses/{cid}").json()["can_edit"] is False
    for refused in (
        add(teacher, cid, "Mine"),
        teacher.patch(f"{topics_url(cid)}/{a['id']}", json={"name": "x"}),
        teacher.delete(f"{topics_url(cid)}/{a['id']}"),
        teacher.put(f"{topics_url(cid)}/order", json={"topic_ids": [a["id"]]}),
    ):
        assert refused.status_code == 403
    assert names(teacher.get(topics_url(cid))) == ["A"]


def test_the_owner_can_edit(teacher):
    cid = create_course(teacher).json()["id"]

    assert teacher.get(f"/api/courses/{cid}").json()["can_edit"] is True


def test_students_cannot_reach_topics(teacher, sender):
    cid, (a,) = course_with_topics(teacher, "A")
    as_student(teacher, sender)

    assert teacher.get(topics_url(cid)).status_code == 403
    assert add(teacher, cid, "x").status_code == 403
