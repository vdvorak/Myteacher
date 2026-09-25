"""The assistant service: the only way the app calls a model (ADR 0002, ADR 0010).

A task names its kind, its prompt, the model slot it needs and the Pydantic model its output
must validate against. `generate` resolves the paying teacher's credential, runs the call with
one retry on invalid output, writes a generation record whatever happens and either returns the
validated output or raises `AssistantFailed` with a kind the teacher can act on.
"""

import json
import logging
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel
from pydantic_ai import Agent, capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import BinaryContent, ModelResponse, TextPart, ToolCallPart

from myteacher.accounts.models import Account
from myteacher.assistant import credentials, prompts
from myteacher.assistant.credentials import ProviderCredential
from myteacher.assistant.generations import GenerationRecord
from myteacher.assistant.providers import PROVIDERS, ModelFactory, ProviderProblem, classify
from myteacher.persistence import InstanceSession, open_session
from myteacher.secret_box import SecretBox, UndecryptableSecret

logger = logging.getLogger(__name__)

Slot = Literal["strong", "fast"]
# Provider problems, plus: output invalid even after the retry, no key to pay with, and a job
# cut off by a restart.
FailureKind = ProviderProblem | Literal["invalid_output", "no_key", "interrupted"]


@dataclass(frozen=True)
class Task[Out: BaseModel]:
    kind: str
    output_type: type[Out]
    slot: Slot
    # Per model request; a hung connection fails the job instead of keeping it running.
    timeout_s: int = 120


@dataclass(frozen=True)
class AssistantContext:
    """What a call needs from the app, built once per app and handed to background jobs."""

    model_factory: ModelFactory
    secret_box: SecretBox
    clock: Callable[[], datetime]


class AssistantFailed(Exception):
    def __init__(self, kind: FailureKind, raw_output: str | None = None):
        super().__init__(kind)
        self.kind: FailureKind = kind
        self.raw_output = raw_output


def paying_credential(db: InstanceSession, teacher: Account) -> ProviderCredential | None:
    """The teacher's credential for the first provider in the provider table they hold a key for."""
    held = {row.provider: row for row in credentials.credentials_of(db, teacher)}
    return next((held[provider] for provider in PROVIDERS if provider in held), None)


def _raw_output(messages: list[Any]) -> str | None:
    """What the model last answered, as text: the output tool's arguments or plain text."""
    responses = [m for m in messages if isinstance(m, ModelResponse)]
    if not responses:
        return None
    for part in responses[-1].parts:
        if isinstance(part, ToolCallPart):
            args = part.args
            return args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)
        if isinstance(part, TextPart):
            return part.content
    return None


def _usage(messages: list[Any]) -> tuple[int, int]:
    responses = [m for m in messages if isinstance(m, ModelResponse)]
    return (
        sum(r.usage.input_tokens for r in responses),
        sum(r.usage.output_tokens for r in responses),
    )


async def generate[Out: BaseModel](
    ctx: AssistantContext,
    db: InstanceSession,
    task: Task[Out],
    *,
    teacher: Account,
    inputs: dict[str, Any],
    course_id: int | None = None,
    student_id: int | None = None,
    attachments: Sequence[BinaryContent] = (),
) -> Out:
    """Run `task` on the teacher's key and record it; raises `AssistantFailed`. See
    `generate_recorded`."""
    output, _ = await generate_recorded(
        ctx,
        db,
        task,
        teacher=teacher,
        inputs=inputs,
        course_id=course_id,
        student_id=student_id,
        attachments=attachments,
    )
    return output


async def generate_recorded[Out: BaseModel](
    ctx: AssistantContext,
    db: InstanceSession,
    task: Task[Out],
    *,
    teacher: Account,
    inputs: dict[str, Any],
    course_id: int | None = None,
    student_id: int | None = None,
    attachments: Sequence[BinaryContent] = (),
) -> tuple[Out, int]:
    """Run `task` on the teacher's key and record it; returns the output and the id of its
    generation record, for content whose reception is recorded against it. Raises
    `AssistantFailed`.

    `student_id` names the student whose work the inputs hold, so their erasure blanks them.

    `attachments` (a document or image to read) go to the model after the inputs; the record
    holds only the inputs, so a caller describes an attachment there without its bytes.

    Commits the session before the model call, so that no transaction stays open across a call
    that can take a minute. Other requests keep writing meanwhile, so a caller refreshes the
    objects it goes on to change. The generation record is written in a session of its own: it
    lands whatever the caller's transaction does afterwards.
    """
    credential = paying_credential(db, teacher)
    if credential is None:
        raise AssistantFailed("no_key")
    prompt = prompts.load(task.kind)
    model_name = credential.strong_model if task.slot == "strong" else credential.fast_model
    record = GenerationRecord(
        task_kind=task.kind,
        prompt_version=prompt.version,
        prompt_hash=prompt.hash,
        account_id=teacher.id,
        course_id=course_id,
        student_id=student_id,
        provider=credential.provider,
        model=model_name,
        inputs=inputs,
        status="failed",
        created_at=ctx.clock(),
    )
    started = time.monotonic()
    try:
        try:
            api_key = ctx.secret_box.decrypt(credential.key_encrypted)
        except UndecryptableSecret:
            # Stored under another instance secret: to the teacher it is a key that does not work.
            raise AssistantFailed("authentication") from None
        db.commit()
        agent = Agent(
            ctx.model_factory(credential.provider, model_name, api_key),
            output_type=task.output_type,
            instructions=prompt.text,
            # One retry on output that does not validate, then the call fails.
            retries=1,
        )
        with capture_run_messages() as messages:
            try:
                user_prompt = json.dumps(inputs, ensure_ascii=False)
                result = await agent.run(
                    [user_prompt, *attachments] if attachments else user_prompt,
                    model_settings={"timeout": task.timeout_s},
                )
            except UnexpectedModelBehavior:
                record.raw_output = _raw_output(messages)
                raise AssistantFailed("invalid_output", record.raw_output) from None
            except Exception as error:  # noqa: BLE001 - every provider failure is classified
                kind = classify(error)
                logger.info("%s call failed (%s): %r", task.kind, kind, error)
                raise AssistantFailed(kind) from None
            finally:
                record.input_tokens, record.output_tokens = _usage(messages)
        record.status = "succeeded"
        record.output = result.output.model_dump(mode="json", exclude_unset=True)
        output = result.output
    except AssistantFailed as failure:
        record.error_kind = failure.kind
        raise
    finally:
        record.duration_ms = round((time.monotonic() - started) * 1000)
        with open_session(db.get_bind(), db.instance_id) as own:
            own.add(record)
            own.commit()
    return output, record.id
