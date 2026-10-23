import { TestClock } from '@mitaoe/shared';
import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initClipStore, initFirestore } from '../firebase';
import { localTaskQueue } from './local-queue';

// /tasks/audio-cleanup on the Storage emulator: a voice proof clip is deleted when its retention ends.

const db = initFirestore();
const clips = initClipStore();
const bucket = () => getStorage(getApps()[0]).bucket(`${process.env.GCLOUD_PROJECT ?? 'demo-mitaoe'}.appspot.com`);
let app: FastifyInstance;

beforeAll(async () => {
  const clock = new TestClock();
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
    clips,
  });
});

const run = (payload: object) => app.inject({ method: 'POST', url: '/tasks/audio-cleanup', payload });
const exists = async (path: string) => (await bucket().file(path).exists())[0];

describe('the audio cleanup task', () => {
  it('REL-04 deletes the clip it names, and a second run changes nothing', async () => {
    const path = 'organizations/org-a/attempts/att-1/audio/clip-12345678.webm';
    const keep = 'organizations/org-a/attempts/att-1/audio/clip-87654321.webm';
    await bucket()
      .file(path)
      .save(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    await bucket()
      .file(keep)
      .save(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    for (let i = 0; i < 2; i++) {
      const res = await run({ orgId: 'org-a', path });
      expect([res.statusCode, res.json()]).toEqual([200, { ok: true, outcome: 'deleted' }]);
    }
    expect(await exists(path)).toBe(false);
    expect(await exists(keep), 'other clips stay').toBe(true);
  });

  it('ORG-03 a path outside the organization audio folders is never deleted', async () => {
    const logo = 'organizations/org-a/logo.png';
    await bucket().file(logo).save(Buffer.from('png'));
    for (const payload of [
      { orgId: 'org-a', path: logo },
      { orgId: 'org-b', path: 'organizations/org-a/attempts/att-1/audio/clip-12345678.webm' },
    ])
      expect((await run(payload)).json()).toEqual({ ok: true, outcome: 'refused' });
    expect(await exists(logo)).toBe(true);
  });
});
