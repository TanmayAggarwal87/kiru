import json
import threading
from pathlib import Path
from typing import Any

from kiru_worker.errors import ErrorCode, StageError
from kiru_worker.media.process import run_process_with_cancel


def build_ffprobe_args(
    target: str | Path,
    protocol_whitelist: str = "file,pipe",
) -> list[str]:
    return [
        "ffprobe",
        "-hide_banner",
        "-protocol_whitelist",
        protocol_whitelist,
        "-show_error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        str(target),
    ]


def run_ffprobe(
    target: str | Path,
    protocol_whitelist: str = "file,pipe",
    timeout_s: float = 30.0,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    cmd = build_ffprobe_args(target, protocol_whitelist=protocol_whitelist)
    code, stdout, stderr = run_process_with_cancel(
        cmd,
        timeout_s=timeout_s,
        cancel_event=cancel_event,
    )

    if code != 0:
        # shortcut: generic corrupt check, refine error matching when testing corrupt video samples
        raise StageError(
            ErrorCode.E_MEDIA_CORRUPT,
            f"ffprobe failed with exit code {code}: {stderr.strip()[:200]}",
            retryable=False,
        )

    try:
        data = json.loads(stdout)
    except Exception as exc:
        raise StageError(
            ErrorCode.E_MEDIA_CORRUPT,
            f"Failed to parse ffprobe json output: {exc}",
            retryable=False,
        ) from exc

    if "error" in data:
        raise StageError(
            ErrorCode.E_MEDIA_CORRUPT,
            f"ffprobe reported error: {data['error']}",
            retryable=False,
        )

    return data
