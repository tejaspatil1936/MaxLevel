import { TestClock } from '@mitaoe/shared';
import { Writable } from 'node:stream';
import { buildApp } from '../app';
import { loadConfig, type Config } from '../config';
import { initFirebase } from '../firebase';
import { createLogger } from '../logging';

export const TEST_SECRET = 'local-test-secret';

/** Collects JSON log lines written by a pino logger. */
export function logSink() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const l of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(l));
      cb();
    },
  });
  return { lines, logger: createLogger('info', stream) };
}

/** The real API on the emulators with a settable clock, for integration tests. */
export async function testApp(opts: { config?: Partial<Config>; withLogs?: boolean } = {}) {
  const clock = new TestClock();
  const config = {
    ...loadConfig({ NODE_ENV: 'test', TEST_API_SECRET: TEST_SECRET }),
    logLevel: 'silent' as const,
    ...opts.config,
  };
  const sink = opts.withLogs ? logSink() : null;
  const firebase = initFirebase();
  const app = await buildApp({ clock, config, firebase }, sink?.logger);
  await app.ready();
  return { app, clock, config, firebase, logs: sink?.lines ?? [] };
}
