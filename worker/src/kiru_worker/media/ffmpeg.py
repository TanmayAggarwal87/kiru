import threading
from collections.abc import Callable

from kiru_worker.errors import ErrorCode, StageError
from kiru_worker.media.process import run_process_with_cancel


def build_ffmpeg_args(
    custom_args: list[str],
    protocol_whitelist: str = "file,pipe",
    with_progress: bool = False,
) -> list[str]:
    base = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-protocol_whitelist",
        protocol_whitelist,
    ]
    if with_progress:
        base.extend(["-progress", "pipe:1"])
    return base + custom_args


def parse_progress_line(line: str) -> tuple[str, str] | None:
    if "=" not in line:
        return None
    key, val = line.strip().split("=", 1)
    return key.strip(), val.strip()


def run_ffmpeg(
    custom_args: list[str],
    protocol_whitelist: str = "file,pipe",
    timeout_s: float = 300.0,
    cancel_event: threading.Event | None = None,
    on_progress: Callable[[dict[str, str]], None] | None = None,
) -> tuple[int, str, str]:
    with_prog = on_progress is not None
    cmd = build_ffmpeg_args(
        custom_args,
        protocol_whitelist=protocol_whitelist,
        with_progress=with_prog,
    )

    current_progress: dict[str, str] = {}

    def handle_line(line: str) -> None:
        parsed = parse_progress_line(line)
        if parsed:
            k, v = parsed
            current_progress[k] = v
            if k == "progress" and on_progress:
                on_progress(dict(current_progress))

    code, stdout, stderr = run_process_with_cancel(
        cmd,
        timeout_s=timeout_s,
        cancel_event=cancel_event,
        on_stdout_line=handle_line if with_prog else None,
    )

    if code != 0:
        raise StageError(
            ErrorCode.E_RENDER_FAILED,
            f"ffmpeg failed with exit code {code}: {stderr.strip()[-300:]}",
            retryable=True,
        )

    return code, stdout, stderr
