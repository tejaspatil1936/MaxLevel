import { systemClock, TestClock } from '@mitaoe/shared';
import { buildWorker } from './app';
import { loadConfig } from './config';
import { workerData } from './data';
import { exportData } from './export-data';
import { initFileStore, initFirestore } from './firebase';
import { initRtdb, liveMirror } from './live';
import { localTaskQueue } from './tasks/local-queue';

const config = loadConfig();
const clock = config.env === 'test' ? new TestClock() : systemClock;
const db = initFirestore();
// TASK_QUEUE=local until the Cloud Tasks driver arrives with deployment (as in the API).
const app = await buildWorker({
  clock,
  config,
  data: workerData(db),
  queue: localTaskQueue(db, clock),
  exports: { data: exportData(db), files: initFileStore() },
  live: liveMirror(initRtdb()),
});
await app.listen({ port: config.port, host: config.host });
