import type { AnswerBatchResult, AttemptPayload } from '@mitaoe/shared';
import type { Auth } from 'firebase-admin/auth';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { TEST_SECRET } from './app';
import { SEED } from './seed';
import { asClaims } from './tokens';

// Helpers for the attempt integration tests (POST /v1/attempts, GET /v1/attempts/{id}, PUT …/answers).

export const NOW = Date.UTC(2026, 10, 2, 4, 0); // 2 Nov 2026, 09:30 IST
export const MIN = 60_000;
/** The explanation texts of the `basic` set, which no student-facing body may contain (DATA-05). */
export const EXPLANATIONS = [
  'Speed is distance over time: 240 / 12 = 20 m/s.',
  '15 / 100 × 200 = 30.',
  'Each number doubles: 16 × 2 = 32.',
];

/** A seeded student's bearer header (`stu-<org>-<nn>`). */
export const studentOf = (auth: Auth, n = 1, orgId: string = SEED.orgA) => {
  const nn = String(n).padStart(2, '0');
  const domain = orgId === SEED.orgA ? 'a.test' : 'b.test';
  return asClaims(auth, `student${nn}@${domain}`, { role: 'student', orgId, studentId: `stu-${orgId}-${nn}` });
};

export const errorCode = (r: { raw: string }) => (JSON.parse(r.raw) as { error?: { code: string } }).error?.code;
/** Answer-key fields or explanation texts found in a raw body. */
export const leaks = (raw: string) =>
  ['"correctOptionIds"', '"explanation"', ...EXPLANATIONS].filter((needle) => raw.includes(needle));

export function attemptClient(app: FastifyInstance) {
  return {
    /** The `exam-test` scenario in org A unless `orgId` says otherwise. */
    async examTest(body: object = {}) {
      const res = await app.inject({
        method: 'POST',
        url: '/__test/seed/exam-test',
        headers: { 'x-test-secret': TEST_SECRET },
        payload: { orgId: SEED.orgA, ...body },
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as {
        seriesId: string;
        testId: string;
        questionIds: string[];
        window: { start: number; end: number };
      };
    },

    /** POST /v1/attempts with a fresh key, the given key, or none (`null`). */
    async start(testId: string, headers: Record<string, string>, key: string | null = crypto.randomUUID()) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/attempts',
        headers: { ...headers, ...(key ? { 'idempotency-key': key } : {}) },
        payload: { testId },
      });
      return { status: res.statusCode, body: res.json() as AttemptPayload, raw: res.body };
    },

    /** PUT /v1/attempts/{id}/answers with a batch body. */
    async answers(id: string, headers: Record<string, string>, payload: object) {
      const res = await app.inject({ method: 'PUT', url: `/v1/attempts/${id}/answers`, headers, payload });
      return { status: res.statusCode, body: res.json() as AnswerBatchResult, raw: res.body };
    },

    /** POST /v1/attempts/{id}/navigate for one question. */
    async navigate(id: string, headers: Record<string, string>, questionId: string) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/attempts/${id}/navigate`,
        headers,
        payload: { questionId },
      });
      return { status: res.statusCode, body: res.json() as { servedAt: number; serverTime: number }, raw: res.body };
    },

    async resume(id: string, headers: Record<string, string>) {
      const res = await app.inject({ method: 'GET', url: `/v1/attempts/${id}`, headers });
      return { status: res.statusCode, body: res.json() as AttemptPayload, raw: res.body };
    },
  };
}
