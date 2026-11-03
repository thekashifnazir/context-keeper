// switchapi: the Gateway calls the eval needs (list bridges and agents, create, populate and archive
// rooms), signed in as the server's Gateway admin from server/.env. Rooms are archived, never deleted
// (Switch #1202). The admin password is read from the file and never printed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Bridge { bridge_id: string; bridge_type: string; display_name: string; is_default: boolean; status: string }
export interface Room { id: string; name: string; external_channel_id: string | null; bridge_id: string | null; archived: boolean }

export function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** server/.env of the checkout that runs the server (CK_SERVER_DIR overrides, e.g. from a worktree). */
export function serverEnv(root: string): Record<string, string> {
  return readEnvFile(join(process.env.CK_SERVER_DIR || join(root, 'server'), '.env'));
}

export class Gateway {
  private constructor(readonly api: string, private cookie: string) {}

  static async login(api: string, email: string, password: string): Promise<Gateway> {
    const res = await fetch(`${api}/gateway/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Gateway sign-in failed (${res.status})`);
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('switch_auth='));
    if (!cookie) throw new Error('Gateway gave no switch_auth cookie');
    return new Gateway(api, cookie);
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.api}/gateway${path}`, {
      method, headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Gateway ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  bridges() { return this.req<Bridge[]>('GET', '/collaborations'); }
  agents() { return this.req<{ id: string; name: string }[]>('GET', '/agents'); }
  createRoom(body: {
    name: string; description: string; bridge_id: string; channel_type: 'channel_public' | 'channel_private';
    agent_names?: string[]; join_event_listeners?: string[]; user_names?: string[]; instructions?: string;
  }) { return this.req<Room>('POST', '/rooms', body); }
  addUsers(roomId: string, userNames: string[]) { return this.req<unknown>('POST', `/rooms/${roomId}/users`, { user_names: userNames }); }
  archive(roomId: string) { return this.req<Room>('POST', `/rooms/${roomId}/archive`); }
}

export async function health(api: string): Promise<string | null> {
  try {
    const res = await fetch(`${api}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = (await res.json()) as { version?: string };
    return d.version ?? 'ok';
  } catch {
    return null;
  }
}
