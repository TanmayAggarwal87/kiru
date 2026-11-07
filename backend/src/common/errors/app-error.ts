import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorCodes } from './error-codes';

const DefaultHttpStatus: Record<ErrorCode, number> = {
  [ErrorCodes.E_UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [ErrorCodes.E_FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCodes.E_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCodes.E_VALIDATION]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.E_RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ErrorCodes.E_QUOTA_EXCEEDED]: HttpStatus.PAYMENT_REQUIRED,
  [ErrorCodes.E_UPLOAD_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  [ErrorCodes.E_UNSUPPORTED_FILE_TYPE]: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  [ErrorCodes.E_NOT_A_VIDEO]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.E_NO_AUDIO]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.E_NO_SPEECH]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCodes.E_TOO_LONG]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.E_UNSUPPORTED_FORMAT]: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  [ErrorCodes.E_MEDIA_CORRUPT]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.E_LEASE_LOST]: HttpStatus.CONFLICT,
  [ErrorCodes.E_BAD_STAGE_OUTPUT]: HttpStatus.BAD_GATEWAY,
  [ErrorCodes.E_STAGE_TIMEOUT]: HttpStatus.GATEWAY_TIMEOUT,
  [ErrorCodes.E_MODEL_FAILED]: HttpStatus.BAD_GATEWAY,
  [ErrorCodes.E_RENDER_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCodes.E_INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
};

export class AppError extends HttpException {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus?: number,
    details: Record<string, unknown> = {},
  ) {
    const status = httpStatus ?? DefaultHttpStatus[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    super(message, status);
    this.code = code;
    this.details = details;
  }
}
