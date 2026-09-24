"""Outgoing email. All mail goes through one `Sender`: SMTP in production, recording in tests."""

import smtplib
import socket
import ssl
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Literal, Protocol

Security = Literal["starttls", "ssl", "none"]


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    text: str


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    security: Security
    username: str
    password: str | None
    sender: str


class MailError(Exception):
    """Mail could not be sent; the message is plain words a teacher or admin can act on."""


class Sender(Protocol):
    def send(self, message: Message, config: SmtpConfig) -> None:
        """Deliver `message` with `config`, or raise MailError."""


@dataclass(frozen=True)
class SentMail:
    message: Message
    config: SmtpConfig


@dataclass
class RecordingSender:
    """Keeps sent mail for tests to assert on; `fail_with` makes every send fail with that text."""

    sent: list[SentMail] = field(default_factory=list)
    fail_with: str | None = None

    def send(self, message: Message, config: SmtpConfig) -> None:
        if self.fail_with is not None:
            raise MailError(self.fail_with)
        self.sent.append(SentMail(message, config))


@dataclass(frozen=True)
class SmtpSender:
    timeout: float = 20

    def send(self, message: Message, config: SmtpConfig) -> None:
        mail = EmailMessage()
        mail["From"] = config.sender
        mail["To"] = message.to
        mail["Subject"] = message.subject
        mail.set_content(message.text)
        where = f"{config.host}:{config.port}"
        try:
            with self._connect(config) as smtp:
                if config.username:
                    try:
                        smtp.login(config.username, config.password or "")
                    except UnicodeError as error:
                        # smtplib sends credentials as ASCII.
                        raise MailError(
                            "The SMTP username or password contains characters the login cannot "
                            "send, such as letters with accents."
                        ) from error
                smtp.send_message(mail)
        except MailError:
            raise
        except smtplib.SMTPAuthenticationError as error:
            raise MailError("The SMTP server rejected the username or password.") from error
        except smtplib.SMTPNotSupportedError as error:
            if "SMTPUTF8" in str(error):
                raise MailError(
                    f"The SMTP server at {where} cannot send to or from addresses with "
                    "non-ASCII characters."
                ) from error
            if "STARTTLS" in str(error):
                raise MailError(
                    f"The SMTP server at {where} does not support STARTTLS. "
                    "Check the security setting."
                ) from error
            raise MailError(f"The SMTP server at {where} refused: {error}") from error
        except smtplib.SMTPRecipientsRefused as error:
            raise MailError(f"The SMTP server refused the recipient {message.to}.") from error
        except smtplib.SMTPSenderRefused as error:
            raise MailError(f"The SMTP server refused the sender {config.sender}.") from error
        except smtplib.SMTPResponseException as error:
            text = (
                error.smtp_error.decode(errors="replace")
                if isinstance(error.smtp_error, bytes)
                else str(error.smtp_error)
            )
            raise MailError(f"The SMTP server answered {error.smtp_code}: {text}") from error
        except ssl.SSLError as error:
            raise MailError(
                f"A secure connection to {where} failed. Check the port and security setting."
            ) from error
        except TimeoutError as error:
            raise MailError(f"The SMTP server at {where} did not answer in time.") from error
        except socket.gaierror as error:
            raise MailError(f"The SMTP server name {config.host} could not be found.") from error
        except (OSError, smtplib.SMTPException) as error:
            raise MailError(f"Could not connect to {where}.") from error

    def _connect(self, config: SmtpConfig) -> smtplib.SMTP:
        context = ssl.create_default_context()
        if config.security == "ssl":
            return smtplib.SMTP_SSL(config.host, config.port, timeout=self.timeout, context=context)
        smtp = smtplib.SMTP(config.host, config.port, timeout=self.timeout)
        if config.security == "starttls":
            try:
                smtp.starttls(context=context)
            except BaseException:
                smtp.close()
                raise
        return smtp
