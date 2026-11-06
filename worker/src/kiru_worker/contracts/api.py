from typing import Any, Literal

from kiru_worker.contracts.artifacts import ArtifactModel

# shortcut: stub contracts until backend P0/P2 exports openapi.json
# upgrade: regenerate via scripts/generate_contracts.py when backend OpenAPI is ready


class ClaimJobRequest(ArtifactModel):
    worker_id: str
    executor: Literal["local", "modal"]
    stages: list[str]
    lease_seconds: int = 60
    wait_seconds: int = 20


class JobPayload(ArtifactModel):
    id: str
    stage: str
    project_id: str
    run_id: str
    attempt: int
    input_assets: dict[str, str] = {}
    output_prefix: str
    params: dict[str, Any] = {}


class ClaimJobResponse(ArtifactModel):
    job: JobPayload | None = None


class HeartbeatResponse(ArtifactModel):
    canceled: bool = False
    lease_extended: bool = True


class PresignUploadRequest(ArtifactModel):
    key: str
    content_type: str


class PresignUploadResponse(ArtifactModel):
    upload_url: str


class CompleteJobRequest(ArtifactModel):
    output: dict[str, Any]
    assets: dict[str, str]
    metrics: dict[str, Any] = {}


class FailJobRequest(ArtifactModel):
    error_code: str
    message: str
    retryable: bool
