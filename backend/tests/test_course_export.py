import io
import json
import zipfile

import pytest

from tests.helpers import as_student, create_student
from tests.test_classroom_materials import MATERIAL, materials_url
from tests.test_concept_maps import map_url
from tests.test_course_access import COLLEAGUE, THIRD, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_interview import add_key
from tests.test_reference_documents import TEXTBOOK, approve_map, cited, documents_url
from tests.test_sources import sources_url, upload
from tests.test_topics import add, topics_url


def export(client, course_id):
    return client.get(f"/api/courses/{course_id}/export")


def unpacked(response) -> tuple[dict, dict[str, bytes]]:
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    return json.loads(files.pop("course.json")), files


@pytest.fixture
def course(teacher, sender, models) -> dict:
    """A course with every kind of content, shared with a colleague: ids by name."""
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    first = add(teacher, cid, "Presente").json()[0]["id"]
    second = add(teacher, cid, "Pretérito indefinido").json()[1]["id"]
    teacher.patch(
        f"{topics_url(cid)}/{second}",
        json={"diagnostic_wanted": True, "additions": {"emphasis": "Only -ar verbs."}},
    )
    textbook = upload(teacher, cid, TEXTBOOK.encode(), name="Učebnice 3.txt").json()["source"]
    approve_map(teacher, cid, second)
    concepts = teacher.get(map_url(cid, second)).json()["concepts"]
    teacher.post(f"{map_url(cid, second)}/reopening")
    teacher.patch(
        f"{map_url(cid, second)}/concepts/{concepts[1]['id']}",
        json={"prerequisite_ids": [concepts[0]["id"]]},
    )
    retired = teacher.post(f"{map_url(cid, second)}/concepts", json={"name": "Gone"}).json()
    teacher.delete(f"{map_url(cid, second)}/concepts/{retired['concepts'][-1]['id']}")
    version = teacher.get(map_url(cid, second)).json()["version"]
    teacher.post(f"{map_url(cid, second)}/approval", json={"version": version})
    models.script(cited(textbook["id"]), MATERIAL)
    teacher.post(documents_url(cid, second), json={"kind": "grammar"})
    student = create_student(teacher).json()["id"]
    teacher.post(materials_url(cid, second), json={"target_student_ids": [student]})
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, cid, COLLEAGUE, "view")
    return {"course": cid, "first": first, "second": second, "textbook": textbook["id"]}


def test_the_archive_is_a_versioned_document_with_the_source_files(teacher, course):
    exported = export(teacher, course["course"])

    assert exported.status_code == 200
    assert exported.headers["content-type"] == "application/zip"
    assert exported.headers["content-disposition"].startswith("attachment; filename=")
    assert ".myteacher.zip" in exported.headers["content-disposition"]
    document, files = unpacked(exported)
    assert document["format"] == "myteacher-course"
    assert document["version"] == 3
    assert document["exported_at"].endswith("Z")
    [source] = document["sources"]
    assert source["name"] == "Učebnice 3.txt"
    assert source["kind"] == "text"
    assert source["text"] == TEXTBOOK
    assert files == {source["file"]: TEXTBOOK.encode()}
    assert source["file"].startswith("sources/")


def test_the_course_brief_and_topics_are_in_the_archive(teacher, course):
    document, _ = unpacked(export(teacher, course["course"]))

    assert document["course"] == {
        "name": "Španělština 2.B",
        "subject": "Spanish",
        "taught_language": "es",
        "instruction_language": "cs",
        "brief_done": False,
        "sources_skipped": False,
    }
    assert document["brief"]["feedback_mode"] == "immediate"
    first, second = document["topics"]
    assert [first["name"], second["name"]] == ["Presente", "Pretérito indefinido"]
    assert second["diagnostic_wanted"] is True
    assert second["additions"]["emphasis"] == "Only -ar verbs."
    assert first["concept_map"] is None


def test_concepts_keep_their_prerequisites_by_key_and_retired_ones_are_left_out(teacher, course):
    document, _ = unpacked(export(teacher, course["course"]))

    concept_map = document["topics"][1]["concept_map"]
    assert concept_map["state"] == "approved"
    hablar, actions = concept_map["concepts"]
    assert [hablar["name"], actions["name"]] == ["hablar", "Completed actions"]
    assert hablar["prerequisites"] == []
    assert actions["prerequisites"] == [hablar["key"]]
    assert "id" not in hablar


