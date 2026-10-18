import type { Page } from '@mitaoe/shared';
import { AppError } from '../errors';

// Directory-sized lists (a few thousand records per org at most) are filtered and sorted in memory, then paged with
// an opaque cursor (API-05). Firestore queries narrow the set first wherever an index applies.

const encode = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
function decode(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown }).o;
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0) return o;
  } catch {
    // fall through
  }
  throw new AppError(400, 'VALIDATION', 'The page cursor is not valid. Start again from the first page.');
}

export function pageItems<T>(items: T[], cursor: string | undefined, limit: number): Page<T> {
  const start = decode(cursor);
  const slice = items.slice(start, start + limit);
  return { items: slice, nextCursor: start + limit < items.length ? encode(start + limit) : null };
}
