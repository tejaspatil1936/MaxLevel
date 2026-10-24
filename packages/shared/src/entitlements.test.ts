import { describe, expect, it } from 'vitest';
import { FEATURE_DEFAULTS, LIMIT_DEFAULTS, monthKey, resolveEntitlements } from './entitlements';

describe('resolveEntitlements', () => {
  it('FF-01 with nothing set, every feature is on except analytics reports and ai assistant write, and limits take system defaults', () => {
    const e = resolveEntitlements({});
    expect(e.features).toEqual(FEATURE_DEFAULTS);
    expect(e.features.analytics_reports).toBe(false);
    expect(e.features.ai_assistant_write).toBe(false);
    expect(e.limits).toEqual(LIMIT_DEFAULTS);
  });

  it('FF-01 the plan overrides the system default', () => {
    const e = resolveEntitlements({
      planFeatures: { analytics_reports: true, sections: false },
      planLimits: { max_students: 500 },
    });
    expect([e.features.analytics_reports, e.features.sections, e.limits.max_students]).toEqual([true, false, 500]);
  });

  it('FF-01 the organization override wins over the plan', () => {
    const e = resolveEntitlements({
      planFeatures: { analytics_reports: true },
      orgFeatures: { analytics_reports: false },
      planLimits: { ai_imports_per_month: 10 },
      orgLimits: { ai_imports_per_month: 0 },
    });
    expect([e.features.analytics_reports, e.limits.ai_imports_per_month]).toEqual([false, 0]);
  });
});

describe('monthKey', () => {
  it('FF-04 counts by calendar month in the organization timezone', () => {
    const lastMinuteUtcOfMarch = Date.UTC(2026, 2, 31, 19, 0); // 00:30 on 1 April in Asia/Kolkata
    expect(monthKey(lastMinuteUtcOfMarch, 'UTC')).toBe('2026-03');
    expect(monthKey(lastMinuteUtcOfMarch, 'Asia/Kolkata')).toBe('2026-04');
  });
});
