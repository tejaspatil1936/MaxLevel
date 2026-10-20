import { readFileSync } from 'node:fs';

/** Reads a KEY=VALUE file (comments and blank lines ignored). */
export function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export const stackEnv = readEnvFile(new URL('./stack.env', import.meta.url).pathname);
export const API_URL = 'http://localhost:4000';
export const WEB_URL = 'http://localhost:3000';
export const TEST_SECRET = stackEnv.TEST_API_SECRET!;
