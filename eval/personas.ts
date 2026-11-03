// personas: the cast as Mattermost users. Usernames are lowercase cast names; first_name is the cast
// name so screenshots read well. Passwords are generated once and kept in build/eval/personas.json
// (gitignored, mode 600); accounts persist across runs on purpose (a new account = a new human actor).
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CAST = ['Kash', 'Priya', 'Sam', 'Rowan', 'Dana', 'Alex'] as const;
export const usernameOf = (name: string) => name.toLowerCase();
const USERNAME = /^[a-z][a-z0-9._-]{2,21}$/;

interface Store { personas: Record<string, { password: string; user_id?: string }> }

export function personaFile(root: string) { return join(root, 'build/eval/personas.json'); }

export function loadStore(root: string): Store {
  const f = personaFile(root);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Store) : { personas: {} };
}

/** The password for a persona, made (and saved) on first use. */
export function passwordFor(root: string, username: string): string {
  if (!USERNAME.test(username)) throw new Error(`persona username ${username} breaks Mattermost's rules`);
  const store = loadStore(root);
  if (!store.personas[username]) {
    store.personas[username] = { password: `${randomBytes(18).toString('base64url')}Aa1!` };
    saveStore(root, store);
  }
  return store.personas[username].password;
}

export function saveStore(root: string, store: Store) {
  const f = personaFile(root);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  chmodSync(f, 0o600);
}

/** Refuse to run when a persona would be named like an agent: the bridge drops such posts. */
export function nameClashes(usernames: string[], agentNames: string[]): string[] {
  const agents = new Set(agentNames.map((a) => a.toLowerCase()));
  return usernames.filter((u) => agents.has(u.toLowerCase()) || u === 'admin' || u === 'sysadmin');
}
