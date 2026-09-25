"""Every assistant request says how long its answer may be, the long generations generously; an
answer the provider cut off at that limit fails as too long, without a retry that would be cut
off the same way (#116)."""

from tests.helpers import CutOff
from tests.test_attempts import course  # noqa: F401 - a fixture
from tests.test_classroom_materials import MATERIAL, generate, topic  # noqa: F401 - a fixture
from tests.test_courses import create_course
from tests.test_interview import ROUND_ONE, job, start
from tests.test_interview import course as interview_course  # noqa: F401 - a fixture
from tests.test_open_assessment import answered, assess_open
from tests.test_reference_documents import documents_url

# ruff: noqa: F811


def test_every_request_has_an_output_budget(teacher, interview_course, models):
    models.script(ROUND_ONE)

    start(teacher, interview_course)

    assert models.requests[0]["settings"]["max_tokens"] == 8_000


def test_classroom_material_gets_a_large_output_budget(teacher, topic, models):
    models.script(MATERIAL)

    generate(teacher, topic)

    assert models.requests[-1]["settings"]["max_tokens"] == 20_000


def test_a_reference_document_gets_a_large_output_budget(teacher, topic, models):
    models.script({"title": "Cheat sheet", "passages": [{"markdown": "Hablar.", "citations": []}]})

    teacher.post(documents_url(*topic), json={"kind": "grammar"})

    assert models.requests[-1]["settings"]["max_tokens"] == 20_000


def test_an_answer_cut_off_at_the_limit_fails_as_too_long_without_a_retry(teacher, topic, models):
    models.script(CutOff({"title": "Proměnné a typový systém v Javě"}))

    started = generate(teacher, topic)

    failed = job(teacher, started.json()["job"]["id"])
    assert (failed["state"], failed["error_kind"]) == ("failed", "too_long")
    assert failed["raw_output"] == '{"title": "Proměnné a typový systém v Javě"}'
    assert len(models.requests) == 1


def test_a_provider_without_a_low_default_keeps_its_own_limit(teacher, models):
    """OpenAI and Gemini answer up to the model's limit, reasoning included; a cap would only
    cut them short."""
    me = teacher.get("/api/auth/me").json()
    url = f"/api/accounts/{me['id']}/provider-credentials/openai"
    assert teacher.put(url, json={"api_key": "sk-proj-openaisecret-55aa"}).status_code == 200
    course_id = create_course(teacher).json()["id"]
    models.script(ROUND_ONE)

    start(teacher, course_id)

    assert "max_tokens" not in models.requests[0]["settings"]


def test_an_open_answer_whose_assessment_is_cut_off_is_flagged_and_the_rest_assessed(
    teacher, course, models
):
    release_id, _ = answered(teacher, course)
    models.script(CutOff({"criteria": []}))

    started_job = assess_open(teacher, course, release_id).json()["job"]

    assert job(teacher, started_job["id"])["result"] == {"assessed": 0, "flagged": 1}
