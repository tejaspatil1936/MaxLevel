import { systemClock, TestClock } from '@mitaoe/shared';
import { buildWorker } from './app';
import { loadConfig } from './config';
import { workerData } from './data';
import { exportData } from './export-data';
import { importData } from './import-data';
import { initFileStore, initFirestore } from './firebase';
import { initRtdb, liveMirror } from './live';
import { selectLlm } from './llm/select';
import { localTaskQueue } from './tasks/local-queue';

const config = loadConfig();
const clock = config.env === 'test' ? new TestClock() : systemClock;
const db = initFirestore();
const llm = selectLlm(config);
const files = initFileStore();
// TASK_QUEUE=local until the Cloud Tasks driver arrives with deployment (as in the API). No scaler is passed, so
// pre-warming (PERF-06) uses the logging driver until the Cloud Run Admin API driver arrives with deployment too.
const app = await buildWorker({
  clock,
  config,
  data: workerData(db),
  queue: localTaskQueue(db, clock),
  exports: { data: exportData(db), files },
  imports: { data: importData(db), files },
  live: liveMirror(initRtdb()),
  ...(llm ? { llm } : {}),
});
await app.listen({ port: config.port, host: config.host });
