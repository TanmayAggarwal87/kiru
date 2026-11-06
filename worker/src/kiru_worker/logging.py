import logging
import re
import sys
from typing import Any

import structlog
from structlog.contextvars import bind_contextvars, clear_contextvars, merge_contextvars
from structlog.types import EventDict

URL_QUERY_RE = re.compile(r"(https?://[^\s\?\"']+)\?[^\s\"']*", re.IGNORECASE)
TOKEN_PATTERNS = [
    re.compile(r"(bearer\s+)[a-zA-Z0-9_\-\.]+", re.IGNORECASE),
    re.compile(r"(token=)[^&\s\"']+", re.IGNORECASE),
]


def redact_string(val: str) -> str:
    # Redact query strings from URLs (presigned URLs contain credentials)
    res = URL_QUERY_RE.sub(r"\1?[REDACTED]", val)
    for pat in TOKEN_PATTERNS:
        res = pat.sub(r"\1[REDACTED]", res)
    return res


def redact_data(data: Any) -> Any:
    if isinstance(data, str):
        return redact_string(data)
    if isinstance(data, dict):
        return {k: redact_data(v) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return [redact_data(v) for v in data]
    return data


def redact_processor(_logger: Any, _method_name: str, event_dict: EventDict) -> EventDict:
    return redact_data(dict(event_dict))


def setup_logging(log_level: str = "INFO") -> None:
    level = getattr(logging, log_level.upper(), logging.INFO)
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)

    structlog.configure(
        processors=[
            merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            redact_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=False,
    )


def get_logger(name: str = "kiru_worker") -> structlog.BoundLogger:
    return structlog.get_logger(name)


def bind_job_context(
    job_id: str | None = None,
    run_id: str | None = None,
    stage: str | None = None,
    attempt: int | None = None,
) -> None:
    kwargs: dict[str, Any] = {}
    if job_id is not None:
        kwargs["jobId"] = job_id
    if run_id is not None:
        kwargs["runId"] = run_id
    if stage is not None:
        kwargs["stage"] = stage
    if attempt is not None:
        kwargs["attempt"] = attempt
    bind_contextvars(**kwargs)


def clear_job_context() -> None:
    clear_contextvars()
