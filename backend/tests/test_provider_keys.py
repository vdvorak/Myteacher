import sqlite3

import pytest
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError

from myteacher.assistant.providers import PROVIDERS
from tests.helpers import sign_in

KEY = "sk-ant-api03-verysecretkey-7f3a"
OTHER_KEY = "sk-ant-api03-anothersecretkey-91bc"


@pytest.fixture
def teacher(app_client):
    return sign_in(app_client).json()


def url(teacher, provider="anthropic", action=""):
    return f"/api/accounts/{teacher['id']}/provider-credentials/{provider}{action}"


def add(client, teacher, api_key=KEY, provider="anthropic", **slots):
    return client.put(url(teacher, provider), json={"api_key": api_key, **slots})


def stored(client, teacher) -> dict[str, dict]:
    listed = client.get(f"/api/accounts/{teacher['id']}/provider-credentials").json()
    return {credential["provider"]: credential for credential in listed}


# The provider table


def test_the_supported_providers_come_with_default_model_slots(app_client, teacher):
    catalog = app_client.get("/api/providers").json()

    assert [p["id"] for p in catalog] == list(PROVIDERS)
    anthropic = next(p for p in catalog if p["id"] == "anthropic")
    assert anthropic["strong_model"] == PROVIDERS["anthropic"].strong_model
    assert anthropic["fast_model"] == PROVIDERS["anthropic"].fast_model


def test_the_default_slots_are_used_until_the_teacher_edits_them(app_client, teacher):
    add(app_client, teacher)

    credential = stored(app_client, teacher)["anthropic"]

    assert credential["strong_model"] == PROVIDERS["anthropic"].strong_model
    assert credential["fast_model"] == PROVIDERS["anthropic"].fast_model


def test_model_slots_are_editable_without_resending_the_key(app_client, teacher, models):
    add(app_client, teacher)

    response = app_client.put(
        url(teacher), json={"strong_model": "claude-sonnet-5", "fast_model": "claude-haiku-4-5"}
    )
    app_client.post(url(teacher, action="/test"))

    assert response.status_code == 200
    assert response.json()["strong_model"] == "claude-sonnet-5"
    assert models.calls[-1] == ("anthropic", "claude-haiku-4-5", KEY)


def test_an_unsupported_provider_is_refused(app_client, teacher):
    assert add(app_client, teacher, provider="acme").status_code == 404


def test_a_first_save_needs_a_key(app_client, teacher):
    response = app_client.put(url(teacher), json={"strong_model": "claude-sonnet-5"})

    assert response.status_code == 422


@pytest.mark.parametrize("change", [{"api_key": "short"}, {"api_key": " "}, {"strong_model": ""}])
def test_invalid_values_are_refused(app_client, teacher, change):
    assert app_client.put(url(teacher), json={"api_key": KEY, **change}).status_code == 422


# Only the masked tail ever leaves the server


def test_only_the_masked_tail_of_the_key_is_ever_returned(app_client, teacher):
    responses = [
        add(app_client, teacher),
        app_client.get(f"/api/accounts/{teacher['id']}/provider-credentials"),
        app_client.put(url(teacher), json={"strong_model": "claude-sonnet-5"}),
        app_client.post(url(teacher, action="/test")),
        app_client.get("/api/auth/me"),
    ]

    for response in responses:
        assert KEY not in response.text
        assert KEY[:-4] not in response.text
    assert stored(app_client, teacher)["anthropic"]["masked_key"] == "…7f3a"


def test_the_key_is_encrypted_at_rest(app_client, teacher, settings):
    add(app_client, teacher)

    dump = "\n".join(sqlite3.connect(settings.database_url.removeprefix("sqlite:///")).iterdump())

    assert KEY not in dump
    assert "verysecretkey" not in dump


def test_the_key_can_be_replaced(app_client, teacher, models):
    add(app_client, teacher)

    add(app_client, teacher, api_key=OTHER_KEY)
    app_client.post(url(teacher, action="/test"))

    assert stored(app_client, teacher)["anthropic"]["masked_key"] == "…91bc"
    assert models.calls[-1][2] == OTHER_KEY


