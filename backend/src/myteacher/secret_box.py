"""Encryption at rest of the secrets the instance holds: provider keys and the SMTP password.

The encryption key is derived from the instance secret supplied at deploy time (ADR 0002), so a
copied database file alone reveals none of them.
"""

import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


class UndecryptableSecret(Exception):
    """Stored with another instance secret, or damaged."""


class SecretBox:
    def __init__(self, instance_secret: str):
        key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"myteacher",
            info=b"secrets at rest v1",
        ).derive(instance_secret.encode())
        self._fernet = Fernet(base64.urlsafe_b64encode(key))

    def encrypt(self, plain: str) -> str:
        return self._fernet.encrypt(plain.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken as error:
            raise UndecryptableSecret() from error
