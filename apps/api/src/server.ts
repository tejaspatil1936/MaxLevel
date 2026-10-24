import { systemClock, TestClock } from '@mitaoe/shared';
import { buildApp } from './app';
import { loadConfig } from './config';
import { initFirebase } from './firebase';
import { installGracefulShutdown } from './shutdown';
import { localTaskDispatcher } from './tasks/dispatcher';
import { localTaskQueue } from './tasks/local-queue';

const config = loadConfig();
if (!config.exportLinkSecret)
  console.error('EXPORT_LINK_SECRET is not set: results exports answer 503 (OWNER_SETUP 0.4).');
// The settable clock exists only in test mode; production always uses system time.
const clock = config.env === 'test' ? new TestClock() : systemClock;
const firebase = initFirebase();
// The local queue (TASK_QUEUE=local) is dispatched from this process to the worker against the Clock.
const dispatcher = localTaskDispatcher(firebase.db, clock, { workerUrl: config.workerUrl });
const app = await buildApp({ clock, config, firebase, queue: localTaskQueue(firebase.db, clock), dispatcher });
app.addHook('onClose', () => dispatcher.stop());
installGracefulShutdown(app);
await app.listen({ port: config.port, host: config.host });
// When TASK_QUEUE is local (e.g. Cloud Run direct worker call without Cloud Tasks), run the in-process dispatcher.
// In test-only mock production runs (scripts/verify.sh prod_api), METADATA_SERVER_DETECTION=none is set without GCP credentials.
if (config.taskQueue === 'local' && process.env.METADATA_SERVER_DETECTION !== 'none') {
  dispatcher.start(app.log);
}
