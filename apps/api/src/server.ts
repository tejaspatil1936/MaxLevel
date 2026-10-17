import { systemClock } from '@mitaoe/shared';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await buildApp({ clock: systemClock, config });
await app.listen({ port: config.port, host: config.host });
