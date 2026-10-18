import { systemClock, TestClock } from '@mitaoe/shared';
import { buildApp } from './app';
import { loadConfig } from './config';
import { initFirebase } from './firebase';
import { installGracefulShutdown } from './shutdown';
import { localTaskQueue } from './tasks/local-queue';

const config = loadConfig();
// The settable clock exists only in test mode; production always uses system time.
const clock = config.env === 'test' ? new TestClock() : systemClock;
const firebase = initFirebase();
const app = await buildApp({ clock, config, firebase, queue: localTaskQueue(firebase.db, clock) });
installGracefulShutdown(app);
await app.listen({ port: config.port, host: config.host });
