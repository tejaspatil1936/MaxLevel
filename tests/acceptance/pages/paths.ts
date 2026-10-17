import { WEB_URL } from '../../env';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches the web app URL with exactly this path (static export, trailing slash), with any search or hash. */
export function pathPattern(path: string): RegExp {
  return new RegExp(`^${escape(WEB_URL)}${escape(path)}(?:[?#].*)?$`);
}
