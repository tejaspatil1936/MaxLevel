import type { FastifyInstance } from 'fastify';
import type { Clock } from '@mitaoe/shared';

/** Every response carries X-Server-Time (epoch ms) for clock-offset measurement (API-03). */
export function registerServerTime(app: FastifyInstance, clock: Clock): void {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Server-Time', String(clock.now()));
  });
}
