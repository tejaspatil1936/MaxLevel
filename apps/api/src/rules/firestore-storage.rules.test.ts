import { readFileSync } from 'node:fs';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadString } from 'firebase/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';

const root = new URL('../../../../', import.meta.url);
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-mitaoe',
    firestore: { rules: readFileSync(new URL('firestore.rules', root), 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync(new URL('storage.rules', root), 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
afterAll(async () => env?.cleanup());

describe('Firestore rules', () => {
  it('DATA-08 deny every client read and write, signed in or not', async () => {
    const admin = env.authenticatedContext('u-admin', { role: 'admin', orgId: 'org-a' }).firestore();
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(admin, 'organizations/org-a')));
    await assertFails(setDoc(doc(admin, 'organizations/org-a/students/s1'), { name: 'x' }));
    await assertFails(getDoc(doc(anon, 'superAdmins/sa-1')));
  });
});

describe('Storage rules', () => {
  it('DATA-09 deny every client read and write', async () => {
    const user = env.authenticatedContext('u-admin', { role: 'admin', orgId: 'org-a' }).storage();
    await assertFails(uploadString(ref(user, 'organizations/org-a/imports/a.json'), '{}'));
    await assertFails(getBytes(ref(user, 'organizations/org-a/reports/r.pdf')));
  });
});
