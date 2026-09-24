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
