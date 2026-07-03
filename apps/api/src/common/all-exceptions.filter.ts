import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Uniform JSON error envelope + structured logging for every unhandled error. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? exception.getResponse() : undefined;

    const body =
      typeof payload === 'object' && payload !== null
        ? payload
        : { message: payload ?? 'Internal server error' };

    if (status >= 500) {
      this.logger.error(
        { path: req.url, method: req.method, status, err: serializeError(exception) },
        'Unhandled server error',
      );
    } else {
      this.logger.warn({ path: req.url, method: req.method, status }, 'Request error');
    }

    res.status(status).json({
      statusCode: status,
      path: req.url,
      timestamp: new Date().toISOString(),
      ...body,
    });
  }
}

function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { value: String(e) };
}
