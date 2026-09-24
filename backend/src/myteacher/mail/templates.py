"""Email templates in every interface language, chosen by the recipient's language.

Each template is a subject and a plain-text body per language, with `{name}` placeholders.
"""

from typing import Literal

from myteacher.mail import Message

Language = Literal["cs", "en"]

TEMPLATES: dict[str, dict[Language, tuple[str, str]]] = {
    "password_reset": {
        "cs": (
            "Myteacher: obnova hesla",
            "Dobrý den,\n\n"
            "někdo požádal o obnovu hesla k vašemu účtu v Myteacher. Nové heslo nastavíte zde:\n\n"
            "{link}\n\n"
            "Odkaz platí {minutes} minut a lze ho použít jen jednou. Pokud jste o obnovu "
            "nežádali, e-mail ignorujte; vaše heslo zůstává beze změny.\n",
        ),
        "en": (
            "Myteacher: reset your password",
            "Hello,\n\n"
            "someone asked to reset the password of your Myteacher account. Set a new one here:\n\n"
            "{link}\n\n"
            "The link works for {minutes} minutes and only once. If you did not ask for this, "
            "ignore this email; your password stays as it is.\n",
        ),
    },
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
    "student_invitation": {
        "cs": (
            "Myteacher: pozvánka pro studenta",
            "Dobrý den,\n\n"
            "učitel vám založil studentský účet v Myteacher. Heslo si nastavíte na tomto odkazu, "
            "klidně i z telefonu:\n\n"
            "{link}\n\n"
            "Odkaz platí {days} dní a lze ho použít jen jednou. Pokud nefunguje, požádejte "
            "učitele o nový.\n",
        ),
        "en": (
            "Myteacher: your student invitation",
            "Hello,\n\n"
            "your teacher has created a student account for you in Myteacher. Set your password "
            "here, on your phone if you like:\n\n"
            "{link}\n\n"
            "The link works for {days} days and only once. If it does not work, ask your teacher "
            "for a new one.\n",
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
