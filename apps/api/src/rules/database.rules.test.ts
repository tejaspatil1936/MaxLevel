import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { get, onDisconnect, ref, serverTimestamp, set, update } from 'firebase/database';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// Realtime Database rules (spec 10.2, 10.3): what browsers and paired phones may read and write directly.

const root = new URL('../../../../', import.meta.url);
let env: RulesTestEnvironment;

const P = 'presence/org-a/t1/att-1';
const laptop = (online = true) => ({ online, lastSeen: serverTimestamp(), fullscreen: true, visible: true });
const phone = (online = true, session = 's1') => ({
  online,
  lastSeen: serverTimestamp(),
  cameraOn: online,
  camera: 'live',
  visible: online,
  session,
  stateSince: serverTimestamp(),
});

const db = (uid: string | null, claims: Record<string, string> = {}) =>
  uid === null ? env.unauthenticatedContext().database() : env.authenticatedContext(uid, claims).database();
const studentA = () => db('u-stu-1', { role: 'student', orgId: 'org-a', studentId: 'stu-1' });
const otherStudent = () => db('u-stu-2', { role: 'student', orgId: 'org-a', studentId: 'stu-2' });
const device = (attemptId = 'att-1', orgId = 'org-a') => db('device-x', { role: 'device', orgId, attemptId });
const adminOf = (orgId: string) => db(`u-admin-${orgId}`, { role: 'admin', orgId });
const superAdmin = () => db('u-super', { role: 'superAdmin' });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? 'demo-mitaoe',
    database: { rules: readFileSync(new URL('database.rules.json', root), 'utf8'), host: '127.0.0.1', port: 9000 },
  });
});
afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearDatabase();
  // What the API writes with its service account: the attempt's owner, the live row and a signal.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database()), {
      attemptOwners: { 'att-1': 'u-stu-1', 'att-b': 'u-stu-b' },
      live: { 'org-a': { t1: { 'att-1': { strikes: 0 } } }, 'org-b': { t9: { 'att-b': { strikes: 0 } } } },
      signals: { 'org-a': { 'att-1': { deadlineAt: 1 } } },
      proctor: { 'org-a': { 'att-1': { phoneSession: 's1', status: 'in_progress' } } },
      presence: { 'org-a': { t1: { 'att-1': { phone: { online: true, lastSeen: 1, cameraOn: true } } } } },
    });
  });
});

