import type { ErrorCode } from '@mitaoe/shared';

/** Thrown by routes and services; rendered as { error: { code, message, details } } (API-01). */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
