import { systemClock, TestClock } from '@mitaoe/shared';
import { buildApp } from './app';
import { loadConfig } from './config';
import { initFirebase } from './firebase';
import { installGracefulShutdown } from './shutdown';
import { localTaskDispatcher } from './tasks/dispatcher';
import { localTaskQueue } from './tasks/local-queue';

const config = loadConfig();
// The settable clock exists only in test mode; production always uses system time.
const clock = config.env === 'test' ? new TestClock() : systemClock;
const firebase = initFirebase();
// The local queue (TASK_QUEUE=local) is dispatched from this process to the worker against the Clock.
const dispatcher = localTaskDispatcher(firebase.db, clock, { workerUrl: config.workerUrl });
const app = await buildApp({ clock, config, firebase, queue: localTaskQueue(firebase.db, clock), dispatcher });
app.addHook('onClose', () => dispatcher.stop());
installGracefulShutdown(app);
await app.listen({ port: config.port, host: config.host });
dispatcher.start(app.log);
