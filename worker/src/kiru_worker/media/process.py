import contextlib
import os
import signal
import subprocess
import threading
import time
from collections.abc import Callable

from kiru_worker.errors import ErrorCode, StageError


def kill_process_group(proc: subprocess.Popen[str]) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)


def run_process_with_cancel(
    cmd: list[str],
    timeout_s: float = 60.0,
    cancel_event: threading.Event | None = None,
    on_stdout_line: Callable[[str], None] | None = None,
) -> tuple[int, str, str]:
    """Execute a subprocess securely with process-group kill, cancel hook, and stderr capture."""
    proc = subprocess.Popen(
        cmd,
        shell=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
        text=True,
    )

    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []

    # shortcut: simple thread-based pipe reader, upgrade to asyncio stream reader if thousands of concurrent jobs
    def read_stdout() -> None:
        if proc.stdout is None:
            return
        for line in proc.stdout:
            stdout_chunks.append(line)
            if on_stdout_line:
                on_stdout_line(line)

    def read_stderr() -> None:
        if proc.stderr is None:
            return
        for line in proc.stderr:
            stderr_chunks.append(line)

    t_out = threading.Thread(target=read_stdout, daemon=True)
    t_err = threading.Thread(target=read_stderr, daemon=True)
    t_out.start()
    t_err.start()

    start_time = time.monotonic()
    cancelled = False
    timed_out = False

    while proc.poll() is None:
        if cancel_event is not None and cancel_event.is_set():
            cancelled = True
            kill_process_group(proc)
            break
        if (time.monotonic() - start_time) > timeout_s:
            timed_out = True
            kill_process_group(proc)
            break
        time.sleep(0.05)

    try:
        proc.wait(timeout=2.0)
    except subprocess.TimeoutExpired:
        kill_process_group(proc)

    t_out.join(timeout=1.0)
    t_err.join(timeout=1.0)

    stdout_str = "".join(stdout_chunks)
    stderr_str = "".join(stderr_chunks)

    if cancelled:
        raise StageError(ErrorCode.E_INTERNAL, "Process was canceled by worker", retryable=False)
    if timed_out:
        raise StageError(
            ErrorCode.E_STAGE_TIMEOUT,
            f"Process timed out after {timeout_s:.1f}s",
            retryable=True,
        )

    return proc.returncode, stdout_str, stderr_str
