import type { Data } from '../data';
import type { Deps } from '../deps';
import type { AccountStatusService } from '../services/account-status';
import type { AuditWriter } from '../services/audit';
import type { EligibilityService } from '../services/eligibility';
import type { EntitlementsService } from '../services/entitlements';
import type { LogoStore } from '../services/logos';
import type { QuestionImageStore } from '../services/question-images';

/** What every route module receives from buildApp. */
export interface ApiContext extends Deps {
  data: Data;
  audit: AuditWriter;
  eligibility: EligibilityService;
  entitlements: EntitlementsService;
  status: AccountStatusService;
  logos: LogoStore;
  questionImages: QuestionImageStore;
}
