import type { FastifyInstance } from 'fastify';

/**
 * On SIGTERM, stop accepting connections and let in-flight requests finish, giving up after `timeoutMs`
 * (REL-03: 8 seconds, inside Cloud Run's 10-second grace period).
 */
export function installGracefulShutdown(
  app: FastifyInstance,
  {
    timeoutMs = 8000,
    exit = (code: number): void => process.exit(code),
    signal = 'SIGTERM' as NodeJS.Signals,
  }: { timeoutMs?: number; exit?: (code: number) => void; signal?: NodeJS.Signals } = {},
): () => Promise<void> {
  let closing: Promise<void> | null = null;
  const shutdown = () =>
    (closing ??= (async () => {
      app.log.info({ timeoutMs }, 'shutting down');
      const timer = setTimeout(() => {
        app.log.warn('in-flight requests did not finish in time');
        exit(1);
      }, timeoutMs);
      timer.unref();
      // Keep-alive connections become idle once their in-flight request ends; close them as they do,
      // or the server would wait for clients to hang up.
      const sweep = setInterval(() => app.server.closeIdleConnections(), 100);
      sweep.unref();
      await app.close();
      clearInterval(sweep);
      clearTimeout(timer);
      exit(0);
    })());
  process.once(signal, () => void shutdown());
  return shutdown;
}