def test_the_key_can_be_removed(app_client, teacher):
    add(app_client, teacher)

    assert app_client.delete(url(teacher)).status_code == 204

    assert stored(app_client, teacher) == {}
    assert app_client.post(url(teacher, action="/test")).status_code == 404


def test_keys_for_several_providers_are_kept_apart(app_client, teacher):
    add(app_client, teacher)
    add(app_client, teacher, api_key="sk-proj-openaisecret-55aa", provider="openai")

    listed = stored(app_client, teacher)

    assert listed["anthropic"]["masked_key"] == "…7f3a"
    assert listed["openai"]["masked_key"] == "…55aa"
    assert listed["openai"]["fast_model"] == PROVIDERS["openai"].fast_model


# Testing a key


def test_a_working_key_passes_the_test_through_the_fast_slot(app_client, teacher, models):
    add(app_client, teacher)

    response = app_client.post(url(teacher, action="/test"))

    assert response.json() == {"ok": True, "error_kind": None}
    assert models.calls[-1] == ("anthropic", PROVIDERS["anthropic"].fast_model, KEY)


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (ModelHTTPError(401, "claude-haiku-4-5", {"error": "invalid x-api-key"}), "authentication"),
        (ModelHTTPError(403, "claude-haiku-4-5"), "authentication"),
        (
            ModelHTTPError(
                400,
                "gemini-3.5-flash",
                {
                    "error": {
                        "status": "INVALID_ARGUMENT",
                        "details": [{"reason": "API_KEY_INVALID"}],
                    }
                },
            ),
            "authentication",
        ),
        (ModelHTTPError(429, "claude-haiku-4-5", {"error": "rate_limit"}), "quota"),
        (
            ModelHTTPError(
                400,
                "claude-haiku-4-5",
                {"error": {"message": "Your credit balance is too low to access the API."}},
            ),
            "quota",
        ),
        (ModelHTTPError(402, "claude-haiku-4-5"), "quota"),
        (ModelHTTPError(404, "claude-haiku-4-5", {"error": "model not found"}), "other"),
        (ModelHTTPError(503, "claude-haiku-4-5", {"error": "unavailable"}), "transient"),
        (ModelAPIError("claude-haiku-4-5", "connection refused"), "transient"),
    ],
)
def test_a_failing_key_reports_the_kind_of_error(app_client, teacher, models, error, kind):
    add(app_client, teacher)
    models.fail_with = error

    response = app_client.post(url(teacher, action="/test"))

    assert response.status_code == 200
    assert response.json() == {"ok": False, "error_kind": kind}


# Access


def test_only_the_teacher_themselves_can_see_or_change_their_keys(
    app_client, teacher, admin_settings
):
    from myteacher.accounts import service
    from myteacher.persistence import open_session, utc_now
    from tests.helpers import create_engine_for

    add(app_client, teacher)
    with open_session(create_engine_for(admin_settings)) as db:
        service.create_account(
            db,
            email="novak@skola.example",
            password="a teacher password",
            kind="teacher",
            now=utc_now(),
        )
        db.commit()
    app_client.cookies.clear()
    sign_in(app_client, "novak@skola.example", "a teacher password")

    assert app_client.get(f"/api/accounts/{teacher['id']}/provider-credentials").status_code == 403
    assert add(app_client, teacher).status_code == 403
    assert app_client.delete(url(teacher)).status_code == 403
    assert app_client.post(url(teacher, action="/test")).status_code == 403


def test_keys_need_a_signed_in_account(app_client):
    assert app_client.get("/api/providers").status_code == 401
    assert app_client.get("/api/accounts/1/provider-credentials").status_code == 401


# Audit log


def test_key_added_replaced_and_removed_are_in_the_audit_log(app_client, teacher):
    add(app_client, teacher)
    app_client.put(url(teacher), json={"strong_model": "claude-sonnet-5"})
    add(app_client, teacher, api_key=OTHER_KEY)
    app_client.delete(url(teacher))

    kinds = [e["kind"] for e in app_client.get("/api/admin/audit-events").json()]

    assert kinds[:3] == ["provider_key_removed", "provider_key_replaced", "provider_key_added"]
