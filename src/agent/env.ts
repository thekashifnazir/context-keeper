// env: load .env and .env.local into process.env (never overriding what's already set).
// Keys are read by the code that needs them and never printed.
import { existsSync, readFileSync } from 'node:fs';

let loaded = false;

export function loadEnv(files = ['.env', '.env.local']): void {
  if (loaded) return;
  loaded = true;
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export const envFlag = (k: string, dflt = false): boolean => {
  const v = process.env[k];
  if (v === undefined || v === '') return dflt;
  return !['0', 'off', 'false', 'no'].includes(v.toLowerCase());
};
