/** The part of a logger the Realtime Database write helpers need (Fastify's and pino's loggers fit). */
export interface WarnLogger {
  warn(obj: object, msg: string): void;
}

/** How long a route waits for an `attemptOwners/…` write before it replies anyway (REL-05). */
export const OWNER_WRITE_LIMIT_MS = 2_000;

/**
 * The Admin SDK queues Realtime Database writes forever while it is disconnected, so no route may wait on one
 * unbounded (REL-05). `live/…` mirrors are fire and forget: a failure is logged and the route goes on.
 */
export function fireAndForget(write: Promise<unknown>, log: WarnLogger, path: string): void {
  write.catch((err: unknown) => log.warn({ err, path }, 'realtime database write failed'));
}

/**
 * Waits at most `limitMs` for a write the rules depend on (`attemptOwners/…`); a failure or a write still pending at
 * the limit is logged and the caller replies anyway. Resolves true when the write landed in time.
 */
export async function withinLimit(
  write: Promise<unknown>,
  log: WarnLogger,
  path: string,
  limitMs = OWNER_WRITE_LIMIT_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), limitMs);
    timer.unref();
  });
  try {
    const outcome = await Promise.race([write.then(() => 'done' as const), limit]);
    if (outcome === 'late') {
      log.warn({ path, limitMs }, 'realtime database write still pending at the time limit');
      write.catch((err: unknown) => log.warn({ err, path }, 'realtime database write failed'));
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err, path }, 'realtime database write failed');
    return false;
  } finally {
    clearTimeout(timer);
  }
}
