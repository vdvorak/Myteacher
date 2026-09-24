import os
from datetime import timedelta
from pathlib import Path

from pydantic import BaseModel


class Settings(BaseModel):
    database_url: str
    static_dir: Path | None
    # The first admin, created on start when both are set and the instance has no admin yet.
    admin_email: str | None = None
    admin_password: str | None = None
    session_lifetime: timedelta = timedelta(days=7)
    # Off only for plain-HTTP development and tests; browsers treat localhost as secure anyway.
    secure_cookies: bool = True

    @classmethod
    def from_env(cls) -> "Settings":
        static_dir = os.environ.get("MYTEACHER_STATIC_DIR")
        return cls(
            database_url=os.environ.get("MYTEACHER_DATABASE_URL", "sqlite:///./data/myteacher.db"),
            static_dir=Path(static_dir) if static_dir else None,
            admin_email=os.environ.get("MYTEACHER_ADMIN_EMAIL") or None,
            admin_password=os.environ.get("MYTEACHER_ADMIN_PASSWORD") or None,
            session_lifetime=timedelta(hours=float(os.environ.get("MYTEACHER_SESSION_HOURS", 168))),
            secure_cookies=os.environ.get("MYTEACHER_SECURE_COOKIES", "true").lower() != "false",
        )
