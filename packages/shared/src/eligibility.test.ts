import { describe, expect, it } from 'vitest';
import {
  eligibilityRulesSchema,
  isEligible,
  matchesRules,
  NO_RESTRICTION,
  type EligibilityStudent,
} from './eligibility';

const student = (over: Partial<EligibilityStudent> = {}): EligibilityStudent => ({
  id: 's1',
  status: 'registered',
  departmentId: 'comp',
  graduationYear: 2027,
  ...over,
});
const rules = (over: Partial<typeof NO_RESTRICTION> = {}) => ({ ...NO_RESTRICTION, ...over });

describe('isEligible and whitelist status', () => {
  it('SER-04 a registered student with no restriction is eligible', () => {
    expect(isEligible(student(), NO_RESTRICTION)).toBe(true);
    expect(isEligible(student({ departmentId: null, graduationYear: null }), NO_RESTRICTION)).toBe(true);
  });

  it('SER-04 invited and disabled students are never eligible, even with no rules', () => {
    for (const status of ['invited', 'disabled'] as const) {
      expect(isEligible(student({ status }), NO_RESTRICTION)).toBe(false);
      expect(isEligible(student({ status }), NO_RESTRICTION, NO_RESTRICTION)).toBe(false);
    }
  });

  it('SER-04 invited and disabled students stay ineligible when they are on the include list', () => {
    for (const status of ['invited', 'disabled'] as const) {
      const included = rules({ include: ['s1'] });
      expect(isEligible(student({ status }), included, included)).toBe(false);
    }
  });

  it('SER-04 a registered student must also match the series rules', () => {
    expect(isEligible(student(), rules({ departmentIds: ['mech'] }))).toBe(false);
  });
});

describe('matchesRules', () => {
  it('SER-05 departments match any of the selected', () => {
    const r = rules({ departmentIds: ['comp', 'it'] });
    expect(matchesRules(student({ departmentId: 'comp' }), r)).toBe(true);
    expect(matchesRules(student({ departmentId: 'it' }), r)).toBe(true);
    expect(matchesRules(student({ departmentId: 'mech' }), r)).toBe(false);
    expect(matchesRules(student({ departmentId: null }), r)).toBe(false);
  });

  it('SER-05 graduation years match any of the selected', () => {
    const r = rules({ graduationYears: [2026, 2027] });
    expect(matchesRules(student({ graduationYear: 2026 }), r)).toBe(true);
    expect(matchesRules(student({ graduationYear: 2027 }), r)).toBe(true);
    expect(matchesRules(student({ graduationYear: 2028 }), r)).toBe(false);
    expect(matchesRules(student({ graduationYear: null }), r)).toBe(false);
  });

  it('SER-05 with both filters set, both must match', () => {
    const r = rules({ departmentIds: ['comp'], graduationYears: [2027] });
    expect(matchesRules(student(), r)).toBe(true);
    expect(matchesRules(student({ departmentId: 'it' }), r)).toBe(false);
    expect(matchesRules(student({ graduationYear: 2026 }), r)).toBe(false);
  });

  it('SER-05 an empty filter or list means no restriction', () => {
    expect(matchesRules(student(), NO_RESTRICTION)).toBe(true);
    expect(matchesRules(student({ departmentId: 'any' }), rules({ graduationYears: [2027] }))).toBe(true);
    expect(matchesRules(student({ graduationYear: 1999 }), rules({ departmentIds: ['comp'] }))).toBe(true);
    expect(matchesRules(student(), rules({ include: ['someone-else'] }))).toBe(true);
    expect(matchesRules(student(), rules({ exclude: ['someone-else'] }))).toBe(true);
  });

  it('SER-05 the include list admits a student who fails the filters', () => {
    const r = rules({ departmentIds: ['mech'], graduationYears: [2030], include: ['s1'] });
    expect(matchesRules(student(), r)).toBe(true);
    expect(matchesRules(student({ id: 's2' }), r)).toBe(false);
  });

  it('SER-05 the exclude list removes a student who matches', () => {
    expect(matchesRules(student(), rules({ departmentIds: ['comp'], exclude: ['s1'] }))).toBe(false);
    expect(matchesRules(student(), rules({ exclude: ['s1'] }))).toBe(false);
  });

  it('SER-05 exclude beats include', () => {
    expect(matchesRules(student(), rules({ include: ['s1'], exclude: ['s1'] }))).toBe(false);
  });

  it('SER-05 the stored rules schema defaults missing lists to empty', () => {
    expect(eligibilityRulesSchema.parse({})).toEqual(NO_RESTRICTION);
  });
});

describe('isEligible with test rules', () => {
  const series = rules({ departmentIds: ['comp', 'it'] });

  it('SER-06 eligible only when both the series and the test rules match', () => {
    expect(isEligible(student(), series, NO_RESTRICTION)).toBe(true);
    expect(isEligible(student(), series, rules({ graduationYears: [2027] }))).toBe(true);
    expect(isEligible(student({ departmentId: 'mech' }), series, NO_RESTRICTION)).toBe(false);
  });

  it('SER-06 a test include of a student the series rejects stays false, so a test never widens', () => {
    const outsider = student({ id: 's9', departmentId: 'mech' });
    expect(isEligible(outsider, series, rules({ include: ['s9'] }))).toBe(false);
    expect(isEligible(student(), rules({ exclude: ['s1'] }), rules({ include: ['s1'] }))).toBe(false);
  });

  it('SER-06 a test exclude or a narrower filter removes students the series admits', () => {
    expect(isEligible(student(), series, rules({ exclude: ['s1'] }))).toBe(false);
    expect(isEligible(student({ departmentId: 'it' }), series, rules({ departmentIds: ['comp'] }))).toBe(false);
    expect(isEligible(student(), series, rules({ graduationYears: [2026] }))).toBe(false);
  });
});
