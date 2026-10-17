import { systemClock } from '@mitaoe/shared';
import { buildWorker } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await buildWorker({ clock: systemClock, config });
await app.listen({ port: config.port, host: config.host });
