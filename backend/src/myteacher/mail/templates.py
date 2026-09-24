"""Email templates in every interface language, chosen by the recipient's language.

Each template is a subject and a plain-text body per language, with `{name}` placeholders.
Later tickets add invitation and password reset templates here.
"""

from typing import Literal

from myteacher.mail import Message

Language = Literal["cs", "en"]

TEMPLATES: dict[str, dict[Language, tuple[str, str]]] = {
    "teacher_invitation": {
        "cs": (
            "Myteacher: pozvánka pro učitele",
            "Dobrý den,\n\n"
            "byl vám založen učitelský účet v Myteacher. Heslo si nastavíte na tomto odkazu:\n\n"
            "{link}\n\n"
            "Odkaz platí {days} dní a lze ho použít jen jednou.\n",
        ),
        "en": (
            "Myteacher: your teacher invitation",
            "Hello,\n\n"
            "a teacher account has been created for you in Myteacher. Set your password here:\n\n"
            "{link}\n\n"
            "The link works for {days} days and only once.\n",
        ),
    },
    "test_email": {
        "cs": (
            "Myteacher: zkušební e-mail",
            "Dobrý den,\n\n"
            "toto je zkušební e-mail z Myteacher. Pokud ho čtete, odesílání e-mailů funguje.\n",
        ),
        "en": (
            "Myteacher: test email",
            "Hello,\n\n"
            "this is a test email from Myteacher. If you are reading it, email delivery works.\n",
        ),
    },
}


def render(template: str, language: Language, to: str, **params: str) -> Message:
    subject, text = TEMPLATES[template][language]
    return Message(to=to, subject=subject.format(**params), text=text.format(**params))
