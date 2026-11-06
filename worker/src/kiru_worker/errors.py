from enum import StrEnum


class ErrorCode(StrEnum):
    E_UNAUTHENTICATED = "E_UNAUTHENTICATED"
    E_FORBIDDEN = "E_FORBIDDEN"
    E_NOT_FOUND = "E_NOT_FOUND"
    E_VALIDATION = "E_VALIDATION"
    E_RATE_LIMITED = "E_RATE_LIMITED"
    E_QUOTA_EXCEEDED = "E_QUOTA_EXCEEDED"
    E_UPLOAD_TOO_LARGE = "E_UPLOAD_TOO_LARGE"
    E_UNSUPPORTED_FILE_TYPE = "E_UNSUPPORTED_FILE_TYPE"
    E_NOT_A_VIDEO = "E_NOT_A_VIDEO"
    E_NO_AUDIO = "E_NO_AUDIO"
    E_NO_SPEECH = "E_NO_SPEECH"
    E_TOO_LONG = "E_TOO_LONG"
    E_UNSUPPORTED_FORMAT = "E_UNSUPPORTED_FORMAT"
    E_MEDIA_CORRUPT = "E_MEDIA_CORRUPT"
    E_LEASE_LOST = "E_LEASE_LOST"
    E_BAD_STAGE_OUTPUT = "E_BAD_STAGE_OUTPUT"
    E_STAGE_TIMEOUT = "E_STAGE_TIMEOUT"
    E_MODEL_FAILED = "E_MODEL_FAILED"
    E_RENDER_FAILED = "E_RENDER_FAILED"
    E_INTERNAL = "E_INTERNAL"


NON_RETRYABLE_CODES = frozenset(
    {
        ErrorCode.E_UNAUTHENTICATED,
        ErrorCode.E_FORBIDDEN,
        ErrorCode.E_NOT_FOUND,
        ErrorCode.E_VALIDATION,
        ErrorCode.E_QUOTA_EXCEEDED,
        ErrorCode.E_UPLOAD_TOO_LARGE,
        ErrorCode.E_UNSUPPORTED_FILE_TYPE,
        ErrorCode.E_NOT_A_VIDEO,
        ErrorCode.E_NO_AUDIO,
        ErrorCode.E_NO_SPEECH,
        ErrorCode.E_TOO_LONG,
        ErrorCode.E_UNSUPPORTED_FORMAT,
        ErrorCode.E_MEDIA_CORRUPT,
        ErrorCode.E_LEASE_LOST,
        ErrorCode.E_BAD_STAGE_OUTPUT,
    }
)


class StageError(Exception):
    """Structured error raised during stage processing."""

    def __init__(
        self,
        code: ErrorCode | str,
        message: str,
        retryable: bool | None = None,
    ) -> None:
        super().__init__(message)
        self.code = str(code)
        self.message = message
        self.retryable = (code not in NON_RETRYABLE_CODES) if retryable is None else retryable

    def __repr__(self) -> str:
        return (
            f"StageError(code={self.code!r}, message={self.message!r}, retryable={self.retryable})"
        )
