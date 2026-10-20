'use client';

import { useWorkspace } from '@/lib/workspace';
import { AuditScreen } from '../audit/AuditScreen';

export function OrgAudit() {
  const { orgId, org } = useWorkspace();
  return <AuditScreen scope="org" orgId={orgId} timeZone={org?.timezone ?? 'Asia/Kolkata'} />;
}
