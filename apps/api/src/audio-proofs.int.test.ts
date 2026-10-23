import { AUDIO_PROOF_RETENTION_MS, AUDIO_PROOFS_PER_ATTEMPT } from '@mitaoe/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// Voice proof clips on the emulators: POST /v1/attempts/{id}/audio-proof and GET /v1/attempts/{id}/audio-proof/{clipId}.

const firebase = initFirebase();
const { db, auth } = firebase;
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;

beforeAll(async () => {
  ctx = await testApp();
  api = attemptClient(ctx.app);
});

beforeEach(async () => {
  await clearEmulators();
  ctx.clock.set(NOW);
  await seedBase(db, NOW);
});

/** A WebM file's first bytes (the EBML header), as a real recording starts. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2_000, 7)]);
const clip = (clipId = 'clip-12345678', bytes = WEBM, contentType = 'audio/webm') => ({
  clipId,
  contentType,
  data: bytes.toString('base64'),
});

async function started(n: number, audioProctoring = true) {
  const t = await api.examTest({ overrides: { audioProctoring } });
  const headers = await studentOf(auth, n);
  const res = await api.start(t.testId, headers);
  expect(res.status, res.raw).toBe(201);
  return { headers, id: res.body.attempt.id as string };
}
const upload = async (id: string, headers: Record<string, string>, body: object) => {
  const res = await ctx.app.inject({ method: 'POST', url: `/v1/attempts/${id}/audio-proof`, headers, payload: body });
  return { status: res.statusCode, body: res.json(), raw: res.body };
};
const play = (id: string, clipId: string, headers: Record<string, string>) =>
  ctx.app.inject({ method: 'GET', url: `/v1/attempts/${id}/audio-proof/${clipId}`, headers });
const adminA = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });

describe('voice proof clips', () => {
  it('SEC-06 DATA-09 a clip of an attempt in progress is stored once, with its deletion queued for 14 days on', async () => {
    const { headers, id } = await started(1);
    const first = await upload(id, headers, clip());
    expect([first.status, first.body], first.raw).toEqual([200, { clipId: 'clip-12345678' }]);
    const path = `organizations/${SEED.orgA}/attempts/${id}/audio/clip-12345678.webm`;
    const [stored] = await firebase.bucket.file(path).download();
    expect(stored.equals(WEBM)).toBe(true);
    const task = await db.doc(`_localTasks/audio-cleanup-${id}-clip-12345678`).get();
    expect(task.data()).toMatchObject({
      path: '/tasks/audio-cleanup',
      payload: { orgId: SEED.orgA, path },
      scheduleTime: NOW + AUDIO_PROOF_RETENTION_MS,
    });
    expect((await upload(id, headers, clip())).status, 'a retry').toBe(200);
    expect((await db.doc(`organizations/${SEED.orgA}/attempts/${id}`).get()).get('audioProofCount')).toBe(1);
  });

  it('SEC-06 a clip that is not the declared audio, too big, or for a test without voice detection is refused', async () => {
    const { headers, id } = await started(2);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const bad = await upload(id, headers, clip('clip-87654321', png));
    expect([bad.status, errorCode(bad)]).toEqual([400, 'VALIDATION']);
    const big = await upload(id, headers, clip('clip-87654321', Buffer.concat([WEBM, Buffer.alloc(256 * 1024)])));
    expect(big.status).toBe(400);
    const off = await started(3, false);
    const refused = await upload(off.id, off.headers, clip());
    expect([refused.status, errorCode(refused)]).toEqual([409, 'AUDIO_PROCTORING_OFF']);
    const [files] = await firebase.bucket.getFiles({ prefix: `organizations/${SEED.orgA}/attempts/` });
    expect(files).toEqual([]);
  });

  it('ORG-05 only the attempt own student uploads, and an attempt stores at most its limit of clips', async () => {
    const { headers, id } = await started(4);
    expect((await upload(id, await studentOf(auth, 5), clip())).status).toBe(404);
    expect((await upload(id, await adminA(), clip())).status).toBe(403);
    await db.doc(`organizations/${SEED.orgA}/attempts/${id}`).update({ audioProofCount: AUDIO_PROOFS_PER_ATTEMPT });
    const full = await upload(id, headers, clip());
    expect([full.status, errorCode(full)]).toEqual([409, 'AUDIO_PROOF_LIMIT']);
  });

  it('ORG-05 ORG-14 admins of the attempt organization play a clip; others get 404 or 403', async () => {
    const { headers, id } = await started(6);
    expect((await upload(id, headers, clip())).status).toBe(200);
    const res = await play(id, 'clip-12345678', await adminA());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('audio/webm');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.rawPayload.equals(WEBM)).toBe(true);
    const superAdmin = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    expect((await play(id, 'clip-12345678', { ...superAdmin, 'x-org-id': SEED.orgA })).statusCode).toBe(200);
    expect((await play(id, 'clip-00000000', await adminA())).statusCode).toBe(404);
    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    expect((await play(id, 'clip-12345678', adminB)).statusCode).toBe(404);
    expect((await play(id, 'clip-12345678', headers)).statusCode).toBe(403);
  });
});
