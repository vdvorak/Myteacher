from myteacher.accounts.models import Account
from myteacher.policy import is_account_itself, is_admin, is_teacher, roles


def account(**fields) -> Account:
    defaults = {"id": 1, "email": "x@skola.example", "kind": "teacher", "is_admin": False}
    return Account(**{**defaults, **fields})


def test_an_admin_is_a_teacher_with_the_admin_flag():
    assert is_admin(account(is_admin=True))
    assert not is_admin(account())
    assert not is_admin(account(kind="student", is_admin=True))
    assert roles(account(is_admin=True)) == ["teacher", "admin"]


def test_students_are_not_teachers():
    assert is_teacher(account())
    assert not is_teacher(account(kind="student"))
    assert roles(account(kind="student")) == ["student"]


def test_the_account_itself_is_matched_by_id():
    assert is_account_itself(account(id=7), 7)
    assert not is_account_itself(account(id=7), 8)
