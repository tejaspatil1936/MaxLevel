// Intl lists some zones under an old alias (Asia/Calcutta); the forms offer the current names.
const RENAMED: Record<string, string> = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu' };

/** IANA timezones for the organization forms; Asia/Kolkata is the default (ORG-06). */
export const TIMEZONES: string[] = (() => {
  const zones = new Set(Intl.supportedValuesOf('timeZone').map((z) => RENAMED[z] ?? z));
  zones.add('UTC');
  zones.add('Asia/Kolkata');
  return [...zones].sort();
})();
