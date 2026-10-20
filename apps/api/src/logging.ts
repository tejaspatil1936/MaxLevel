import { createHash } from 'node:crypto';
import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/** Stable, non-reversible stand-in for an email, PRN or similar identifier in logs (SEC-07). */
export const hashId = (value: unknown): string =>
  `h:${createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex').slice(0, 12)}`;

// Fields whose values never reach the logs in clear text (SEC-07). Answers are dropped, identifiers hashed.
const HASHED = ['email', 'prn', 'phone'];
const DROPPED = ['answers', 'optionId', 'correctOptionIds', 'explanation', 'idToken', 'token', 'password'];
const paths = (keys: string[]) => keys.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);

export function loggerOptions(level: LoggerOptions['level']): LoggerOptions {
  return {
    level,
    base: { service: 'api' },
    messageKey: 'message',
    formatters: { level: (label) => ({ severity: label.toUpperCase() }) }, // Cloud Logging severity
    redact: {
      paths: [
        ...paths(HASHED),
        ...paths(DROPPED),
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-test-secret"]',
      ],
      censor: (value, path) =>
        HASHED.includes(path[path.length - 1] ?? '') && value != null ? hashId(value) : '[redacted]',
    },
  };
}

export function createLogger(level: LoggerOptions['level'], destination?: DestinationStream): Logger {
  return destination ? pino(loggerOptions(level), destination) : pino(loggerOptions(level));
}
