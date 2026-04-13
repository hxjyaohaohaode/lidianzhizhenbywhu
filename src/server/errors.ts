import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";

type AppErrorOptions = {
  code: string;
  message: string;
  statusCode: number;
  expose?: boolean;
  details?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly expose: boolean;
  readonly details?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.expose = options.expose ?? options.statusCode < 500;
    this.details = options.details;
  }
}

export function errorHandler(logger: Logger) {
  return (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _request;
    void _next;

    const normalizedError =
      error instanceof AppError
        ? error
        : new AppError({
            code: "INTERNAL_SERVER_ERROR",
            message: "服务器出现异常，请稍后重试。",
            statusCode: 500,
            expose: false,
          });

    const requestId = String(response.locals.requestId ?? "unknown");

    logger.error(
      {
        err: error,
        code: normalizedError.code,
        requestId,
        details: normalizedError.details,
      },
      "request failed",
    );

    response.status(normalizedError.statusCode).json({
      ok: false,
      error: {
        code: normalizedError.code,
        message: normalizedError.expose ? normalizedError.message : "服务器出现异常，请稍后重试。",
        requestId,
        details: normalizedError.expose ? normalizedError.details : undefined,
      },
    });
  };
}
