import { OAuth2Client } from 'google-auth-library';
import type { WorkerConfig } from './config';

export type TaskAuthCheck = (authorization: string | undefined) => Promise<boolean>;

/**
 * Cloud Tasks pushes carry a Google-signed OIDC token for the tasks service account (spec 11.5).
 * The token must verify against the configured audience and service account. Only a run with NODE_ENV set to test or
 * development accepts every request, because the local TaskQueue driver calls the worker directly; an unset NODE_ENV
 * is production (config.ts), so a deploy that forgets it still refuses unsigned calls.
 */
export function taskAuthCheck(config: WorkerConfig, client = new OAuth2Client()): TaskAuthCheck {
  if (config.env === 'test' || config.env === 'development') return async () => true;
  const { tasksAudience, tasksServiceAccount } = config;
  if (!tasksAudience || !tasksServiceAccount)
    throw new Error('TASKS_AUDIENCE and TASKS_SERVICE_ACCOUNT are required unless NODE_ENV is test or development');
  return async (authorization) => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) return false;
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience: tasksAudience });
      const payload = ticket.getPayload();
      return payload?.email === tasksServiceAccount && payload.email_verified === true;
    } catch {
      return false;
    }
  };
}
