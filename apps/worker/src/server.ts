import { systemClock, TestClock } from '@mitaoe/shared';
import { buildWorker } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const clock = config.env === 'test' ? new TestClock() : systemClock;
const app = await buildWorker({ clock, config });
await app.listen({ port: config.port, host: config.host });
