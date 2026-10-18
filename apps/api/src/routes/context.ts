import type { Data } from '../data';
import type { Deps } from '../deps';
import type { AccountStatusService } from '../services/account-status';
import type { AuditWriter } from '../services/audit';
import type { EntitlementsService } from '../services/entitlements';

/** What every route module receives from buildApp. */
export interface ApiContext extends Deps {
  data: Data;
  audit: AuditWriter;
  entitlements: EntitlementsService;
  status: AccountStatusService;
}
