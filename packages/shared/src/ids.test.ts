import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { attemptStartSchema } from './attempt';
import { exportRequestSchema } from './exports';
import { docIdSchema } from './ids';
import { parseBoardId } from './leaderboard';
import { departmentMergeSchema, studentCreateSchema, studentPatchSchema } from './people';
import { auditQuerySchema } from './platform';
import { reportRequestSchema } from './reports';
import { testCreateSchema, testListQuerySchema } from './test-record';

// IDs that Firestore cannot hold as one document ID: a `/` makes a longer path, `.` and `..` are refused, and
// `__…__` names are reserved. A request carrying one must fail validation (400), never reach Firestore (500).
const HOSTILE = ['a/b', '..', '.', '__x__', '__', '', 'x'.repeat(129)];

/** Request schemas whose ID fields end up in a Firestore document path, with a body around one ID. */
const REQUESTS: Array<[string, z.ZodType, string, (id: string) => unknown]> = [
  ['POST /v1/reports', reportRequestSchema, 'refId', (refId) => ({ scope: 'test', refId })],
  ['POST /v1/exports', exportRequestSchema, 'refId', (refId) => ({ scope: 'test', refId, format: 'csv' })],
  ['POST /v1/attempts', attemptStartSchema, 'testId', (testId) => ({ testId })],
  ['GET /v1/tests', testListQuerySchema, 'seriesId', (seriesId) => ({ seriesId })],
  ['POST /v1/tests', testCreateSchema, 'seriesId', (seriesId) => ({ seriesId })],
  ['POST /v1/departments/{id}/merge', departmentMergeSchema, 'intoId', (intoId) => ({ intoId })],
  ['POST /v1/students', studentCreateSchema, 'departmentId', (departmentId) => ({ departmentId })],
  ['PATCH /v1/students/{id}', studentPatchSchema, 'departmentId', (departmentId) => ({ departmentId })],
  ['GET /v1/platform/audit', auditQuerySchema, 'orgId', (orgId) => ({ orgId })],
];

const issuesAt = (schema: z.ZodType, body: unknown, field: string) => {
  const r = schema.safeParse(body);
  return r.success ? [] : r.error.issues.filter((i) => i.path[0] === field);
};

describe('document IDs', () => {
  it('API-01 docIdSchema refuses IDs Firestore cannot hold and keeps auto IDs, UUIDs and seed IDs', () => {
    for (const bad of HOSTILE) expect([bad, docIdSchema.safeParse(bad).success]).toEqual([bad, false]);
    for (const good of [
      'Xk2N9aQ0wY7bC1dE3fGh',
      'c8a1d6a2-4b9e-4f1a-9d1c-0e5b2f7a8c33',
      'stu-org-a-01',
      'a_b',
      '_x',
      'x__',
    ])
      expect([good, docIdSchema.safeParse(good).success]).toEqual([good, true]);
  });

  it('API-01 request IDs that reach a Firestore path are validated as document IDs', () => {
    for (const [route, schema, field, body] of REQUESTS) {
      expect(issuesAt(schema, body('test-org-a'), field), `${route} accepts a plain ID`).toEqual([]);
      for (const bad of HOSTILE) {
        const where = `${route} ${field}=${JSON.stringify(bad)}`;
        expect(issuesAt(schema, body(bad), field).length, where).toBeGreaterThan(0);
      }
    }
  });

  it('API-01 a board ID naming an ID Firestore cannot hold is not a board', () => {
    expect(parseBoardId('test_t1')).toEqual({ kind: 'test', refId: 't1' });
    for (const bad of ['test___x__', 'series_..', 'test_.', 'test_a/b'])
      expect([bad, parseBoardId(bad)]).toEqual([bad, null]);
  });
});
