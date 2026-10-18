/** IANA timezones for the organization forms; Asia/Kolkata is the default (ORG-06). */
export const TIMEZONES: string[] = (() => {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
})();
