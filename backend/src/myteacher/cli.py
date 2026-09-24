"""One-off administrative commands, such as `myteacher create-admin --email admin@example.org`.

The password comes from MYTEACHER_ADMIN_PASSWORD or is asked for twice.
"""

import argparse
import getpass
import os
import sys

from myteacher.accounts import service
from myteacher.db import migrate
from myteacher.persistence import make_engine, open_session, utc_now
from myteacher.secret_box import SecretBox
from myteacher.settings import Settings


def _password() -> str:
    if password := os.environ.get("MYTEACHER_ADMIN_PASSWORD"):
        return password
    password = getpass.getpass("Password: ")
    if getpass.getpass("Repeat the password: ") != password:
        raise SystemExit("The passwords differ.")
    return password


def create_admin(email: str) -> int:
    settings = Settings.from_env()
    migrate(settings.database_url, SecretBox(settings.instance_secret))
    engine = make_engine(settings.database_url)
    try:
        with open_session(engine) as db:
            try:
                admin = service.ensure_admin(db, email=email, password=_password(), now=utc_now())
            except ValueError as error:
                print(error, file=sys.stderr)
                return 1
            db.commit()
    finally:
        engine.dispose()
    if admin is None:
        print("The instance already has an admin; nothing was created.")
    else:
        print(f"Admin {admin.email} created.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="myteacher")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-admin", help="create the first admin of the instance")
    create.add_argument("--email", required=True)
    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return create_admin(args.email)
    return 2


if __name__ == "__main__":
    sys.exit(main())
