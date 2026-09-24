import re
from datetime import UTC, datetime

from myteacher.persistence import make_engine
from myteacher.settings import Settings

ADMIN_EMAIL = "admin@skola.example"
ADMIN_PASSWORD = "correct horse battery"
INSTANCE_SECRET = "a test instance secret that is long enough"


class FakeClock:
    def __init__(self):
        self.now = datetime(2026, 9, 24, 8, 0, tzinfo=UTC)

    def __call__(self):
        return self.now


def sign_in(client, email=ADMIN_EMAIL, password=ADMIN_PASSWORD):
    return client.post("/api/auth/sign-in", json={"email": email, "password": password})


def create_engine_for(settings: Settings):
    return make_engine(settings.database_url)


SMTP = {
    "host": "smtp.skola.example",
    "port": 587,
    "security": "starttls",
    "username": "myteacher",
    "password": "smtp secret",
    "sender": "myteacher@skola.example",
}


def configure_smtp(client) -> None:
    assert client.put("/api/admin/smtp", json=SMTP).status_code == 200


def link_token(text: str) -> str:
    """The token of the invitation or reset link in an email body."""
    match = re.search(r"https?://\S+#([A-Za-z0-9_-]+)", text)
    assert match, text
    return match.group(1)


class ScriptedModels:
    """A model factory for tests.

    With `outputs` scripted, each model request answers with the next one: a dict is the
    structured output, an exception is raised, and a callable runs during the request (to
    change things meanwhile) and returns one of the others. Otherwise pydantic-ai's test model
    answers "OK", or every call fails as `fail_with` says. `requests` records what each request
    was sent.
    """

    def __init__(self):
        self.calls: list[tuple[str, str, str]] = []
        self.fail_with: Exception | None = None
        self.outputs: list[object] = []
        self.requests: list[dict] = []

    def script(self, *outputs: object) -> None:
        self.outputs.extend(outputs)

    def __call__(self, provider: str, model_name: str, api_key: str):
        from pydantic_ai.messages import (
            BinaryContent,
            ModelResponse,
            ToolCallPart,
            UserPromptPart,
        )
        from pydantic_ai.models.function import FunctionModel
        from pydantic_ai.models.test import TestModel

        self.calls.append((provider, model_name, api_key))
        if self.fail_with is not None:
            error = self.fail_with

            def fail(messages, info):
                raise error

            return FunctionModel(fail)
        if not self.outputs:
            return TestModel(custom_output_text="OK")

        def answer(messages, info):
            contents = [
                item
                for message in messages
                for part in getattr(message, "parts", [])
                if isinstance(part, UserPromptPart)
                for item in ([part.content] if isinstance(part.content, str) else part.content)
            ]
            prompts = [item for item in contents if isinstance(item, str)]
            self.requests.append(
                {
                    "instructions": info.instructions or "",
                    "prompt": prompts[0] if prompts else "",
                    "attachments": [
                        item.media_type for item in contents if isinstance(item, BinaryContent)
                    ],
                    "settings": info.model_settings or {},
                }
            )
            assert self.outputs, "the model was asked more often than scripted"
            output = self.outputs.pop(0)
            if callable(output):
                output = output()
            if isinstance(output, Exception):
                raise output
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)])

        return FunctionModel(answer)


# Teachers and students

TEACHER = "novak@skola.example"
TEACHER_PASSWORD = "the teacher's password"
STUDENT = "jana@skola.example"
STUDENT_PASSWORD = "the student's password"
OTHER_STUDENT = "petr@skola.example"


def accept(client, token, password):
    return client.post("/api/auth/invitations/accept", json={"token": token, "password": password})


def create_student(client, email=STUDENT, name="Jana Veselá", language="cs", **fields):
    body = {"name": name, "email": email, "language": language, **fields}
    return client.post("/api/students", json=body)


def students(client) -> dict[str, dict]:
    return {s["email"]: s for s in client.get("/api/students").json()}


def invited_student(teacher, sender, email=STUDENT, **fields) -> tuple[dict, str]:
    student = create_student(teacher, email, **fields).json()
    return student, link_token(sender.sent[-1].message.text)


def as_student(teacher, sender, email=STUDENT) -> dict:
    """Create a student, accept their invitation and leave the client signed in as them."""
    student, token = invited_student(teacher, sender, email)
    teacher.cookies.clear()
    assert accept(teacher, token, STUDENT_PASSWORD).status_code == 200
    return student


def back_to_teacher(client) -> None:
    client.cookies.clear()
    sign_in(client, TEACHER, TEACHER_PASSWORD)


def streamed(status: int, headers: dict[str, str], content: bytes):
    """A response still to be read, as one from the network is."""
    import httpx

    return httpx.Response(status, headers=headers, stream=httpx.ByteStream(content))


class FakeWeb:
    """Stands in for the internet when the app fetches a page.

    `page` serves a response at a URL, `fail` makes a URL unreachable, and `address` says what a
    host name resolves to (a public address by default). `requests` records every URL fetched.
    """

    PUBLIC = "93.184.215.14"

    def __init__(self):
        self.pages: dict[str, tuple[int, dict[str, str], bytes]] = {}
        self.unreachable: set[str] = set()
        self.addresses: dict[str, list[str]] = {}
        self.requests: list[str] = []
        # The address each request was sent to, with the URL it asked for.
        self.connected: list[tuple[str, str]] = []

    def page(
        self,
        url: str,
        body: bytes | str,
        content_type: str = "text/html; charset=utf-8",
        status: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        content = body.encode() if isinstance(body, str) else body
        self.pages[url] = (status, {"content-type": content_type, **(headers or {})}, content)

    def fail(self, url: str) -> None:
        self.unreachable.add(url)

    def address(self, host: str, *addresses: str) -> None:
        self.addresses[host] = list(addresses)

    def handle(self, request):
        import httpx

        # The app connects to the address it checked and names the host in the Host header.
        url = str(request.url.copy_with(host=request.headers["host"].split(":")[0]))
        self.requests.append(url)
        self.connected.append((request.url.host, url))
        if url in self.unreachable:
            raise httpx.ConnectError("connection refused", request=request)
        status, headers, content = self.pages.get(url, (404, {"content-type": "text/html"}, b""))
        return streamed(status, headers, content)

    async def resolve(self, host: str) -> list[str]:
        return self.addresses.get(host, [self.PUBLIC])

    def fetcher(self):
        import httpx

        from myteacher.courses.pages import PageFetcher

        return PageFetcher(transport=httpx.MockTransport(self.handle), resolve=self.resolve)
