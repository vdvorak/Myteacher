import os
from datetime import timedelta
from pathlib import Path

from pydantic import BaseModel, field_validator

MIN_SECRET_LENGTH = 32


class Settings(BaseModel):
    database_url: str
    static_dir: Path | None
    # Encrypts provider keys and the SMTP password at rest; changing it makes them unreadable.
    instance_secret: str
    # The first admin, created on start when both are set and the instance has no admin yet.
    admin_email: str | None = None
    admin_password: str | None = None
    session_lifetime: timedelta = timedelta(days=7)
    invitation_lifetime: timedelta = timedelta(days=7)
    reset_lifetime: timedelta = timedelta(hours=1)
    # The address people open the app at, for links in emails; the request's own when unset.
    public_url: str | None = None
    # Off only for plain-HTTP development and tests; browsers treat localhost as secure anyway.
    secure_cookies: bool = True

    @field_validator("instance_secret")
    @classmethod
    def _long_enough(cls, secret: str) -> str:
        if len(secret) < MIN_SECRET_LENGTH:
            raise ValueError(f"the instance secret needs at least {MIN_SECRET_LENGTH} characters")
        return secret

    @classmethod
    def from_env(cls) -> "Settings":
        static_dir = os.environ.get("MYTEACHER_STATIC_DIR")
        secret = os.environ.get("MYTEACHER_INSTANCE_SECRET")
        if not secret:
            raise ValueError(
                "set MYTEACHER_INSTANCE_SECRET to a random value of at least "
                f"{MIN_SECRET_LENGTH} characters; it encrypts provider keys at rest"
            )
        return cls(
            instance_secret=secret,
            database_url=os.environ.get("MYTEACHER_DATABASE_URL", "sqlite:///./data/myteacher.db"),
            static_dir=Path(static_dir) if static_dir else None,
            admin_email=os.environ.get("MYTEACHER_ADMIN_EMAIL") or None,
            admin_password=os.environ.get("MYTEACHER_ADMIN_PASSWORD") or None,
            session_lifetime=timedelta(hours=float(os.environ.get("MYTEACHER_SESSION_HOURS", 168))),
            public_url=os.environ.get("MYTEACHER_PUBLIC_URL") or None,
            secure_cookies=os.environ.get("MYTEACHER_SECURE_COOKIES", "true").lower() != "false",
        )
