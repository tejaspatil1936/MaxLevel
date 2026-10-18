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
  /** Seconds since the epoch before which issued tokens count as revoked (set by revokeRefreshTokens). */
  validSince?: number;
  /** The Google provider's subject for this account, when it has one. */
  googleSub?: string;
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

function encode(v: string | number | boolean): FsValue {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
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
    const body = (await res.json()) as {
      users?: Array<{
        localId: string;
        email: string;
        customAttributes?: string;
        validSince?: string;
        providerUserInfo?: Array<{ providerId: string; rawId: string }>;
      }>;
    };
    return (body.users ?? []).map((u) => {
      const google = (u.providerUserInfo ?? []).find((p) => p.providerId === 'google.com');
      return {
        localId: u.localId,
        email: u.email,
        customClaims: u.customAttributes ? (JSON.parse(u.customAttributes) as Record<string, unknown>) : {},
        ...(u.validSince ? { validSince: Number(u.validSince) } : {}),
        ...(google ? { googleSub: google.rawId } : {}),
      };
    });
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

  /**
   * Records of the collection `parent/collectionId` (parent '' for a root collection) whose `field` equals `value`.
   * `field` may be a dotted path into a map, for example `target.id`.
   */
  async where(
    parent: string,
    collectionId: string,
    field: string,
    value: string | number | boolean,
  ): Promise<StoredDoc[]> {
    const url = parent ? `${DOCS}/${parent}:runQuery` : `${DOCS}:runQuery`;
    const res = await this.request.post(url, {
      headers: OWNER,
      data: {
        structuredQuery: {
          from: [{ collectionId }],
          where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encode(value) } },
        },
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, FsValue> } }>;
    return rows.flatMap((r) => (r.document ? [toDoc(r.document)] : []));
  }

  /** Every record of the collection `parent/collectionId` (parent '' for a root collection), following page tokens. */
  async list(parent: string, collectionId: string): Promise<StoredDoc[]> {
    const out: StoredDoc[] = [];
    let pageToken = '';
    for (;;) {
      const base = parent ? `${DOCS}/${parent}/${collectionId}` : `${DOCS}/${collectionId}`;
      const url = `${base}?pageSize=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const res = await this.request.get(url, { headers: OWNER });
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as {
        documents?: Array<{ name: string; fields?: Record<string, FsValue> }>;
        nextPageToken?: string;
      };
      out.push(...(body.documents ?? []).map(toDoc));
      if (!body.nextPageToken) return out;
      pageToken = body.nextPageToken;
    }
  }

  /** Number of records in the collection `parent/collectionId`. */
  async count(parent: string, collectionId: string): Promise<number> {
    return (await this.list(parent, collectionId)).length;
  }

  /** The organization's audit entries (organizations/{orgId}/auditLogs), optionally only those with this action. */
  async audit(orgId: string, action?: string): Promise<StoredDoc[]> {
    return action
      ? this.where(`organizations/${orgId}`, 'auditLogs', 'action', action)
      : this.list(`organizations/${orgId}`, 'auditLogs');
  }

  /** The organization record with this slug, or null. */
  async orgBySlug(slug: string): Promise<StoredDoc | null> {
    const found = await this.where('', 'organizations', 'slug', slug);
    expect(found.length, `organizations with slug ${slug}`).toBeLessThanOrEqual(1);
    return found[0] ?? null;
  }

  /** The whitelist entry of this org with this email, or null (emails are stored lowercase, WL-01). */
  async whitelistEntry(orgId: string, email: string): Promise<StoredDoc | null> {
    const found = await this.where(`organizations/${orgId}`, 'whitelist', 'email', email);
    expect(found.length, `whitelist entries for ${email} in ${orgId}`).toBeLessThanOrEqual(1);
    return found[0] ?? null;
  }

  /** The student record of this org with this email, or null. */
  async studentByEmail(orgId: string, email: string): Promise<StoredDoc | null> {
    const found = await this.where(`organizations/${orgId}`, 'students', 'email', email);
    expect(found.length, `student records for ${email} in ${orgId}`).toBeLessThanOrEqual(1);
    return found[0] ?? null;
  }
}