def test_reference_documents_cite_sources_by_key(teacher, course):
    document, _ = unpacked(export(teacher, course["course"]))

    [reference] = document["topics"][1]["reference_documents"]
    assert reference["kind"] == "grammar"
    [version] = reference["versions"]
    assert version["number"] == 1
    assert version["title"] == "Pretérito indefinido: cheat sheet"
    source_key = document["sources"][0]["key"]
    assert version["passages"][0]["citations"] == [{"source": source_key, "location": "Unidad 3"}]
    assert version["passages"][1]["citations"] == []


def test_a_citation_of_a_removed_source_keeps_its_location_without_a_source(teacher, course):
    teacher.delete(f"{sources_url(course['course'])}/{course['textbook']}")

    document, files = unpacked(export(teacher, course["course"]))

    assert document["sources"] == []
    assert files == {}
    citation = document["topics"][1]["reference_documents"][0]["versions"][0]["passages"][0]
    assert citation["citations"] == [{"source": None, "location": "Unidad 3"}]


def test_classroom_material_keeps_its_versions_with_answers_but_not_its_students(teacher, course):
    document, files = unpacked(export(teacher, course["course"]))

    [material] = document["topics"][1]["classroom_materials"]
    [version] = material["versions"]
    assert version["lesson"]["title"] == MATERIAL["title"]
    assert version["lesson"]["blocks"][1]["correct_option_id"] == "a"
    assert version["instruction"] is None
    assert version["previous"] is None
    # Students are not part of a course (ADR 0008): the chosen targets stay behind.
    assert "target" not in json.dumps(document)
    assert "Veselá" not in json.dumps(document, ensure_ascii=False)
    assert all("Veselá" not in name for name in files)


def test_the_access_list_and_the_owner_are_not_in_the_archive(teacher, course):
    document, _ = unpacked(export(teacher, course["course"]))

    assert COLLEAGUE not in json.dumps(document)
    assert "owner" not in json.dumps(document)
    assert "access" not in document


def test_a_viewer_exports_and_others_cannot(teacher, sender, course):
    as_teacher(teacher, COLLEAGUE)
    assert export(teacher, course["course"]).status_code == 200

    invite_teachers(teacher, sender, THIRD)
    as_teacher(teacher, THIRD)
    assert export(teacher, course["course"]).status_code == 404

    as_student(teacher, sender, "petr@skola.example")
    assert export(teacher, course["course"]).status_code == 403


def test_a_page_source_is_in_the_archive_without_a_file(teacher, web):
    cid = create_course(teacher).json()["id"]
    web.page("https://example.org/preterito", "<title>Pretérito</title><p>Ayer hablé.</p>")
    teacher.post(f"{sources_url(cid)}/url", json={"url": "https://example.org/preterito"})

    document, files = unpacked(export(teacher, cid))

    [source] = document["sources"]
    assert source["kind"] == "url"
    assert source["url"] == "https://example.org/preterito"
    assert source["file"] is None
    assert files == {}


def test_the_document_reads_back_as_the_archive_format(teacher, course):
    from myteacher.courses.archive import Archive

    document, _ = unpacked(export(teacher, course["course"]))

    archive = Archive.model_validate(document)
    assert archive.version == 3
    with pytest.raises(ValueError):
        Archive.model_validate({**document, "version": 4})


def test_an_archive_of_the_first_version_still_reads(teacher, course):
    from myteacher.courses.archive import Archive

    document, _ = unpacked(export(teacher, course["course"]))
    first = {
        **document,
        "version": 1,
        "course": {
            k: v
            for k, v in document["course"].items()
            if k not in ("brief_done", "sources_skipped")
        },
    }

    archive = Archive.model_validate(first)
    assert (archive.course.brief_done, archive.course.sources_skipped) == (False, False)


def test_material_lessons_are_named_by_archive_keys_not_database_ids(teacher, course):
    document, _ = unpacked(export(teacher, course["course"]))

    lesson = document["topics"][1]["classroom_materials"][0]["versions"][0]["lesson"]
    assert lesson["id"] == "topic-2-material-1-v1"


def test_a_course_name_with_a_slash_makes_a_valid_file_name(teacher):
    cid = create_course(teacher, name="Matematika 7/8").json()["id"]

    disposition = export(teacher, cid).headers["content-disposition"]

    assert "filename*=UTF-8''Matematika%207%2F8.myteacher.zip" in disposition
