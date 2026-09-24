import re
from datetime import UTC, datetime

from myteacher.persistence import make_engine
from myteacher.settings import Settings

ADMIN_EMAIL = "admin@skola.example"
ADMIN_PASSWORD = "correct horse battery"


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
