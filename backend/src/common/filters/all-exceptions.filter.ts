import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode, ErrorCodes } from '../errors/error-codes';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const rawReqId = request.headers['x-request-id'];
    const requestId = (Array.isArray(rawReqId) ? rawReqId[0] : rawReqId) || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCodes.E_INTERNAL;
    let message = 'Internal server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (status === HttpStatus.BAD_REQUEST) {
        code = ErrorCodes.E_VALIDATION;
        if (typeof res === 'object' && res !== null && 'message' in res) {
          const resMsg = (res as { message: unknown }).message;
          if (Array.isArray(resMsg)) {
            message = 'Validation failed';
            details = { issues: resMsg };
          } else {
            message = String(resMsg);
          }
        } else {
          message = exception.message;
        }
      } else if (status === HttpStatus.UNAUTHORIZED) {
        code = ErrorCodes.E_UNAUTHENTICATED;
        message = exception.message;
      } else if (status === HttpStatus.FORBIDDEN) {
        code = ErrorCodes.E_FORBIDDEN;
        message = exception.message;
      } else if (status === HttpStatus.NOT_FOUND) {
        code = ErrorCodes.E_NOT_FOUND;
        message = exception.message;
      } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
        code = ErrorCodes.E_RATE_LIMITED;
        message = 'Too many requests';
      } else if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        code = ErrorCodes.E_UPLOAD_TOO_LARGE;
        message = exception.message;
      } else {
        message = exception.message;
      }
    } else {
      // Unknown exception: log full error internally, never expose to client
      this.logger.error(
        `Unhandled exception for request ${requestId}: ${exception instanceof Error ? exception.stack : String(exception)}`,
      );
    }

    response.status(status).json({
      error: {
        code,
        message,
        requestId,
        details,
      },
    });
  }
}