describe('Realtime Database rules', () => {
  it('DATA-07 no client may write live, signals or attemptOwners', async () => {
    for (const client of [studentA(), device(), adminOf('org-a'), superAdmin(), db(null)]) {
      await assertFails(set(ref(client, 'live/org-a/t1/att-1/strikes'), 3));
      await assertFails(set(ref(client, 'signals/org-a/att-1'), { deadlineAt: 2 }));
      await assertFails(set(ref(client, 'attemptOwners/att-1'), 'u-stu-2'));
      await assertFails(set(ref(client, 'attemptOwners/att-new'), 'u-stu-2'));
    }
  });

  it('DATA-10 a student writes the laptop presence of their own attempt only, and nothing else', async () => {
    await assertSucceeds(set(ref(studentA(), `${P}/laptop`), laptop()));
    await assertSucceeds(update(ref(studentA(), `${P}/laptop`), { visible: false, lastSeen: serverTimestamp() }));
    await assertFails(set(ref(otherStudent(), `${P}/laptop`), laptop()));
    await assertFails(set(ref(db('u-stu-1', { role: 'student', orgId: 'org-b' }), `${P}/laptop`), laptop()));
    await assertFails(set(ref(studentA(), `${P}/phone`), phone()));
    await assertFails(set(ref(studentA(), 'presence/org-a/t1/att-2/laptop'), laptop()));
    await assertFails(set(ref(studentA(), `${P}/laptop`), { ...laptop(), note: 'x' }));
    await assertFails(set(ref(studentA(), `${P}/laptop`), { online: true }));
    await assertFails(set(ref(studentA(), `${P}/laptop`), { ...laptop(), lastSeen: Date.UTC(2099, 0, 1) }));
  });

  it('DATA-10 PR-14 a paired phone writes only the phone presence of its own attempt', async () => {
    await assertSucceeds(set(ref(device(), `${P}/phone`), phone()));
    await assertFails(set(ref(device('att-2'), `${P}/phone`), phone()));
    await assertFails(set(ref(device('att-1', 'org-b'), `${P}/phone`), phone()));
    await assertFails(set(ref(device(), `${P}/laptop`), laptop()));
    await assertFails(set(ref(device(), `${P}/phone`), { ...phone(), cameraOn: 'yes' }));
    const full = { ...phone(), camera: 'paused' };
    await assertSucceeds(set(ref(device(), `${P}/phone`), full));
    await assertFails(set(ref(device(), `${P}/phone`), { ...full, camera: 'recording' }));
    const { stateSince: _missing, ...partial } = full;
    await assertFails(set(ref(device(), `${P}/phone`), partial));
    await assertFails(set(ref(device(), `${P}/phone`), { ...full, stateSince: Date.now() + 60_000 }));
    await assertFails(set(ref(device(), `${P}/phone`), { ...full, session: 'x'.repeat(65) }));
    await assertFails(get(ref(device(), `${P}/laptop`)));
    await assertFails(get(ref(device(), 'live/org-a')));
  });

  it('DATA-06 the laptop and the phone may leave their offline record for when they disconnect', async () => {
    await assertSucceeds(onDisconnect(ref(studentA(), `${P}/laptop`)).set(laptop(false)));
    await assertSucceeds(onDisconnect(ref(device(), `${P}/phone`)).set(phone(false)));
    await assertFails(onDisconnect(ref(otherStudent(), `${P}/laptop`)).set(laptop(false)));
    await assertFails(onDisconnect(ref(device('att-2'), `${P}/phone`)).set(phone(false)));
  });

  it('DATA-10 admins read live and presence of their own org only; super admins read everything', async () => {
    await assertSucceeds(get(ref(adminOf('org-a'), 'live/org-a')));
    await assertSucceeds(get(ref(adminOf('org-a'), 'presence/org-a')));
    await assertFails(get(ref(adminOf('org-b'), 'live/org-a')));
    await assertFails(get(ref(adminOf('org-b'), 'presence/org-a')));
    await assertFails(get(ref(adminOf('org-a'), 'attemptOwners')));
    await assertFails(get(ref(adminOf('org-a'), 'live')));
    for (const path of ['live', 'presence', 'signals', 'attemptOwners', '/'])
      await assertSucceeds(get(ref(superAdmin(), path)));
  });

  it("OPS-02 a test's live and presence records are read only by its org's admins and super admins, written by no client", async () => {
    for (const path of ['live/org-a/t1', 'presence/org-a/t1']) {
      await assertSucceeds(get(ref(adminOf('org-a'), path)));
      await assertSucceeds(get(ref(superAdmin(), path)));
      for (const client of [adminOf('org-b'), studentA(), device(), db(null)])
        await assertFails(get(ref(client, path)));
    }
    await assertFails(get(ref(studentA(), 'live')));
    for (const client of [studentA(), adminOf('org-a'), superAdmin()]) {
      await assertFails(update(ref(client, 'live/org-a/t1/att-1'), { status: 'submitted' }));
      await assertFails(set(ref(client, 'live/org-a/t2/att-9'), { status: 'in_progress' }));
      await assertFails(set(ref(client, 'signals/org-a/att-1/notice'), 'Your time was extended by 1 minute.'));
    }
  });

  it('DATA-10 a student reads only their own signals and the phone presence of their own attempt', async () => {
    await assertSucceeds(get(ref(studentA(), 'signals/org-a/att-1')));
    await assertSucceeds(get(ref(studentA(), `${P}/phone`)));
    await assertFails(get(ref(otherStudent(), 'signals/org-a/att-1')));
    await assertFails(get(ref(otherStudent(), `${P}/phone`)));
    await assertFails(get(ref(studentA(), `${P}/laptop`)));
    await assertFails(get(ref(studentA(), 'signals/org-a')));
    await assertFails(get(ref(studentA(), 'live/org-a/t1/att-1')));
    await assertFails(get(ref(studentA(), 'attemptOwners/att-1')));
    await assertFails(get(ref(db(null), `${P}/phone`)));
  });

  it('PR-16 PR-15 an attempt proctor record is read by its own student and its own phone, and written by no client', async () => {
    const path = 'proctor/org-a/att-1';
    await assertSucceeds(get(ref(studentA(), path)));
    await assertSucceeds(get(ref(device(), path)));
    for (const client of [otherStudent(), device('att-2'), device('att-1', 'org-b'), adminOf('org-a'), db(null)])
      await assertFails(get(ref(client, path)));
    await assertFails(get(ref(studentA(), 'proctor/org-a')));
    for (const client of [studentA(), device(), adminOf('org-a'), superAdmin()]) {
      await assertFails(set(ref(client, `${path}/phoneSession`), 'mine'));
      await assertFails(set(ref(client, `${path}/strike`), { strikesCount: 0 }));
    }
  });

  it('DATA-10 PR-14 only the current pairing session may write the phone presence, its heartbeats and offline record', async () => {
    await assertSucceeds(set(ref(device(), `${P}/phone`), phone()));
    await assertSucceeds(update(ref(device(), `${P}/phone`), { lastSeen: serverTimestamp(), session: 's1' }));
    // A phone this pairing replaced: its writes, partial or whole, and its offline record are refused.
    await assertFails(set(ref(device(), `${P}/phone`), phone(true, 's0')));
    await assertFails(update(ref(device(), `${P}/phone`), { lastSeen: serverTimestamp(), session: 's0' }));
    await assertFails(onDisconnect(ref(device(), `${P}/phone`)).set(phone(false, 's0')));
    await assertSucceeds(onDisconnect(ref(device(), `${P}/phone`)).set(phone(false)));
  });
});
