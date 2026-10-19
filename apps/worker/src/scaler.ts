import type { FastifyBaseLogger } from 'fastify';

/**
 * PERF-06 (spec 9.6): what raises the API's Cloud Run minimum instances before an exam slot. The Cloud Run driver
 * (Cloud Run Admin API) arrives with deployment and is checked on staging (docs/MANUAL_CHECKS.md); local runs and
 * tests use the logging driver, which touches no cloud API.
 */
export interface InstanceScaler {
  /** Keeps at least `minInstances` API instances until `until` (epoch ms), then back to the usual minimum. */
  raiseMinInstances(input: { minInstances: number; until: number; reason: string }): Promise<void>;
}

/** The local driver: logs what Cloud Run would be asked to do, and nothing else. */
export function loggingInstanceScaler(log: Pick<FastifyBaseLogger, 'info'>): InstanceScaler {
  return {
    async raiseMinInstances(input) {
      log.info({ scaler: 'log', ...input }, 'api minimum instances raised (local no-op)');
    },
  };
}
