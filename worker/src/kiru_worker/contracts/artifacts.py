from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ArtifactModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


# --- §4.3 Transcript ---


class TranscriptWord(ArtifactModel):
    text: str
    start_ms: int
    end_ms: int
    prob: float


class TranscriptSegment(ArtifactModel):
    id: int
    start_ms: int
    end_ms: int
    text: str
    words: list[TranscriptWord]


class Transcript(ArtifactModel):
    language: str
    language_probability: float
    duration_ms: int
    model: str
    segments: list[TranscriptSegment]


# --- §4.4 Signals ---


class Signals(ArtifactModel):
    hop_ms: int = 500
    rms: list[float]
    speech_ratio_by_hop: list[float] | None = None
    scene_cuts_ms: list[int]


# --- §4.5 Candidates ---


class CandidateWindow(ArtifactModel):
    id: str
    start_ms: int
    end_ms: int
    word_start: int
    word_end: int
    text: str
    pre_score: float


class Candidates(ArtifactModel):
    candidates: list[CandidateWindow]


# --- §4.6 Scores ---


class CandidateLLMScore(ArtifactModel):
    hook: float
    standalone: float
    insight: float
    emotion: float
    payoff: float


class CandidateSignals(ArtifactModel):
    energy: float
    pace: float


class ScoredCandidate(ArtifactModel):
    id: str
    llm: CandidateLLMScore
    flags: list[str]
    title: str
    reason: str
    signal: CandidateSignals
    final: float


class Scores(ArtifactModel):
    prompt_version: str
    model: str
    candidates: list[ScoredCandidate]
    selected_ids: list[str]


# --- §4.7 CropPath ---

ReframeMode = Literal["face_track", "blur_fit", "center"]


class CropKeyframe(ArtifactModel):
    t_ms: int
    x: int
    y: int


class CropStats(ArtifactModel):
    face_coverage: float
    jitter_px: float
    max_speed_px_per_s: float


class CropPath(ArtifactModel):
    mode: ReframeMode
    src_width: int
    src_height: int
    crop_width: int
    crop_height: int
    out_width: int
    out_height: int
    fps: int
    keyframes: list[CropKeyframe]
    stats: CropStats
