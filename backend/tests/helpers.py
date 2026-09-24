import re
from datetime import UTC, datetime

from myteacher.persistence import make_engine
from myteacher.settings import Settings

ADMIN_EMAIL = "admin@skola.example"
ADMIN_PASSWORD = "correct horse battery"
INSTANCE_SECRET = "a test instance secret that is long enough"


class FakeClock:
    def __init__(self):
        self.now = datetime(2026, 9, 24, 8, 0, tzinfo=UTC)

    def __call__(self):
        return self.now


def sign_in(client, email=ADMIN_EMAIL, password=ADMIN_PASSWORD):
    return client.post("/api/auth/sign-in", json={"email": email, "password": password})


def create_engine_for(settings: Settings):
    return make_engine(settings.database_url)


SMTP = {
    "host": "smtp.skola.example",
    "port": 587,
    "security": "starttls",
    "username": "myteacher",
    "password": "smtp secret",
    "sender": "myteacher@skola.example",
}


def configure_smtp(client) -> None:
    assert client.put("/api/admin/smtp", json=SMTP).status_code == 200


def link_token(text: str) -> str:
    """The token of the invitation or reset link in an email body."""
    match = re.search(r"https?://\S+#([A-Za-z0-9_-]+)", text)
    assert match, text
    return match.group(1)


class ScriptedModels:
    """A model factory for tests: pydantic-ai's test model, or one failing as `fail_with` says."""

    def __init__(self):
        self.calls: list[tuple[str, str, str]] = []
        self.fail_with: Exception | None = None

    def __call__(self, provider: str, model_name: str, api_key: str):
        from pydantic_ai.models.function import FunctionModel
        from pydantic_ai.models.test import TestModel

        self.calls.append((provider, model_name, api_key))
        if self.fail_with is None:
            return TestModel(custom_output_text="OK")
        error = self.fail_with

        def fail(messages, info):
            raise error

        return FunctionModel(fail)
