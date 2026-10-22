import type { PairingRedeemResult } from '@mitaoe/shared';

// The phone's pairing, kept on the phone so a reload or a reopened tab rejoins the attempt without a new code (the
// link it came from works once). Only the link it was paired from rejoins: a new code is always redeemed afresh.

const KEY = 'mitaoe.phonePairing';

export type StoredPairing = Omit<PairingRedeemResult, 'customToken'> & { token: string };

/** The pairing this link was redeemed for on this phone, or null. Storage may be off (private mode): null then. */
export function storedPairing(token: string): StoredPairing | null {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<StoredPairing>) : null;
    if (
      !stored ||
      stored.token !== token ||
      typeof stored.orgId !== 'string' ||
      typeof stored.testId !== 'string' ||
      typeof stored.attemptId !== 'string' ||
      typeof stored.session !== 'string'
    )
      return null;
    return stored as StoredPairing;
  } catch {
    return null;
  }
}

export function storePairing(token: string, paired: PairingRedeemResult): void {
  const { orgId, testId, attemptId, session } = paired;
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, orgId, testId, attemptId, session } satisfies StoredPairing));
  } catch {
    // Without storage a reload needs a new code, as before.
  }
}

export function forgetPairing(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
