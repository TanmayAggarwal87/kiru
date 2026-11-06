import os
import platform
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    kiru_api_base_url: str = Field(default="http://localhost:4000")
    kiru_worker_token: str = Field(default="dev-worker-token-placeholder")
    worker_id: str = Field(default_factory=lambda: f"{platform.node()}-{os.getpid()}")
    worker_executor: Literal["local", "modal"] = Field(default="local")
    worker_stages: str = Field(
        default="probe,prepare_media,transcribe,analyze_signals,segment,score,reframe,captions,render"
    )
    work_dir: Path = Field(default=Path("/tmp/kiru-worker"))
    max_concurrency: int = Field(default=1)

    whisper_model: str = Field(default="small")
    whisper_device: str = Field(default="cpu")
    whisper_compute_type: str = Field(default="int8")
    whisper_model_revision: str = Field(default="main")

    llm_base_url: str = Field(default="http://localhost:11434/v1")
    llm_model: str = Field(default="llama3.2:3b")
    llm_api_key: str | None = Field(default=None)

    face_model_path: Path = Field(default=Path("assets/models/blaze_face_short_range.tflite"))
    source_cache_max_gb: float = Field(default=10.0)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO")

    @property
    def stages_list(self) -> list[str]:
        return [s.strip() for s in self.worker_stages.split(",") if s.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
