// switch: a short-lived connection to Switch for setup work (seed, doctor). It opens its OWN stream
// connection (a fresh connection id, no rooms declared), so it never takes over the running agent's
// stream, makes operation calls through it, and closes it when done. Never prints keys.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { SwitchEventStream } from '../vendor/switch-agent-runtime/src/index.ts';

/** Load KEY=value lines into process.env without overriding what is already set. Never exports. */
export function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

export function loadDotenv(): void {
  loadEnv('.env');
  loadEnv('.env.local');
}

export interface SwitchCreds {
  endpoint: string;
  agentId: string;
  token: string;
}

export function credsFromEnv(): SwitchCreds | null {
  const endpoint = process.env.SWITCH_API_URL;
  const agentId = process.env.SWITCH_AGENT_ID;
  const token = process.env.SWITCH_AGENT_API_KEY;
  if (!endpoint || !agentId || !token) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), agentId, token };
}

/** An operation failed. 401/403/404 are fatal for setup: fail fast rather than half-seed a room. */
export class OpError extends Error {
  constructor(readonly op: string, readonly status: number, readonly detail: string) {
    super(`${op}: HTTP ${status} ${detail.slice(0, 300)}`);
  }
  get fatal(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 404;
  }
}

export class SwitchSession {
  private readonly sessions = new Map<string, string>(); // one session id per room
  private constructor(
    readonly creds: SwitchCreds,
    readonly connectionId: string,
    private readonly abort: AbortController,
  ) {}

  /** Open a fresh stream connection and wait until the server confirms it. */
  static async open(creds: SwitchCreds, timeoutMs = 15_000): Promise<SwitchSession> {
    const abort = new AbortController();
    const connectionId = randomUUID();
    const quiet = { debug: () => {}, warn: () => {}, error: () => {} };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        abort.abort();
        reject(new Error(`stream did not connect within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      const stream = new SwitchEventStream({
        creds: { agentId: creds.agentId, apiEndpoint: creds.endpoint, token: creds.token },
        connectionId,
        scope: 'all',
        filter: 'addressed', // setup needs no events; keep the stream quiet
        rooms: [],
        onEvent: () => {},
        onConnected: () => {
          clearTimeout(timer);
          resolve();
        },
        onGap: () => {},
        onEvicted: (e) => {
          clearTimeout(timer);
          abort.abort();
          reject(new Error(`stream refused: ${e.reason ?? JSON.stringify(e)}`));
        },
        log: quiet,
        signal: abort.signal,
      });
      stream.start();
    });
    return new SwitchSession(creds, connectionId, abort);
  }

  /** Call an operation. `room` picks the session id (one per room); omit for room-less calls. */
  async op<T = unknown>(name: string, args: Record<string, unknown> = {}, room?: string): Promise<T> {
    const key = room ?? '';
    let session = this.sessions.get(key);
    if (!session) this.sessions.set(key, (session = randomUUID()));
    const res = await fetch(`${this.creds.endpoint}/agents/${this.creds.agentId}/ops/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.creds.token}`,
        'Content-Type': 'application/json',
        'X-Switch-Connection-Id': this.connectionId,
        'X-Switch-Session-Id': session,
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new OpError(name, res.status, text);
    const body = text ? JSON.parse(text) : {};
    return (body && typeof body === 'object' && 'result' in body ? body.result : body) as T;
  }

  close(): void {
    this.abort.abort();
  }
}

export interface Bridge {
  id: string;
  type: string;
  display_name: string;
  status: string;
  is_default: boolean;
  can_create_channels?: boolean;
}

export interface RoomSummary {
  room_id: string;
  name: string;
  archived: boolean;
  [k: string]: unknown;
}
