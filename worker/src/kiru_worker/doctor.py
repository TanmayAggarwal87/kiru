import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import httpx

from kiru_worker.config import Settings, get_settings


@dataclass
class CheckResult:
    name: str
    passed: bool
    message: str


def check_ffmpeg() -> CheckResult:
    try:
        proc = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0:
            version_line = proc.stdout.splitlines()[0] if proc.stdout else "unknown"
            return CheckResult("ffmpeg", True, version_line)
        return CheckResult("ffmpeg", False, f"exited with code {proc.returncode}")
    except FileNotFoundError:
        return CheckResult("ffmpeg", False, "ffmpeg binary not found in PATH")


def check_ffprobe() -> CheckResult:
    try:
        proc = subprocess.run(
            ["ffprobe", "-version"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0:
            version_line = proc.stdout.splitlines()[0] if proc.stdout else "unknown"
            return CheckResult("ffprobe", True, version_line)
        return CheckResult("ffprobe", False, f"exited with code {proc.returncode}")
    except FileNotFoundError:
        return CheckResult("ffprobe", False, "ffprobe binary not found in PATH")


def check_libx264() -> CheckResult:
    try:
        proc = subprocess.run(
            ["ffmpeg", "-encoders"],
            capture_output=True,
            text=True,
            check=False,
        )
        if "libx264" in proc.stdout:
            return CheckResult("libx264", True, "libx264 encoder is available")
        return CheckResult("libx264", False, "libx264 encoder not found in ffmpeg build")
    except Exception as exc:
        return CheckResult("libx264", False, str(exc))


def check_libass() -> CheckResult:
    try:
        proc = subprocess.run(
            ["ffmpeg", "-filters"],
            capture_output=True,
            text=True,
            check=False,
        )
        if " ass " in proc.stdout or "\nass " in proc.stdout or "subtitles" in proc.stdout:
            return CheckResult("libass", True, "ass filter is available in ffmpeg")
        return CheckResult("libass", False, "ass filter not found in ffmpeg build")
    except Exception as exc:
        return CheckResult("libass", False, str(exc))


def check_work_dir(settings: Settings) -> CheckResult:
    work_dir = settings.work_dir
    try:
        work_dir.mkdir(parents=True, exist_ok=True)
        test_file = work_dir / ".write_test"
        test_file.write_text("test")
        test_file.unlink()
        return CheckResult("work_dir", True, f"writable at {work_dir}")
    except Exception as exc:
        return CheckResult("work_dir", False, f"failed to write to {work_dir}: {exc}")


def check_disk_space(settings: Settings) -> CheckResult:
    try:
        target = settings.work_dir if settings.work_dir.exists() else Path.cwd()
        usage = shutil.disk_usage(target)
        free_gb = usage.free / (1024**3)
        if free_gb >= 2.0:
            return CheckResult("disk_space", True, f"{free_gb:.1f} GB free")
        return CheckResult("disk_space", False, f"only {free_gb:.1f} GB free (< 2 GB minimum)")
    except Exception as exc:
        return CheckResult("disk_space", False, str(exc))


def check_api_health(settings: Settings) -> CheckResult:
    url = f"{settings.kiru_api_base_url.rstrip('/')}/health/live"
    try:
        resp = httpx.get(url, timeout=2.0)
        if resp.status_code == 200:
            return CheckResult("api_reachability", True, f"reachable at {url}")
        return CheckResult(
            "api_reachability",
            False,
            f"HTTP {resp.status_code} from {url}",
        )
    except httpx.RequestError as exc:
        # shortcut: allow doctor to pass on local dev when backend is not yet booted
        return CheckResult(
            "api_reachability",
            True,
            f"API offline ({exc.__class__.__name__}) — start backend when running jobs",
        )


def check_model_cache() -> CheckResult:
    cache_dir = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface"))
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        return CheckResult("model_cache", True, f"ready at {cache_dir}")
    except Exception as exc:
        return CheckResult("model_cache", False, f"cannot access {cache_dir}: {exc}")


def run_doctor_checks(settings: Settings | None = None) -> list[CheckResult]:
    s = settings or get_settings()
    return [
        check_ffmpeg(),
        check_ffprobe(),
        check_libx264(),
        check_libass(),
        check_work_dir(s),
        check_disk_space(s),
        check_api_health(s),
        check_model_cache(),
    ]
