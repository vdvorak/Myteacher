import os
from pathlib import Path

from pydantic import BaseModel


class Settings(BaseModel):
    database_url: str
    static_dir: Path | None

    @classmethod
    def from_env(cls) -> "Settings":
        static_dir = os.environ.get("MYTEACHER_STATIC_DIR")
        return cls(
            database_url=os.environ.get("MYTEACHER_DATABASE_URL", "sqlite:///./data/myteacher.db"),
            static_dir=Path(static_dir) if static_dir else None,
        )
