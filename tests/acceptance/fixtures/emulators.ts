import { expect, type APIRequestContext } from '@playwright/test';

// Direct reads of what the system stored, through the emulators' REST endpoints with the emulator owner credential
// (rules are bypassed; docs/TEST_ENV.md). Tests use these only to check stored state, never to set it up.

const PROJECT = 'demo-mitaoe';
const AUTH = 'http://127.0.0.1:9099';
const FIRESTORE = 'http://127.0.0.1:8080';
const OWNER = { authorization: 'Bearer owner' };
const DOCS = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;

export interface AuthAccount {
  localId: string;
  email: string;
  customClaims: Record<string, unknown>;
}

export interface StoredDoc {
  /** Path relative to the database root, for example organizations/org-a/students/stu-1. */
  path: string;
  id: string;
  data: Record<string, unknown>;
}

type FsValue = Record<string, unknown>;

function decode(v: FsValue): unknown {
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(decode);
  if ('mapValue' in v) return decodeFields((v.mapValue as { fields?: Record<string, FsValue> }).fields);
  return v;
}

function decodeFields(fields: Record<string, FsValue> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, decode(v)]));
}

function toDoc(d: { name: string; fields?: Record<string, FsValue> }): StoredDoc {
  const path = d.name.split('/documents/')[1]!;
  return { path, id: path.split('/').pop()!, data: decodeFields(d.fields) };
}

export class Emulators {
  constructor(private readonly request: APIRequestContext) {}

  /** Auth emulator accounts with this email (normally zero or one). */
  async authAccounts(email: string): Promise<AuthAccount[]> {
    const res = await this.request.post(
      `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`,
      {
        headers: OWNER,
        data: { email: [email] },
      },
    );
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { users?: Array<{ localId: string; email: string; customAttributes?: string }> };
    return (body.users ?? []).map((u) => ({
      localId: u.localId,
      email: u.email,
      customClaims: u.customAttributes ? (JSON.parse(u.customAttributes) as Record<string, unknown>) : {},
    }));
  }

  /** The one Auth emulator account with this email; fails if there is none or more than one. */
  async authAccount(email: string): Promise<AuthAccount> {
    const list = await this.authAccounts(email);
    expect(list, `Auth emulator accounts for ${email}`).toHaveLength(1);
    return list[0]!;
  }

  /** A Firestore record, or null when it does not exist. */
  async doc(path: string): Promise<StoredDoc | null> {
    const res = await this.request.get(`${DOCS}/${path}`, { headers: OWNER });
    if (res.status() === 404) return null;
    expect(res.status(), await res.text()).toBe(200);
    return toDoc((await res.json()) as { name: string; fields?: Record<string, FsValue> });
  }

  /** Records of the collection `parent/collectionId` (parent '' for a root collection) whose `field` equals `value`. */
  async where(parent: string, collectionId: string, field: string, value: string): Promise<StoredDoc[]> {
    const url = parent ? `${DOCS}/${parent}:runQuery` : `${DOCS}:runQuery`;
    const res = await this.request.post(url, {
      headers: OWNER,
      data: {
        structuredQuery: {
          from: [{ collectionId }],
          where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
        },
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, FsValue> } }>;
    return rows.flatMap((r) => (r.document ? [toDoc(r.document)] : []));
  }
}
