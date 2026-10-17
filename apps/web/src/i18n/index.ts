import { en, type MessageKey } from './en';

/** Looks up a message and fills {name} placeholders. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const msg: string = en[key];
  if (!vars) return msg;
  return msg.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export type { MessageKey };
