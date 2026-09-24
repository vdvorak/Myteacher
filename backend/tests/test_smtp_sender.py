"""The SMTP implementation against a local SMTP server."""

import socket
from email import message_from_bytes, policy

import pytest
from aiosmtpd.controller import Controller
from aiosmtpd.smtp import AuthResult

from myteacher.mail import MailError, Message, SmtpConfig, SmtpSender


class Inbox:
    def __init__(self):
        self.envelopes = []

    async def handle_DATA(self, server, session, envelope):
        self.envelopes.append(envelope)
        return "250 OK"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def smtp_server():
    inbox = Inbox()

    def authenticator(server, session, envelope, mechanism, auth_data):
        ok = auth_data.login == b"myteacher" and auth_data.password == b"smtp secret"
        return AuthResult(success=ok, handled=False)

    controller = Controller(
        inbox,
        hostname="127.0.0.1",
        port=free_port(),
        authenticator=authenticator,
        auth_require_tls=False,
    )
    controller.start()
    yield controller, inbox
    controller.stop()


def config(port: int, **changes) -> SmtpConfig:
    fields = {
        "host": "127.0.0.1",
        "port": port,
        "security": "none",
        "username": "myteacher",
        "password": "smtp secret",
        "sender": "myteacher@skola.example",
    }
    return SmtpConfig(**{**fields, **changes})


MESSAGE = Message(
    to="teacher@skola.example", subject="Zkušební e-mail", text="Dobrý den, funguje to."
)


def test_mail_is_delivered_with_sender_recipient_and_text(smtp_server):
    controller, inbox = smtp_server

    SmtpSender(timeout=5).send(MESSAGE, config(controller.port))

    [envelope] = inbox.envelopes
    assert envelope.mail_from == "myteacher@skola.example"
    assert envelope.rcpt_tos == ["teacher@skola.example"]
    mail = message_from_bytes(envelope.content, policy=policy.default)
    assert mail["Subject"] == "Zkušební e-mail"
    assert mail["From"] == "myteacher@skola.example"
    assert mail.get_content().strip() == "Dobrý den, funguje to."


def test_wrong_credentials_are_reported_in_plain_words(smtp_server):
    controller, _ = smtp_server

    with pytest.raises(MailError, match="rejected the username or password"):
        SmtpSender(timeout=5).send(MESSAGE, config(controller.port, password="wrong"))


def test_an_unreachable_server_is_reported_in_plain_words():
    with pytest.raises(MailError, match="Could not connect to 127.0.0.1"):
        SmtpSender(timeout=5).send(MESSAGE, config(free_port()))


def test_a_password_the_server_cannot_accept_is_reported_in_plain_words(smtp_server):
    controller, _ = smtp_server

    with pytest.raises(MailError, match="characters"):
        SmtpSender(timeout=5).send(MESSAGE, config(controller.port, password="heslo123č"))


def test_an_address_the_server_cannot_handle_is_reported_as_such():
    controller = Controller(Inbox(), hostname="127.0.0.1", port=free_port(), enable_SMTPUTF8=False)
    controller.start()
    message = Message(to="učitel@škola.example", subject="Test", text="Test")

    try:
        with pytest.raises(MailError, match="non-ASCII"):
            SmtpSender(timeout=5).send(message, config(controller.port, username=""))
    finally:
        controller.stop()
