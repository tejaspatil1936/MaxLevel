'use client';

import type { MeResponse, OrgWorkspace } from '@mitaoe/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api, setWorkspaceOrg } from './api';
import { qk } from './query-keys';

const KEY = 'mitaoe.workspace';

/** The organization a super admin chose in the switcher; kept for this tab only, so it survives a reload (ORG-09). */
export function storedWorkspace(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function chooseWorkspace(orgId: string | null): void {
  setWorkspaceOrg(orgId);
  try {
    if (orgId) sessionStorage.setItem(KEY, orgId);
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: the choice lasts until the next reload
  }
}

/** The organization this admin page works in: the admin's own, or the one a super admin chose (ORG-09, ORG-12). */
export function workspaceOrgId(me: MeResponse): string | null {
  if (me.role === 'admin') return me.orgId;
  if (me.role !== 'superAdmin') return null;
  const orgId = storedWorkspace();
  setWorkspaceOrg(orgId);
  return orgId;
}

export function useWorkspaceQuery(me: MeResponse, orgId: string | null) {
  const org = useQuery({
    queryKey: qk.org(orgId ?? ''),
    queryFn: () => api<OrgWorkspace>('/v1/org'),
    enabled: !!orgId,
  });
  return {
    me,
    orgId,
    org: org.data,
    /** An archived organization is read-only for super admins (DECISIONS Q9). */
    readOnly: org.data?.status === 'archived',
    features: org.data?.entitlements.features ?? me.entitlements?.features ?? null,
  };
}

export type Workspace = ReturnType<typeof useWorkspaceQuery>;
export const WorkspaceContext = createContext<Workspace | null>(null);

/** The workspace of the admin page being shown; provided by the admin shell. */
export function useWorkspace(): Workspace & { orgId: string } {
  const w = useContext(WorkspaceContext);
  if (!w?.orgId) throw new Error('useWorkspace outside an organization workspace');
  return w as Workspace & { orgId: string };
}
