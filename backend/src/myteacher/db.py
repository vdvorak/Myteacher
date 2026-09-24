from importlib import resources
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url


def migrate(database_url: str) -> None:
    """Bring the database to the latest schema, creating the file if it does not exist."""
    url = make_url(database_url)
    if url.get_backend_name() == "sqlite" and url.database:
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    config = Config()
    config.set_main_option("script_location", str(resources.files("myteacher") / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "head")
